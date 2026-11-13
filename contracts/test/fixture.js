const { ethers } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const DAY = 24 * 60 * 60;

async function deployFixture() {
  const [owner, alice, bob, carol] = await ethers.getSigners();

  const musd = await (await ethers.getContractFactory("MockMUSD")).deploy();
  const pf = await (await ethers.getContractFactory("MockPriceFeed")).deploy();
  const st = await (await ethers.getContractFactory("MockSortedTroves")).deploy();
  const tm = await (await ethers.getContractFactory("MockTroveManager")).deploy();
  const sp = await (await ethers.getContractFactory("MockStabilityPool")).deploy(musd, tm);

  const ledger = await (await ethers.getContractFactory("ActivityLedger")).deploy(owner);
  const fees = await (await ethers.getContractFactory("FeeManager")).deploy(owner, musd);
  const registry = await (await ethers.getContractFactory("StrategyRegistry")).deploy(owner);

  const flex = await (await ethers.getContractFactory("FlexibleSavingsVault")).deploy(musd, owner, ledger, fees, 450, E(1));
  const term = await (await ethers.getContractFactory("TermVault")).deploy(musd, owner, ledger, fees, 800, E(1), 7 * DAY, 150);
  const spv = await (await ethers.getContractFactory("StabilityPoolVault")).deploy(musd, owner, ledger, fees, E(1), sp, pf, st, tm, 1000);

  const allocator = await (await ethers.getContractFactory("AutoAllocator")).deploy(owner, musd, ledger, registry);
  const faucet = await (await ethers.getContractFactory("MUSDFaucet")).deploy(owner, musd, ledger, E(20), DAY);
  const alerts = await (await ethers.getContractFactory("AlertCenter")).deploy();
  const lens = await (await ethers.getContractFactory("MezoFlowLens")).deploy(musd, registry, ledger, fees, faucet, allocator);

  for (const w of [flex, term, spv, allocator, faucet]) await ledger.setWriter(w, true);
  for (const v of [flex, term, spv]) await fees.setVault(v, true);
  await fees.setWithdrawalFee(spv, 10);

  await registry.addStrategy(flex, 1, 1, "Flexible Savings", "flexible-savings", "MezoFlow", "s", "Instant");
  await registry.addStrategy(term, 2, 2, "Term Savings", "term-savings", "MezoFlow", "s", "7d lock");
  await registry.addStrategy(spv, 3, 3, "Stability Pool", "stability-pool", "Mezo MUSD", "s", "Buffer");

  await allocator.addPreset("Conservative", "d", 1, [flex, term], [7000, 2000]);
  await allocator.addPreset("Balanced", "d", 2, [flex, term, spv], [5000, 3000, 2000]);

  for (const u of [owner, alice, bob, carol]) await musd.mint(u, E(100000));
  await musd.mint(faucet, E(1000));

  await musd.approve(flex, E(1000));
  await flex.fundReserve(E(1000));
  await musd.approve(term, E(1000));
  await term.fundReserve(E(1000));

  return { owner, alice, bob, carol, musd, pf, st, tm, sp, ledger, fees, registry, flex, term, spv, allocator, faucet, alerts, lens };
}

module.exports = { deployFixture, E, DAY };
