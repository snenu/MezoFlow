/* eslint-disable no-console */
// End-to-end exercise of every MezoFlow flow against a live deployment:
// faucet → deposit → allocate (preset) → SP deposit → withdraw → redeem → poke
// → alert prefs, using the deployer plus a brand-new wallet funded only by the faucet.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const E = (n) => ethers.parseEther(String(n));
const fmt = (v) => Number(ethers.formatEther(v)).toFixed(4);

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${process.env.DEPLOY_FILE || network.name}.json`)));
  const C = dep.contracts;
  const [deployer] = await ethers.getSigners();
  const musd = await ethers.getContractAt("IERC20", dep.mezo.MUSD);
  const flex = await ethers.getContractAt("FlexibleSavingsVault", C.FlexibleSavingsVault);
  const term = await ethers.getContractAt("TermVault", C.TermVault);
  const spv = await ethers.getContractAt("StabilityPoolVault", C.StabilityPoolVault);
  const allocator = await ethers.getContractAt("AutoAllocator", C.AutoAllocator);
  const faucet = await ethers.getContractAt("MUSDFaucet", C.MUSDFaucet);
  const alerts = await ethers.getContractAt("AlertCenter", C.AlertCenter);
  const lens = await ethers.getContractAt("MezoFlowLens", C.MezoFlowLens);
  const ledger = await ethers.getContractAt("ActivityLedger", C.ActivityLedger);

  const G = { gasLimit: 2_000_000 };
  const step = async (label, p) => {
    const tx = await p;
    const rc = await tx.wait();
    console.log(`  ✓ ${label.padEnd(40)} ${rc.hash}`);
    return rc;
  };

  console.log("Deployer flows");
  const resume = process.env.RESUME === "1";
  if (!resume) {
  await step("flex approve 60", musd.approve(C.FlexibleSavingsVault, E(60), G));
  await step("flex deposit 60", flex.deposit(E(60), deployer.address, G));
  await step("term approve 40", musd.approve(C.TermVault, E(40), G));
  await step("term deposit 40", term.deposit(E(40), deployer.address, G));
  await step("sp approve 80", musd.approve(C.StabilityPoolVault, E(80), G));
  await step("sp deposit 80 (→ Mezo Stability Pool)", spv.deposit(E(80), deployer.address, G));
  await step("allocator approve 100", musd.approve(C.AutoAllocator, E(100), G));
  await step("allocate 100 Balanced preset", allocator.allocatePreset(E(100), 1, G));
  }
  await step("flex withdraw 10", flex.withdraw(E(10), deployer.address, deployer.address, G));
  await step("sp withdraw 5 (0.10% fee)", spv.withdraw(E(5), deployer.address, deployer.address, G));
  await step("set alert prefs", alerts.setPreferences(255, 50, 3, 14, 11500, G));

  const sp = await ethers.getContractAt("IStabilityPool", dep.mezo.StabilityPool);
  console.log(`  vault deposit in Mezo SP: ${fmt(await sp.getCompoundedMUSDDeposit(C.StabilityPoolVault))} MUSD`);

  console.log("\nFresh wallet flow (faucet only)");
  const fresh = ethers.Wallet.createRandom().connect(ethers.provider);
  await step("fund fresh wallet with gas BTC", deployer.sendTransaction({ to: fresh.address, value: E(0.00002), gasLimit: 100000 }));
  await step("fresh: faucet claim 25", faucet.connect(fresh).claim(G));
  await step("fresh: approve allocator 25", musd.connect(fresh).approve(C.AutoAllocator, E(25), G));
  await step("fresh: allocate 25 Growth preset", allocator.connect(fresh).allocatePreset(E(25), 2, G));
  const termShares = await term.balanceOf(fresh.address);
  await step("fresh: early exit term (1.5% penalty)", term.connect(fresh).redeem(termShares, fresh.address, fresh.address, G));
  const flexShares = await flex.balanceOf(fresh.address);
  await step("fresh: redeem all flex", flex.connect(fresh).redeem(flexShares, fresh.address, fresh.address, G));

  console.log("\nKeeper calls");
  await step("flex poke", flex.poke(G));
  await step("term poke", term.poke(G));
  await step("sp rebalance", spv.rebalance(G));

  const [p, s, a] = await lens.getAll(deployer.address);
  console.log("\nProtocol");
  console.log(`  TVL ${fmt(p.tvl)} MUSD | users ${p.uniqueUsers} | entries ${p.entryCount} | fees ${fmt(p.totalFeesCollected)}`);
  for (const v of s) {
    console.log(
      `  [${v.id}] ${v.meta.name.padEnd(18)} TVL ${fmt(v.stats.totalAssets).padStart(10)}  rate ${Number(v.stats.rateBps) / 100}%  ` +
        `pps ${fmt(v.stats.sharePrice)}  user ${fmt(v.user.assets)}`
    );
  }
  console.log(`Deployer: wallet ${fmt(a.musdBalance)} MUSD | deposited ${fmt(a.deposited)} | withdrawn ${fmt(a.withdrawn)} | fees ${fmt(a.fees)}`);
  const [freshEntries] = await ledger.getUserEntries(fresh.address, 0, 20);
  console.log(`Fresh wallet ledger kinds: ${freshEntries.map((e) => Number(e.kind)).join(",")}`);
  const h = await spv.spHealth();
  console.log(`SP health: price ${fmt(h.btcPrice)} lowestICR ${fmt(h.lowestIcr)} open ${h.withdrawalsOpen}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
