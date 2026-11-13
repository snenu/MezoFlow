/* eslint-disable no-console */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Official Mezo testnet (matsnet) addresses — docs + mezo-org/musd deployments.
const MEZO_TESTNET = {
  MUSD: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  SortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
};

const E = (n) => ethers.parseEther(String(n));
const DAY = 24 * 60 * 60;

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`Network ${network.name} (${chainId}) deployer ${deployer.address}`);
  console.log(`BTC ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))}`);

  const musd = await ethers.getContractAt("IERC20", MEZO_TESTNET.MUSD);
  console.log(`MUSD ${ethers.formatEther(await musd.balanceOf(deployer.address))}`);

  const startBlock = await ethers.provider.getBlockNumber();
  const out = { network: network.name, chainId, deployer: deployer.address, startBlock, mezo: MEZO_TESTNET, contracts: {} };

  async function deploy(name, args) {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    out.contracts[name] = addr;
    console.log(`  ${name.padEnd(22)} ${addr}`);
    return c;
  }
  async function send(label, txp) {
    const tx = await txp;
    await tx.wait();
    console.log(`  ✓ ${label}`);
  }

  console.log("\nDeploying core…");
  const ledger = await deploy("ActivityLedger", [deployer.address]);
  const fees = await deploy("FeeManager", [deployer.address, MEZO_TESTNET.MUSD]);
  const registry = await deploy("StrategyRegistry", [deployer.address]);

  console.log("\nDeploying vaults…");
  const flex = await deploy("FlexibleSavingsVault", [MEZO_TESTNET.MUSD, deployer.address, ledger, fees, 450, E(1)]);
  const term = await deploy("TermVault", [MEZO_TESTNET.MUSD, deployer.address, ledger, fees, 800, E(1), 7 * DAY, 150]);
  const spv = await deploy("StabilityPoolVault", [
    MEZO_TESTNET.MUSD,
    deployer.address,
    ledger,
    fees,
    E(1),
    MEZO_TESTNET.StabilityPool,
    MEZO_TESTNET.PriceFeed,
    MEZO_TESTNET.SortedTroves,
    MEZO_TESTNET.TroveManager,
    1000,
  ]);

  console.log("\nDeploying periphery…");
  const allocator = await deploy("AutoAllocator", [deployer.address, MEZO_TESTNET.MUSD, ledger, registry]);
  const faucet = await deploy("MUSDFaucet", [deployer.address, MEZO_TESTNET.MUSD, ledger, E(25), DAY]);
  const alerts = await deploy("AlertCenter", []);
  const lens = await deploy("MezoFlowLens", [MEZO_TESTNET.MUSD, registry, ledger, fees, faucet, allocator]);
  void alerts;
  void lens;

  console.log("\nWiring permissions…");
  for (const [n, c] of [["flex", flex], ["term", term], ["sp", spv], ["allocator", allocator], ["faucet", faucet]]) {
    await send(`ledger writer: ${n}`, ledger.setWriter(await c.getAddress(), true));
  }
  for (const [n, c] of [["flex", flex], ["term", term], ["sp", spv]]) {
    await send(`fee vault: ${n}`, fees.setVault(await c.getAddress(), true));
  }
  await send("sp exit fee 0.10%", fees.setWithdrawalFee(await spv.getAddress(), 10));

  console.log("\nRegistering strategies…");
  await send(
    "Flexible Savings",
    registry.addStrategy(
      await flex.getAddress(),
      1,
      1,
      "Flexible Savings",
      "flexible-savings",
      "MezoFlow Vault",
      "Park MUSD and take it back whenever you like. Earns a fixed rate paid from MezoFlow's on-chain reward reserve. No lockup, no exit fee.",
      "Instant withdrawals at any time. No exit fee."
    )
  );
  await send(
    "Term Savings",
    registry.addStrategy(
      await term.getAddress(),
      2,
      2,
      "Term Savings",
      "term-savings",
      "MezoFlow Vault",
      "Commit MUSD for 7 days in exchange for a higher reserve-funded rate. You can still leave early for a 1.5% penalty, which is paid back into the reward reserve.",
      "7-day lock, re-weighted by size when you add. Early exit costs 1.5%."
    )
  );
  await send(
    "Stability Pool",
    registry.addStrategy(
      await spv.getAddress(),
      3,
      3,
      "Stability Pool",
      "stability-pool",
      "Mezo MUSD Stability Pool",
      "Supplies MUSD to Mezo's official Stability Pool, which pays off the debt of liquidated troves. In return depositors receive the troves' BTC collateral, usually worth more than the MUSD used.",
      "10% idle buffer exits instantly. The rest is withdrawable while no trove is below 110% collateral. 0.10% exit fee."
    )
  );

  console.log("\nAllocator presets…");
  const F = await flex.getAddress();
  const T = await term.getAddress();
  const S = await spv.getAddress();
  await send(
    "Conservative",
    allocator.addPreset(
      "Conservative",
      "Mostly instant-access savings, some term savings, and 10% kept in your wallet. No Stability Pool exposure.",
      1,
      [F, T],
      [6000, 3000]
    )
  );
  await send(
    "Balanced",
    allocator.addPreset(
      "Balanced",
      "Half in flexible savings, 30% in the Stability Pool for BTC gains, 20% left available in your wallet.",
      2,
      [F, S],
      [5000, 3000]
    )
  );
  await send(
    "Growth",
    allocator.addPreset(
      "Growth",
      "Leans on the Stability Pool for BTC liquidation gains, with term savings for a higher fixed rate and a small flexible slice.",
      3,
      [F, T, S],
      [1000, 3000, 6000]
    )
  );

  console.log("\nFunding reserves, faucet and seeding vaults…");
  const reserve = E(250);
  await send("approve flex reserve", musd.approve(F, reserve));
  await send("fund flex reserve 250", flex.fundReserve(reserve));
  await send("approve term reserve", musd.approve(T, reserve));
  await send("fund term reserve 250", term.fundReserve(reserve));
  await send("fund faucet 400", musd.transfer(await faucet.getAddress(), E(400)));

  await send(
    "announce launch",
    registry.announce(
      ethers.MaxUint256,
      0,
      "MezoFlow is live on Mezo Testnet",
      "All three strategies, the auto allocator, alerts and the on-chain activity ledger are deployed. Grab test MUSD from the faucet to try them."
    )
  );
  await send(
    "announce SP rule",
    registry.announce(
      2,
      1,
      "How Stability Pool withdrawals work",
      "Mezo's Stability Pool blocks withdrawals while any trove is below 110% collateral. MezoFlow keeps a 10% idle buffer so small exits stay instant even then."
    )
  );

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`\nSaved deployments/${network.name}.json`);
  console.log(`MUSD left: ${ethers.formatEther(await musd.balanceOf(deployer.address))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
