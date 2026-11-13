/* eslint-disable no-console */
// Local development stack: a Hardhat node pretending to be Mezo Testnet (chain 31611)
// with mock MUSD, BTC/MEZO precompiles, a Mezo Pools router and Stability Pool, plus the
// full MezoFlow suite. Lets the web app be developed and browser-tested offline.
//
//   LOCAL_MEZO=1 npx hardhat node                                   (terminal 1)
//   LOCAL_MEZO=1 npx hardhat run scripts/deploy-local.js --network localhost
//   DEPLOYMENT=local node scripts/export-web.js
const { ethers } = require("hardhat");
const { E, writeJson } = require("./lib");

const DAY = 24 * 60 * 60;

async function main() {
  const [deployer, ...users] = await ethers.getSigners();
  const D = deployer.address;
  const dep = async (name, args = []) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const a = (c) => c.getAddress();

  const musd = await dep("MockMUSD");
  const btc = await dep("MockToken", ["BTC", "BTC"]);
  const mezo = await dep("MockToken", ["MEZO", "MEZO"]);
  const pf = await dep("MockPriceFeed");
  const st = await dep("MockSortedTroves");
  const tm = await dep("MockTroveManager");
  const sp = await dep("MockStabilityPool", [await a(musd), await a(tm)]);
  const factory = "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A";
  const router = await dep("MockRouter", [factory]);
  await router.setRate(btc, musd, E(78000));
  await router.setRate(mezo, musd, E(0.7));

  const ledger = await dep("ActivityLedger", [D]);
  const fees = await dep("FeeManager", [D, await a(musd)]);
  const registry = await dep("StrategyRegistry", [D]);
  const flex = await dep("FlexibleSavingsVault", [await a(musd), D, await a(ledger), await a(fees), 450, E(1)]);
  const term = await dep("TermVault", [await a(musd), D, await a(ledger), await a(fees), 800, E(1), 7 * DAY, 150]);
  const spv = await dep("StabilityPoolVault", [
    await a(musd), D, await a(ledger), await a(fees), E(1), await a(sp), await a(pf), await a(st), await a(tm), 1000,
  ]);
  const allocator = await dep("AutoAllocator", [D, await a(musd), await a(ledger), await a(registry)]);
  const faucet = await dep("MUSDFaucet", [D, await a(musd), await a(ledger), E(10), DAY]);
  const alerts = await dep("AlertCenter");
  const zap = await dep("MezoFlowZap", [await a(router), factory, await a(musd), await a(ledger), await a(registry), await a(allocator)]);
  const lens = await dep("MezoFlowLens", [
    await a(musd), await a(registry), await a(ledger), await a(fees), await a(faucet), await a(allocator), await a(zap), await a(btc), await a(mezo),
  ]);

  for (const w of [flex, term, spv, allocator, faucet, zap]) await ledger.setWriter(w, true);
  for (const v of [flex, term, spv]) await fees.setVault(v, true);
  await fees.setWithdrawalFee(spv, 10);
  await term.setRouter(allocator, true);
  await term.setRouter(zap, true);
  await allocator.setRouter(zap, true);

  await registry.addStrategy(flex, 1, 1, "Flexible Savings", "flexible-savings", "MezoFlow Vault",
    "Park MUSD and take it back whenever you like. Earns a fixed rate paid from MezoFlow's on-chain reward reserve. No lock-up, no exit fee.",
    "Withdraw any amount at any time. No exit fee.");
  await registry.addStrategy(term, 2, 2, "Term Savings", "term-savings", "MezoFlow Vault",
    "Commit MUSD for 7 days for a higher reserve-funded rate. You can still leave early for a 1.5% penalty, which is paid back into the reward reserve for the people who stay.",
    "7-day lock, re-weighted by size when you add. Leaving early costs 1.5%. Your penalty can never be raised after you deposit.");
  await registry.addStrategy(spv, 3, 3, "Stability Pool", "stability-pool", "Mezo MUSD Stability Pool",
    "Supplies MUSD to Mezo's official Stability Pool, which repays the debt of liquidated troves. In return depositors receive the troves' BTC collateral, usually worth more than the MUSD used.",
    "A 10% idle buffer exits instantly. The rest can be withdrawn while no trove is below 110% collateral. 0.10% exit fee.");
  const [F, T, S] = [await a(flex), await a(term), await a(spv)];
  await allocator.addPreset("Conservative", "Mostly instant-access savings, some term savings, and 10% kept in your wallet. No Stability Pool exposure.", 1, [F, T], [6000, 3000]);
  await allocator.addPreset("Balanced", "Half in flexible savings, 30% in the Stability Pool for BTC gains, 20% left in your wallet.", 2, [F, S], [5000, 3000]);
  await allocator.addPreset("Growth", "Leans on the Stability Pool for BTC liquidation gains, with term savings for a higher fixed rate and a small flexible slice.", 3, [F, T, S], [1000, 3000, 6000]);

  await musd.mint(D, E(10000));
  await musd.approve(flex, E(500));
  await flex.fundReserve(E(500));
  await musd.approve(term, E(500));
  await term.fundReserve(E(500));
  await musd.mint(faucet, E(1000));
  for (const u of users.slice(0, 5)) {
    await btc.mint(u.address, E(0.05));
    await mezo.mint(u.address, E(500));
  }
  await registry.announce(ethers.MaxUint256, 0, "Local development chain", "Mock MUSD, BTC and Mezo Pools. Nothing here is real.");

  const blk = await ethers.provider.getBlockNumber();
  writeJson("local.json", {
    network: "localhost",
    chainId: 31611,
    deployer: D,
    startBlock: 0,
    mezo: {
      MUSD: await a(musd), BTC: await a(btc), MEZO: await a(mezo), StabilityPool: await a(sp), PriceFeed: await a(pf),
      SortedTroves: await a(st), TroveManager: await a(tm), BorrowerOperations: ethers.ZeroAddress,
      PoolsRouter: await a(router), PoolFactory: factory, MusdBtcPool: ethers.ZeroAddress,
    },
    contracts: {
      ActivityLedger: await a(ledger), FeeManager: await a(fees), StrategyRegistry: await a(registry),
      FlexibleSavingsVault: F, TermVault: T, StabilityPoolVault: S, AutoAllocator: await a(allocator),
      MUSDFaucet: await a(faucet), AlertCenter: await a(alerts), MezoFlowZap: await a(zap), MezoFlowLens: await a(lens),
    },
    block: blk,
  });
  console.log("local stack deployed; deployments/local.json written");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
