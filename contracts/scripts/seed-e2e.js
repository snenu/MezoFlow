/* eslint-disable no-console */
// Scripted end-to-end run on Mezo Testnet that also seeds realistic demo data.
// Three fresh wallets, funded only by the deployer, exercise every contract path:
// faucet, permit deposits, BTC -> MUSD swaps through Mezo Pools, swap-and-deposit,
// swap-and-allocate, presets, share-permit reallocation, Stability Pool, early exit,
// fees, alerts and keeper calls. Every transaction is saved to deployments/e2e-seed.json.
//
//   npx hardhat run scripts/seed-e2e.js --network mezotestnet
//
// Wallet keys are generated once into contracts/.env.wallets (gitignored) and reused by
// the browser e2e. They are never printed.
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { MEZO, E, fmt, readJson, makeLogger, signPermit, btcRoute } = require("./lib");

const WALLETS_FILE = path.join(__dirname, "..", ".env.wallets");
const PERSONAS = ["Ana (saver)", "Ben (allocator)", "Chloe (Stability Pool)"];

function loadWallets() {
  let keys = [];
  if (fs.existsSync(WALLETS_FILE)) {
    keys = [...fs.readFileSync(WALLETS_FILE, "utf8").matchAll(/^E2E_WALLET_\d+=(0x[0-9a-fA-F]{64})$/gm)].map((m) => m[1]);
  }
  while (keys.length < 4) keys.push(ethers.Wallet.createRandom().privateKey);
  fs.writeFileSync(WALLETS_FILE, keys.map((k, i) => `E2E_WALLET_${i + 1}=${k}`).join("\n") + "\n");
  return keys.map((k) => new ethers.Wallet(k, ethers.provider));
}

async function main() {
  const dep = readJson("mezotestnet.json");
  if (!dep) throw new Error("deploy first");
  const C = dep.contracts;
  const [deployer] = await ethers.getSigners();
  const { send, sendValue } = makeLogger("e2e-seed.json");
  const at = (name, a) => ethers.getContractAt(name, a);
  const musd = await at("IERC20", MEZO.MUSD);
  const mezoTok = await at("IERC20", MEZO.MEZO);
  const flex = await at("FlexibleSavingsVault", C.FlexibleSavingsVault);
  const term = await at("TermVault", C.TermVault);
  const spv = await at("StabilityPoolVault", C.StabilityPoolVault);
  const allocator = await at("AutoAllocator", C.AutoAllocator);
  const faucet = await at("MUSDFaucet", C.MUSDFaucet);
  const alerts = await at("AlertCenter", C.AlertCenter);
  const zap = await at("MezoFlowZap", C.MezoFlowZap);
  const registry = await at("StrategyRegistry", C.StrategyRegistry);
  const lens = await at("MezoFlowLens", C.MezoFlowLens);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1200);
  const permit = (w, token, spender, v) => signPermit(w, token, spender, v);

  const [ana, ben, chloe] = loadWallets();
  console.log("Wallets:", [ana, ben, chloe].map((w, i) => `${PERSONAS[i]} ${w.address}`).join(" | "));

  console.log("\nFund wallets from the deployer");
  for (const [i, w] of [ana, ben, chloe].entries()) {
    if ((await ethers.provider.getBalance(w.address)) < E(0.0009)) {
      await sendValue(`deployer -> ${PERSONAS[i]}: 0.0012 BTC`, deployer, w.address, E(0.0012));
    }
    if ((await musd.balanceOf(w.address)) < E(20)) {
      await send(`deployer -> ${PERSONAS[i]}: 30 MUSD`, musd, "transfer", [w.address, E(30)], { floor: 120_000 });
    }
  }

  const swapBtc = async (w, label, amountIn, fn, extra) => {
    const r = btcRoute();
    const q = await zap.quote(r, amountIn);
    const sig = await permit(w, MEZO.BTC, C.MezoFlowZap, amountIn);
    const a = fn === "swapWithPermit" ? [r, amountIn, (q * 98n) / 100n, deadline(), sig] : [r, amountIn, (q * 98n) / 100n, extra, deadline(), sig];
    return send(`${label} (${fmt(amountIn, 5)} BTC ≈ ${fmt(q, 2)} MUSD)`, zap, fn, a, { from: w, floor: 1_200_000 });
  };

  console.log(`\n${PERSONAS[0]}`);
  await send("Ana: faucet claim", faucet, "claim", [], { from: ana, floor: 250_000 });
  await send("Ana: deposit 25 MUSD into Flexible (permit, 1 tx)", flex, "depositWithPermit",
    [E(25), ana.address, await permit(ana, MEZO.MUSD, C.FlexibleSavingsVault, E(25))], { from: ana, floor: 600_000 });
  await swapBtc(ana, "Ana: swap BTC and deposit into Term", E(0.0003), "swapAndDepositWithPermit", C.TermVault);
  await send("Ana: set alert preferences", alerts, "setPreferences", [255, 50, 3, 14, 11500], { from: ana, floor: 150_000 });
  await send("Ana: withdraw 5 MUSD from Flexible", flex, "withdraw", [E(5), ana.address, ana.address], { from: ana, floor: 500_000 });

  console.log(`\n${PERSONAS[1]}`);
  await send("Ben: faucet claim", faucet, "claim", [], { from: ben, floor: 250_000 });
  await send("Ben: allocate 30 MUSD with Balanced preset (permit)", allocator, "allocatePresetWithPermit",
    [E(30), 1, await permit(ben, MEZO.MUSD, C.AutoAllocator, E(30))], { from: ben, floor: 1_500_000 });
  await swapBtc(ben, "Ben: swap BTC into the Growth preset", E(0.0003), "swapAndAllocateWithPermit", 2);
  const benFlex = await flex.balanceOf(ben.address);
  if (benFlex > 0n) {
    const half = benFlex / 2n;
    await send("Ben: move half his Flexible shares to Term (share permit)", allocator, "reallocateWithPermit",
      [[C.FlexibleSavingsVault], [half], [await permit(ben, C.FlexibleSavingsVault, C.AutoAllocator, half)], [C.TermVault], [10000], 2 ** 32 - 1],
      { from: ben, floor: 1_500_000 });
  }
  if ((await mezoTok.balanceOf(deployer.address)) >= E(30)) {
    await send("deployer -> Ben: 30 MEZO", mezoTok, "transfer", [ben.address, E(30)], { floor: 120_000 });
    const r = btcRoute(MEZO.MEZO);
    const q = await zap.quote(r, E(30));
    await send(`Ben: swap 30 MEZO -> ~${fmt(q, 2)} MUSD (MEZO permit)`, zap, "swapWithPermit",
      [r, E(30), (q * 98n) / 100n, deadline(), await permit(ben, MEZO.MEZO, C.MezoFlowZap, E(30))], { from: ben, floor: 900_000 });
  }

  console.log(`\n${PERSONAS[2]}`);
  await swapBtc(chloe, "Chloe: swap BTC to MUSD in her wallet", E(0.0004), "swapWithPermit");
  await send("Chloe: deposit 40 MUSD into Stability Pool vault (permit)", spv, "depositWithPermit",
    [E(40), chloe.address, await permit(chloe, MEZO.MUSD, C.StabilityPoolVault, E(40))], { from: chloe, floor: 1_200_000 });
  await send("Chloe: deposit 10 MUSD into Term (permit)", term, "depositWithPermit",
    [E(10), chloe.address, await permit(chloe, MEZO.MUSD, C.TermVault, E(10))], { from: chloe, floor: 600_000 });
  await send("Chloe: leave Term early (1.5% penalty to reserve)", term, "redeem",
    [await term.balanceOf(chloe.address), chloe.address, chloe.address], { from: chloe, floor: 600_000 });
  await send("Chloe: withdraw 5 MUSD from Stability Pool vault (0.10% fee)", spv, "withdraw",
    [E(5), chloe.address, chloe.address], { from: chloe, floor: 1_500_000 });
  if ((await spv.pendingBtc(chloe.address)) > 0n) {
    await send("Chloe: claim BTC liquidation gains", spv, "claimBtc", [], { from: chloe, floor: 600_000 });
  }

  console.log("\nKeeper and admin");
  await send("keeper: poke Flexible", flex, "poke", [], { floor: 300_000 });
  await send("keeper: poke Term", term, "poke", [], { floor: 300_000 });
  await send("keeper: rebalance Stability Pool vault", spv, "rebalance", [], { floor: 1_200_000 });
  await send("announce: seeded demo activity", registry, "announce", [
    ethers.MaxUint256, 0, "Demo activity seeded",
    "Three test wallets ran every flow end to end: faucet, permit deposits, Mezo Pools swaps, presets, reallocation, Stability Pool and early exit.",
  ]);

  const [p, s] = await lens.getAll(ethers.ZeroAddress);
  console.log(`\nTVL ${fmt(p.tvl, 2)} MUSD · users ${p.uniqueUsers} · ledger entries ${p.entryCount} · swaps ${p.swapCount} (${fmt(p.swapMusdOut, 2)} MUSD)`);
  for (const v of s) console.log(`  ${v.meta.name.padEnd(18)} TVL ${fmt(v.stats.totalAssets, 2).padStart(9)}  depositors ${v.stats.depositorCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
