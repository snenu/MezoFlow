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
  // Mezo Pools stand-ins: BTC / MEZO precompiles and the router
  const btc = await (await ethers.getContractFactory("MockToken")).deploy("BTC", "BTC");
  const mezo = await (await ethers.getContractFactory("MockToken")).deploy("MEZO", "MEZO");
  const factory = ethers.Wallet.createRandom().address;
  const router = await (await ethers.getContractFactory("MockRouter")).deploy(factory);
  await router.setRate(btc, musd, E(78000)); // 1 BTC = 78,000 MUSD
  await router.setRate(mezo, musd, E(0.7));
  await router.setRate(mezo, btc, E(0.00001));
  const zap = await (await ethers.getContractFactory("MezoFlowZap")).deploy(router, factory, musd, ledger, registry, allocator);

  const lens = await (await ethers.getContractFactory("MezoFlowLens")).deploy(
    musd, registry, ledger, fees, faucet, allocator, zap, btc, mezo
  );

  for (const w of [flex, term, spv, allocator, faucet, zap]) await ledger.setWriter(w, true);
  for (const v of [flex, term, spv]) await fees.setVault(v, true);
  await fees.setWithdrawalFee(spv, 10);
  await term.setRouter(allocator, true);
  await term.setRouter(zap, true);
  await allocator.setRouter(zap, true);

  await registry.addStrategy(flex, 1, 1, "Flexible Savings", "flexible-savings", "MezoFlow", "s", "Instant");
  await registry.addStrategy(term, 2, 2, "Term Savings", "term-savings", "MezoFlow", "s", "7d lock");
  await registry.addStrategy(spv, 3, 3, "Stability Pool", "stability-pool", "Mezo MUSD", "s", "Buffer");

  await allocator.addPreset("Conservative", "d", 1, [flex, term], [7000, 2000]);
  await allocator.addPreset("Balanced", "d", 2, [flex, term, spv], [5000, 3000, 2000]);

  for (const u of [owner, alice, bob, carol]) {
    await musd.mint(u, E(100000));
    await btc.mint(u, E(1));
    await mezo.mint(u, E(1000));
  }
  await musd.mint(faucet, E(1000));

  await musd.approve(flex, E(1000));
  await flex.fundReserve(E(1000));
  await musd.approve(term, E(1000));
  await term.fundReserve(E(1000));

  return {
    owner, alice, bob, carol, musd, pf, st, tm, sp, ledger, fees, registry, flex, term, spv,
    allocator, faucet, alerts, lens, btc, mezo, router, factory, zap,
  };
}

/// EIP-2612 permit signature in the shape the contracts take: { deadline, v, r, s }.
async function signPermit(token, owner, spender, value, deadline) {
  const { chainId } = await ethers.provider.getNetwork();
  const name = await token.name();
  deadline = deadline ?? BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);
  const nonce = await token.nonces(owner.address);
  const sig = await owner.signTypedData(
    { name, version: "1", chainId, verifyingContract: await token.getAddress() },
    {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { owner: owner.address, spender: typeof spender === "string" ? spender : await spender.getAddress(), value, nonce, deadline }
  );
  const { v, r, s } = ethers.Signature.from(sig);
  return { deadline, v, r, s };
}

const route = async (from, to, factory) => ({
  from: await from.getAddress(),
  to: await to.getAddress(),
  stable: false,
  factory,
});

module.exports = { deployFixture, signPermit, route, E, DAY };
