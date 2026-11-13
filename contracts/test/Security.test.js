// Audit proof-of-concept tests. Each test asserts the SAFE behaviour, so it failed
// against the pre-audit contracts and now guards against regressions.
// Finding IDs match docs/SECURITY.md.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, E, DAY } = require("./fixture");

describe("Audit PoCs (regression)", () => {
  it("F-01 a stranger cannot extend someone else's Term lock by depositing for them", async () => {
    const { alice, bob, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(100));
    await term.connect(alice).deposit(E(100), alice);
    await time.increase(7 * DAY - 60); // alice is one minute from unlocking
    const before = await term.unlockAt(alice);
    await musd.connect(bob).approve(term, E(100));
    // bob gifts 100 MUSD to alice to push her unlock ~3.5 days out
    await expect(term.connect(bob).deposit(E(100), alice)).to.be.reverted;
    expect(await term.unlockAt(alice)).to.equal(before);
  });

  it("F-02 donating MUSD cannot inflate the share price to rob the next depositor", async () => {
    const { alice, bob, musd, flex } = await loadFixture(deployFixture);
    // attacker (bob) becomes the only holder, then shrinks supply to 1 wei of shares
    await musd.connect(bob).approve(flex, E(1));
    await flex.connect(bob).deposit(E(1), bob);
    await flex.connect(bob).redeem((await flex.balanceOf(bob)) - 1n, bob, bob);
    // donates 100 MUSD straight to the vault
    await musd.connect(bob).transfer(flex, E(100));
    // victim deposits 150 MUSD
    await musd.connect(alice).approve(flex, E(150));
    await flex.connect(alice).deposit(E(150), alice);
    const victimValue = await flex.convertToAssets(await flex.balanceOf(alice));
    expect(victimValue).to.be.closeTo(E(150), E(0.01));
  });

  it("F-03 a donation cannot inflate the reward drip paid from the reserve", async () => {
    const { alice, bob, musd, flex } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(flex, E(100));
    await flex.connect(alice).deposit(E(100), alice);
    await time.increase(30 * DAY);
    await musd.connect(bob).transfer(flex, E(10000)); // donation right before accrual
    await flex.poke();
    // 4.5% APR on 100 MUSD for 30 days ≈ 0.37 MUSD — not 4.5% on 10,100 MUSD (≈ 37)
    expect(await flex.totalRewardsPaid()).to.be.lt(E(0.4));
  });

  it("F-04 reallocate rejects unregistered vaults and never pays out more than it redeemed", async () => {
    const { owner, bob, musd, flex, allocator } = await loadFixture(deployFixture);
    await musd.connect(owner).transfer(allocator, E(50)); // stray MUSD sitting in the allocator
    const fake = await (await ethers.getContractFactory("FakeVault")).deploy();
    await fake.setFakeAssets(E(50));
    const before = await musd.balanceOf(bob);
    await expect(
      allocator.connect(bob).reallocate([await fake.getAddress()], [1n], [await flex.getAddress()], [0], 0)
    ).to.be.reverted;
    expect(await musd.balanceOf(bob)).to.equal(before);
  });

  it("F-05 raising the early-exit penalty does not hit people already locked", async () => {
    const { owner, alice, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(1000));
    await term.connect(alice).deposit(E(1000), alice);
    await term.connect(owner).setLockTerms(7 * DAY, 500); // 1.5% -> 5%
    const before = await musd.balanceOf(alice);
    await term.connect(alice).redeem(await term.balanceOf(alice), alice, alice);
    const got = (await musd.balanceOf(alice)) - before;
    // 1.5% penalty on 1000 => ~985.2 back; 5% would be ~952.4
    expect(got).to.be.gt(E(985));
  });

  it("F-06 a withdrawal-fee increase cannot front-run exits (it is time-locked)", async () => {
    const { owner, alice, musd, spv, fees } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(1000));
    await spv.connect(alice).deposit(E(1000), alice);
    await fees.connect(owner).setWithdrawalFee(spv, 200); // 0.10% -> 2%
    const before = await musd.balanceOf(alice);
    await spv.connect(alice).withdraw(E(50), alice, alice);
    const feeCharged = (await musd.balanceOf(fees)) ;
    expect((await musd.balanceOf(alice)) - before).to.equal(E(50));
    expect(feeCharged).to.be.lte(E(0.05)); // 0.10% of 50, not 2% (=1 MUSD)
  });

  it("F-07 transferring Stability Pool shares keeps the sender's earned BTC", async () => {
    const { alice, bob, musd, spv, sp } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(spv, E(1000));
    await spv.connect(alice).deposit(E(1000), alice);
    // liquidation: pool burns 10 MUSD of the vault's deposit and credits 1 BTC (not yet harvested)
    await sp.simulateLiquidation(spv, E(10), { value: E(1) });
    await spv.connect(alice).transfer(bob, await spv.balanceOf(alice));
    expect(await spv.pendingBtc(alice)).to.be.closeTo(E(1), E(0.000001));
    expect(await spv.pendingBtc(bob)).to.equal(0n);
    await expect(spv.connect(alice).claimBtc()).to.not.be.reverted;
  });

  it("F-08 ERC-4626 previews never promise more than a locked holder receives", async () => {
    const { alice, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(1000));
    await term.connect(alice).deposit(E(1000), alice);
    const shares = await term.balanceOf(alice);
    const preview = await term.previewRedeem(shares);
    const before = await musd.balanceOf(alice);
    await term.connect(alice).redeem(shares, alice, alice);
    const got = (await musd.balanceOf(alice)) - before;
    expect(preview).to.be.lte(got);
  });

  it("F-09 the activity ledger refuses amounts that would be silently truncated", async () => {
    const { owner, alice, ledger } = await loadFixture(deployFixture);
    await ledger.connect(owner).setWriter(owner, true);
    const huge = (1n << 128n) + 5n;
    await expect(ledger.connect(owner).record(alice, 0, alice, huge, 0, 0)).to.be.reverted;
  });

  it("F-10 announcements reject an unknown severity level", async () => {
    const { owner, registry } = await loadFixture(deployFixture);
    await expect(registry.connect(owner).announce(ethers.MaxUint256, 9, "t", "b")).to.be.reverted;
  });

  it("F-11 the last holder's rounding dust doesn't skew the next depositor's share price", async () => {
    const { alice, bob, musd, term } = await loadFixture(deployFixture);
    await musd.connect(alice).approve(term, E(100));
    await term.connect(alice).deposit(E(100), alice);
    await time.increase(8 * DAY); // unlocked, and the reserve has dripped interest
    await term.connect(alice).redeem(await term.balanceOf(alice), alice, alice);
    expect(await term.totalSupply()).to.equal(0n);
    await musd.connect(bob).approve(term, E(50));
    await term.connect(bob).deposit(E(50), bob);
    // a fresh vault prices shares 1:1; dust must not turn that into 1:2 or 1:3
    expect((await term.stats()).sharePrice).to.be.closeTo(E(1), E(0.000001));
  });
});
