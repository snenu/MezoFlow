/* eslint-disable no-console */
// Deploys the full MezoFlow suite to Mezo Testnet, wires permissions, registers the
// strategies and presets, buys MUSD through Mezo Pools (via the new zap, with a BTC
// permit) and funds the reward reserves and the test faucet with MUSD permits.
//
//   npx hardhat run scripts/deploy.js --network mezotestnet
//
// Writes deployments/mezotestnet.json (addresses + constructor args) and
// deployments/deploy-log.json (every transaction hash).
const { ethers, network } = require("hardhat");
const { MEZO, E, fmt, writeJson, makeLogger, signPermit, btcRoute } = require("./lib");

const DAY = 24 * 60 * 60;
const RESERVE_EACH = E(process.env.RESERVE_EACH || 100); // MUSD per savings vault reserve
const FAUCET_FUND = E(process.env.FAUCET_FUND || 150);
const FAUCET_AMOUNT = E(process.env.FAUCET_AMOUNT || 10);
const BTC_KEEP = E(process.env.BTC_KEEP || 0.004); // kept for gas + funding demo wallets

async function main() {
  if (network.name !== "mezotestnet") throw new Error("run with --network mezotestnet");
  const [deployer] = await ethers.getSigners();
  const D = await deployer.getAddress();
  const { send, deploy } = makeLogger("deploy-log.json");
  const musd = await ethers.getContractAt("IERC20", MEZO.MUSD);
  const btcBal = await ethers.provider.getBalance(D);
  console.log(`Mezo Testnet · deployer ${D}`);
  console.log(`  BTC ${fmt(btcBal, 6)} · MUSD ${fmt(await musd.balanceOf(D), 2)}`);
  if (btcBal < E(0.002)) throw new Error("deployer needs testnet BTC (https://faucet.test.mezo.org)");

  const startBlock = await ethers.provider.getBlockNumber();
  const args = {};
  const addr = {};
  const put = async (name, a, signer = deployer) => {
    const r = await deploy(name, a, signer);
    addr[name] = r.address;
    args[name] = a.map((x) => (typeof x === "bigint" ? x.toString() : x));
    return r.contract;
  };

  console.log("\nCore");
  const ledger = await put("ActivityLedger", [D]);
  const fees = await put("FeeManager", [D, MEZO.MUSD]);
  const registry = await put("StrategyRegistry", [D]);

  console.log("\nVaults");
  const flex = await put("FlexibleSavingsVault", [MEZO.MUSD, D, addr.ActivityLedger, addr.FeeManager, 450, E(1)]);
  const term = await put("TermVault", [MEZO.MUSD, D, addr.ActivityLedger, addr.FeeManager, 800, E(1), 7 * DAY, 150]);
  const spv = await put("StabilityPoolVault", [
    MEZO.MUSD, D, addr.ActivityLedger, addr.FeeManager, E(1),
    MEZO.StabilityPool, MEZO.PriceFeed, MEZO.SortedTroves, MEZO.TroveManager, 1000,
  ]);

  console.log("\nPeriphery");
  const allocator = await put("AutoAllocator", [D, MEZO.MUSD, addr.ActivityLedger, addr.StrategyRegistry]);
  const faucet = await put("MUSDFaucet", [D, MEZO.MUSD, addr.ActivityLedger, FAUCET_AMOUNT, DAY]);
  await put("AlertCenter", []);
  const zap = await put("MezoFlowZap", [
    MEZO.PoolsRouter, MEZO.PoolFactory, MEZO.MUSD, addr.ActivityLedger, addr.StrategyRegistry, addr.AutoAllocator,
  ]);
  await put("MezoFlowLens", [
    MEZO.MUSD, addr.StrategyRegistry, addr.ActivityLedger, addr.FeeManager, addr.MUSDFaucet,
    addr.AutoAllocator, addr.MezoFlowZap, MEZO.BTC, MEZO.MEZO,
  ]);

  const out = { network: network.name, chainId: 31611, deployer: D, startBlock, mezo: MEZO, contracts: addr, constructorArgs: args };
  writeJson("mezotestnet.json", out);

  console.log("\nPermissions");
  for (const n of ["FlexibleSavingsVault", "TermVault", "StabilityPoolVault", "AutoAllocator", "MUSDFaucet", "MezoFlowZap"]) {
    await send(`ledger writer: ${n}`, ledger, "setWriter", [addr[n], true]);
  }
  for (const n of ["FlexibleSavingsVault", "TermVault", "StabilityPoolVault"]) {
    await send(`fee vault: ${n}`, fees, "setVault", [addr[n], true]);
  }
  await send("Stability Pool exit fee 0.10% (set before launch)", fees, "setWithdrawalFee", [addr.StabilityPoolVault, 10]);
  await send("term: trust allocator as router", term, "setRouter", [addr.AutoAllocator, true]);
  await send("term: trust zap as router", term, "setRouter", [addr.MezoFlowZap, true]);
  await send("allocator: trust zap as router", allocator, "setRouter", [addr.MezoFlowZap, true]);

  console.log("\nStrategies");
  await send("register Flexible Savings", registry, "addStrategy", [
    addr.FlexibleSavingsVault, 1, 1, "Flexible Savings", "flexible-savings", "MezoFlow Vault",
    "Park MUSD and take it back whenever you like. Earns a fixed rate paid from MezoFlow's on-chain reward reserve. No lock-up, no exit fee.",
    "Withdraw any amount at any time. No exit fee.",
  ]);
  await send("register Term Savings", registry, "addStrategy", [
    addr.TermVault, 2, 2, "Term Savings", "term-savings", "MezoFlow Vault",
    "Commit MUSD for 7 days for a higher reserve-funded rate. You can still leave early for a 1.5% penalty, which is paid back into the reward reserve for the people who stay.",
    "7-day lock, re-weighted by size when you add. Leaving early costs 1.5%. Your penalty can never be raised after you deposit.",
  ]);
  await send("register Stability Pool", registry, "addStrategy", [
    addr.StabilityPoolVault, 3, 3, "Stability Pool", "stability-pool", "Mezo MUSD Stability Pool",
    "Supplies MUSD to Mezo's official Stability Pool, which repays the debt of liquidated troves. In return depositors receive the troves' BTC collateral, usually worth more than the MUSD used.",
    "A 10% idle buffer exits instantly. The rest can be withdrawn while no trove is below 110% collateral. 0.10% exit fee.",
  ]);

  console.log("\nAllocator presets");
  const F = addr.FlexibleSavingsVault, T = addr.TermVault, S = addr.StabilityPoolVault;
  await send("preset Conservative", allocator, "addPreset", [
    "Conservative", "Mostly instant-access savings, some term savings, and 10% kept in your wallet. No Stability Pool exposure.", 1, [F, T], [6000, 3000],
  ]);
  await send("preset Balanced", allocator, "addPreset", [
    "Balanced", "Half in flexible savings, 30% in the Stability Pool for BTC gains, 20% left in your wallet.", 2, [F, S], [5000, 3000],
  ]);
  await send("preset Growth", allocator, "addPreset", [
    "Growth", "Leans on the Stability Pool for BTC liquidation gains, with term savings for a higher fixed rate and a small flexible slice.", 3, [F, T, S], [1000, 3000, 6000],
  ]);

  console.log("\nMUSD via Mezo Pools (zap, BTC permit)");
  const need = RESERVE_EACH * 2n + FAUCET_FUND + E(20);
  const have = await musd.balanceOf(D);
  if (have < need) {
    const btcBal2 = await ethers.provider.getBalance(D);
    const spendable = btcBal2 > BTC_KEEP ? btcBal2 - BTC_KEEP : 0n;
    const r = btcRoute();
    const perBtc = await zap.quote(r, E(0.001));
    let amountIn = ((need - have) * E(0.001)) / perBtc + E(0.0002);
    if (amountIn > spendable) amountIn = spendable;
    if (amountIn === 0n) throw new Error("not enough BTC to buy MUSD");
    const quote = await zap.quote(r, amountIn);
    const sig = await signPermit(deployer, MEZO.BTC, addr.MezoFlowZap, amountIn);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    await send(`swap ${fmt(amountIn, 5)} BTC -> ~${fmt(quote, 2)} MUSD`, zap, "swapWithPermit",
      [r, amountIn, (quote * 99n) / 100n, deadline, sig], { floor: 900_000 });
  }
  const musdNow = await musd.balanceOf(D);
  const reserve = musdNow >= need ? RESERVE_EACH : (musdNow * 35n) / 100n;
  const faucetFund = musdNow >= need ? FAUCET_FUND : (musdNow * 25n) / 100n;

  console.log("\nReserves and faucet (MUSD permits)");
  for (const [n, v] of [["Flexible", flex], ["Term", term]]) {
    const sig = await signPermit(deployer, MEZO.MUSD, await v.getAddress(), reserve);
    await send(`fund ${n} reserve ${fmt(reserve, 2)} MUSD (permit)`, v, "fundReserveWithPermit", [reserve, sig], { floor: 400_000 });
  }
  await send(`fund faucet ${fmt(faucetFund, 2)} MUSD`, musd, "transfer", [addr.MUSDFaucet, faucetFund], { floor: 120_000 });

  console.log("\nAnnouncements");
  await send("announce launch", registry, "announce", [
    ethers.MaxUint256, 0, "MezoFlow v2 is live on Mezo Testnet",
    "Deposits now take one transaction with MUSD permits, and you can swap BTC or MEZO into any strategy through Mezo Pools. Contracts were re-audited; see docs/SECURITY.md.",
  ]);
  await send("announce SP rule", registry, "announce", [
    2, 1, "How Stability Pool withdrawals work",
    "Mezo's Stability Pool blocks withdrawals while any trove is below 110% collateral. MezoFlow keeps a 10% idle buffer so small exits stay instant even then.",
  ]);

  out.endBlock = await ethers.provider.getBlockNumber();
  writeJson("mezotestnet.json", out);
  console.log(`\nSaved deployments/mezotestnet.json and deployments/deploy-log.json`);
  console.log(`Deployer left: BTC ${fmt(await ethers.provider.getBalance(D), 6)} · MUSD ${fmt(await musd.balanceOf(D), 2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
