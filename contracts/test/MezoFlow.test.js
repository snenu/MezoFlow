const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployFixture, E, DAY } = require("./fixture");

describe("FlexibleSavingsVault", () => {
  it("deposits, accrues reserve yield at the published rate, withdraws", async () => {
    const { alice, musd, flex, ledger } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(flex, E(1000));
    await flex.connect(alice).deposit(E(1000), alice);
    expect(await flex.balanceOf(alice)).to.equal(E(1000));

    await time.increase(365 * DAY);
    const ta = await flex.totalAssets();
    // 4.5% APR on 1000 ≈ 45 MUSD (simple, single accrual)
    expect(ta).to.be.closeTo(E(1045), E(0.01));

    const before = await musd.balanceOf(alice);
    await flex.connect(alice).redeem(await flex.balanceOf(alice), alice, alice);
    const got = (await musd.balanceOf(alice)) - before;
    expect(got).to.be.closeTo(E(1045), E(0.01));

    const totals = await ledger.totals(alice);
    expect(totals.deposited).to.equal(E(1000));
    expect(totals.actions).to.equal(2n);
  });

  it("caps yield by the reserve", async () => {
    const { owner, alice, musd, flex } = await loadFixture(deployFixture);
    await flex.withdrawReserve(E(990), owner);
    await musd.connect(alice).approve(flex, E(10000));
    await flex.connect(alice).deposit(E(10000), alice);
    await time.increase(365 * DAY);
    expect(await flex.totalAssets()).to.equal(E(10010));
    const s = await flex.stats();
    expect(s.rewardReserve).to.equal(0n);
  });

  it("enforces min deposit and pause on deposits only", async () => {
    const { owner, alice, musd, flex } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(flex, E(100));
    await expect(flex.connect(alice).deposit(E(0.5), alice)).to.be.revertedWithCustomError(flex, "BelowMinDeposit");
    await flex.connect(alice).deposit(E(10), alice);
    await flex.connect(owner).pause();
    await expect(flex.connect(alice).deposit(E(10), alice)).to.be.reverted;
    await flex.connect(alice).redeem(await flex.balanceOf(alice), alice, alice); // exits still work
  });

  it("records checkpoints and rate history", async () => {
    const { owner, alice, musd, flex } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(flex, E(100));
    await flex.connect(alice).deposit(E(100), alice);
    await time.increase(DAY);
    await flex.poke();
    await flex.connect(owner).setRate(500);
    expect(await flex.checkpointCount()).to.be.gte(2n);
    const rh = await flex.getRateHistory();
    expect(rh.length).to.equal(2);
    expect(rh[1].rateBps).to.equal(500n);
  });

  it("records share transfers in the ledger", async () => {
    const { alice, bob, musd, flex, ledger } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(flex, E(100));
    await flex.connect(alice).deposit(E(100), alice);
    await flex.connect(alice).transfer(bob, E(40));
    const [bobEntries] = await ledger.getUserEntries(bob, 0, 10);
    expect(bobEntries[0].kind).to.equal(5n);
  });
});

describe("TermVault", () => {
  it("locks deposits, charges early-exit penalty into the reserve", async () => {
    const { alice, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(1000));
    await term.connect(alice).deposit(E(1000), alice);
    expect(await term.isLocked(alice)).to.equal(true);
    const reserveBefore = await term.rewardReserve();

    const info = await term.userInfo(alice);
    expect(info.exitFeeBps).to.equal(150n);

    const before = await musd.balanceOf(alice);
    await term.connect(alice).redeem(await term.balanceOf(alice), alice, alice);
    const got = (await musd.balanceOf(alice)) - before;
    // 1000 gross, penalty = 1000*150/10150 ≈ 14.78
    expect(got).to.be.closeTo(E(985.22), E(0.05));
    expect(await term.rewardReserve()).to.be.gt(reserveBefore);
  });

  it("no penalty after unlock, and blocks transfers while locked", async () => {
    const { alice, bob, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(1000));
    await term.connect(alice).deposit(E(1000), alice);
    await expect(term.connect(alice).transfer(bob, E(1))).to.be.revertedWithCustomError(term, "SharesLocked");
    await time.increase(7 * DAY + 1);
    expect(await term.isLocked(alice)).to.equal(false);
    const before = await musd.balanceOf(alice);
    await term.connect(alice).redeem(await term.balanceOf(alice), alice, alice);
    const got = (await musd.balanceOf(alice)) - before;
    expect(got).to.be.gt(E(1000)); // earned yield, no penalty
  });

  it("weights unlock time by position size", async () => {
    const { alice, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(2000));
    await term.connect(alice).deposit(E(1000), alice);
    const first = await term.unlockAt(alice);
    await time.increase(6 * DAY);
    await term.connect(alice).deposit(E(1000), alice);
    const second = await term.unlockAt(alice);
    const now = BigInt(await time.latest());
    // remaining ≈ (1000*1d + ~1000*7d)/~2000 ≈ 4 days
    expect(second - now).to.be.closeTo(BigInt(4 * DAY), BigInt(DAY / 4));
    expect(second).to.be.gt(first);
  });
});

describe("StabilityPoolVault", () => {
  it("routes deposits into the pool keeping a buffer", async () => {
    const { alice, musd, spv, sp } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(1000));
    await spv.connect(alice).deposit(E(1000), alice);
    expect(await sp.deposits(spv)).to.equal(E(900));
    expect(await musd.balanceOf(spv)).to.equal(E(100));
    expect(await spv.totalAssets()).to.equal(E(1000));
  });

  it("distributes BTC liquidation gains pro-rata and lets holders claim", async () => {
    const { alice, bob, musd, spv, sp } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(3000));
    await spv.connect(alice).deposit(E(3000), alice);
    await musd.connect(bob).approve(spv, E(1000));
    await spv.connect(bob).deposit(E(1000), bob);

    // liquidation: pool loses 100 MUSD, gains 0.0015 BTC (~110 USD at 73k)
    await sp.simulateLiquidation(spv, E(100), { value: E(0.0015) });

    const pa = await spv.pendingBtc(alice);
    const pb = await spv.pendingBtc(bob);
    expect(pa).to.be.closeTo(E(0.001125), 10n ** 9n);
    expect(pb).to.be.closeTo(E(0.000375), 10n ** 9n);
    expect(await spv.totalAssets()).to.equal(E(3900));

    const before = await ethers.provider.getBalance(alice);
    const tx = await spv.connect(alice).claimBtc();
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const after = await ethers.provider.getBalance(alice);
    expect(after - before + gas).to.be.closeTo(E(0.001125), 10n ** 9n);
    await expect(spv.connect(alice).claimBtc()).to.be.revertedWithCustomError(spv, "NothingToClaim");
  });

  it("new depositors do not dilute gains already earned", async () => {
    const { alice, carol, musd, spv, sp } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(1000));
    await spv.connect(alice).deposit(E(1000), alice);
    await sp.simulateLiquidation(spv, E(10), { value: E(0.001) });
    await musd.connect(carol).approve(spv, E(1000));
    await spv.connect(carol).deposit(E(1000), carol);
    expect(await spv.pendingBtc(carol)).to.equal(0n);
    expect(await spv.pendingBtc(alice)).to.be.closeTo(E(0.001), 10n ** 6n);
  });

  it("charges the disclosed 0.10% exit fee to the treasury", async () => {
    const { alice, musd, spv, fees } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(1000));
    await spv.connect(alice).deposit(E(1000), alice);
    await spv.connect(alice).withdraw(E(500), alice, alice);
    expect(await fees.totalFeesCollected()).to.equal(E(0.5));
    expect(await fees.treasuryBalance()).to.equal(E(0.5));
  });

  it("limits exits to the idle buffer while troves are under MCR", async () => {
    const { alice, musd, spv, tm } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(1000));
    await spv.connect(alice).deposit(E(1000), alice);
    await tm.setICR(E(1.05));
    expect(await spv.withdrawalsOpen()).to.equal(false);
    const maxW = await spv.maxWithdraw(alice);
    expect(maxW).to.be.closeTo(E(99.9), E(0.01));
    await expect(spv.connect(alice).withdraw(E(200), alice, alice)).to.be.revertedWithCustomError(spv, "ERC4626ExceededMaxWithdraw");
    await spv.connect(alice).withdraw(E(99), alice, alice);
    await tm.setICR(E(1.5));
    await spv.connect(alice).redeem(await spv.balanceOf(alice), alice, alice);
    expect(await spv.balanceOf(alice)).to.equal(0n);
  });

  it("reports pool health", async () => {
    const { spv } = await loadFixture(deployFixture);
    const h = await spv.spHealth();
    expect(h.btcPrice).to.equal(E(73000));
    expect(h.withdrawalsOpen).to.equal(true);
  });
});

describe("AutoAllocator", () => {
  it("splits a preset across vaults in one tx; remainder stays in wallet", async () => {
    const { alice, musd, allocator, flex, term, spv, ledger } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(allocator, E(1000));
    const bal0 = await musd.balanceOf(alice);
    await allocator.connect(alice).allocatePreset(E(1000), 1); // Balanced 50/30/20
    expect(await flex.balanceOf(alice)).to.equal(E(500));
    expect(await term.balanceOf(alice)).to.equal(E(300));
    expect(await spv.balanceOf(alice)).to.equal(E(200));
    expect(bal0 - (await musd.balanceOf(alice))).to.equal(E(1000));

    await musd.connect(alice).approve(allocator, E(1000));
    const bal1 = await musd.balanceOf(alice);
    await allocator.connect(alice).allocatePreset(E(1000), 0); // Conservative 70/20 (+10% kept)
    expect(bal1 - (await musd.balanceOf(alice))).to.equal(E(900));
    const plan = await allocator.plans(alice);
    expect(plan.presetId).to.equal(0n);
    expect((await ledger.totals(alice)).deposited).to.equal(E(1900));
  });

  it("rejects inactive vaults and over-weight splits", async () => {
    const { alice, musd, allocator, flex, term, registry } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(allocator, E(1000));
    await expect(allocator.connect(alice).allocate(E(100), [flex, term], [6000, 5000])).to.be.revertedWithCustomError(allocator, "WeightsTooHigh");
    await registry.setActive(0, false);
    await expect(allocator.connect(alice).allocate(E(100), [flex], [10000])).to.be.revertedWithCustomError(allocator, "InactiveVault");
  });

  it("reallocates an existing position atomically", async () => {
    const { alice, musd, allocator, flex, spv } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(flex, E(1000));
    await flex.connect(alice).deposit(E(1000), alice);
    const shares = await flex.balanceOf(alice);
    await flex.connect(alice).approve(allocator, shares);
    await allocator.connect(alice).reallocate([flex], [shares], [spv], [10000], 4294967295n);
    expect(await flex.balanceOf(alice)).to.equal(0n);
    expect(await spv.totalAssets()).to.be.closeTo(E(1000), E(0.01));
  });
});

describe("Faucet, alerts, registry, lens", () => {
  it("faucet rate-limits per address", async () => {
    const { alice, faucet, musd } = await loadFixture(deployFixture);
    await faucet.connect(alice).claim();
    await expect(faucet.connect(alice).claim()).to.be.revertedWithCustomError(faucet, "CoolingDown");
    await time.increase(DAY);
    await faucet.connect(alice).claim();
    expect(await faucet.totalClaimed()).to.equal(E(40));
    void musd;
  });

  it("alert preferences round-trip with defaults", async () => {
    const { alice, alerts } = await loadFixture(deployFixture);
    const [d, isDefault] = await alerts.getPreferences(alice);
    expect(isDefault).to.equal(true);
    expect(d.minIcrBps).to.equal(11500n);
    await alerts.connect(alice).setPreferences(3, 100, 2, 30, 12000);
    const [p, def2] = await alerts.getPreferences(alice);
    expect(def2).to.equal(false);
    expect(p.mask).to.equal(3n);
    expect(await alerts.subscriberCount()).to.equal(1n);
  });

  it("registry announcements are newest-first and lens aggregates everything", async () => {
    const { owner, alice, musd, registry, lens, flex } = await loadFixture(deployFixture);
    await registry.announce(ethers.MaxUint256, 0, "Hello", "World");
    await registry.announce(2, 2, "SP notice", "Body");
    const ann = await registry.getAnnouncements(0, 10);
    expect(ann[0].title).to.equal("SP notice");

    await musd.connect(alice).approve(flex, E(100));
    await flex.connect(alice).deposit(E(100), alice);
    const [p, s, a] = await lens.getAll(alice);
    expect(p.strategyCount).to.equal(3n);
    expect(p.tvl).to.equal(E(100));
    expect(s[0].user.shares).to.equal(E(100));
    expect(a.deposited).to.equal(E(100));
    void owner;
  });

  it("only writers can record to the ledger", async () => {
    const { alice, ledger } = await loadFixture(deployFixture);
    await expect(ledger.connect(alice).record(alice, 0, alice, 1, 1, 0)).to.be.revertedWithCustomError(ledger, "NotWriter");
  });
});
