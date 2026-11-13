const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, signPermit, route, E, DAY } = require("./fixture");

const deadline = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600);

describe("Permits (one-transaction actions)", () => {
  it("depositWithPermit deposits with no prior approve", async () => {
    const { alice, musd, flex } = await loadFixture(deployFixture);
    expect(await musd.allowance(alice, flex)).to.equal(0n);
    const sig = await signPermit(musd, alice, flex, E(250));
    await flex.connect(alice).depositWithPermit(E(250), alice, sig);
    expect(await flex.convertToAssets(await flex.balanceOf(alice))).to.be.closeTo(E(250), 1n);
    expect(await musd.allowance(alice, flex)).to.equal(0n);
  });

  it("a front-run permit does not block the deposit (hardening H-01)", async () => {
    const { alice, bob, musd, flex } = await loadFixture(deployFixture);
    const sig = await signPermit(musd, alice, flex, E(100));
    // bob copies alice's signature from the mempool and submits it first
    await musd.connect(bob).permit(alice, flex, E(100), sig.deadline, sig.v, sig.r, sig.s);
    await expect(flex.connect(alice).depositWithPermit(E(100), alice, sig)).to.not.be.reverted;
    expect(await flex.balanceOf(alice)).to.be.gt(0n);
  });

  it("an invalid permit with no allowance reverts with PermitFailed", async () => {
    const { alice, bob, musd, flex } = await loadFixture(deployFixture);
    const sig = await signPermit(musd, bob, flex, E(100)); // signed by the wrong account
    await expect(flex.connect(alice).depositWithPermit(E(100), alice, sig)).to.be.revertedWithCustomError(
      flex,
      "PermitFailed"
    );
  });

  it("fundReserveWithPermit tops up the reward reserve", async () => {
    const { alice, musd, term } = await loadFixture(deployFixture);
    const before = await term.rewardReserve();
    await term.connect(alice).fundReserveWithPermit(E(40), await signPermit(musd, alice, term, E(40)));
    expect(await term.rewardReserve()).to.be.closeTo(before + E(40), E(0.001));
  });

  it("allocatePresetWithPermit splits a preset in one transaction", async () => {
    const { alice, musd, allocator, flex, term, spv } = await loadFixture(deployFixture);
    const sig = await signPermit(musd, alice, allocator, E(1000));
    const before = await musd.balanceOf(alice);
    await allocator.connect(alice).allocatePresetWithPermit(E(1000), 1, sig);
    expect(before - (await musd.balanceOf(alice))).to.equal(E(1000));
    expect(await flex.convertToAssets(await flex.balanceOf(alice))).to.be.closeTo(E(500), 1n);
    expect(await term.convertToAssets(await term.balanceOf(alice))).to.be.closeTo(E(300), 1n);
    expect(await spv.convertToAssets(await spv.balanceOf(alice))).to.be.closeTo(E(200), 1n);
  });

  it("allocateWithPermit runs a custom split", async () => {
    const { alice, musd, allocator, flex } = await loadFixture(deployFixture);
    const sig = await signPermit(musd, alice, allocator, E(100));
    await allocator.connect(alice).allocateWithPermit(E(100), [flex], [8000], sig);
    expect(await flex.convertToAssets(await flex.balanceOf(alice))).to.be.closeTo(E(80), 1n);
    const plan = await allocator.plans(alice);
    expect(plan.presetId).to.equal(2n ** 32n - 1n);
  });

  it("reallocateWithPermit moves a position using vault-share permits", async () => {
    const { alice, musd, allocator, flex, spv } = await loadFixture(deployFixture);
    await flex.connect(alice).depositWithPermit(E(500), alice, await signPermit(musd, alice, flex, E(500)));
    const shares = await flex.balanceOf(alice);
    const shareSig = await signPermit(flex, alice, allocator, shares);
    await allocator.connect(alice).reallocateWithPermit([flex], [shares], [shareSig], [spv], [10000], 0);
    expect(await flex.balanceOf(alice)).to.equal(0n);
    expect(await spv.convertToAssets(await spv.balanceOf(alice))).to.be.closeTo(E(500), E(0.01));
  });

  it("only owner-approved routers can allocate for someone else", async () => {
    const { alice, allocator } = await loadFixture(deployFixture);
    await expect(allocator.connect(alice).allocatePresetFor(E(10), 0, alice)).to.be.revertedWithCustomError(
      allocator,
      "NotRouter"
    );
  });
});

describe("MezoFlowZap (Mezo Pools)", () => {
  it("quotes and swaps BTC to MUSD with a BTC permit, recording the swap", async () => {
    const { alice, btc, musd, zap, factory, ledger } = await loadFixture(deployFixture);
    const r = [await route(btc, musd, factory)];
    expect(await zap.quote(r, E(0.001))).to.equal(E(78));
    const sig = await signPermit(btc, alice, zap, E(0.001));
    const before = await musd.balanceOf(alice);
    await zap.connect(alice).swapWithPermit(r, E(0.001), E(77), await deadline(), sig);
    expect((await musd.balanceOf(alice)) - before).to.equal(E(78));
    const [entries] = await ledger.getUserEntries(alice, 0, 1);
    expect(entries[0].kind).to.equal(9n);
    expect(entries[0].assets).to.equal(E(78));
    expect(entries[0].vault).to.equal(await btc.getAddress());
    expect(await zap.swapCount()).to.equal(1n);
  });

  it("swaps BTC straight into a Term vault position in one transaction", async () => {
    const { alice, btc, musd, zap, term, factory } = await loadFixture(deployFixture);
    const r = [await route(btc, musd, factory)];
    const sig = await signPermit(btc, alice, zap, E(0.002));
    await zap.connect(alice).swapAndDepositWithPermit(r, E(0.002), E(150), term, await deadline(), sig);
    expect(await term.convertToAssets(await term.balanceOf(alice))).to.be.closeTo(E(156), 1n);
    expect(await term.unlockAt(alice)).to.be.gt(0n);
    expect(await musd.balanceOf(zap)).to.equal(0n);
  });

  it("swaps MEZO into a preset; the unallocated part lands in the wallet", async () => {
    const { alice, mezo, musd, zap, flex, factory } = await loadFixture(deployFixture);
    const r = [await route(mezo, musd, factory)];
    const sig = await signPermit(mezo, alice, zap, E(100)); // 100 MEZO -> 70 MUSD
    const before = await musd.balanceOf(alice);
    await zap.connect(alice).swapAndAllocateWithPermit(r, E(100), E(69), 0, await deadline(), sig);
    // Conservative = 70% flexible + 20% term, 10% stays in the wallet
    expect(await flex.convertToAssets(await flex.balanceOf(alice))).to.be.closeTo(E(49), 1n);
    expect((await musd.balanceOf(alice)) - before).to.equal(E(7));
    expect(await musd.balanceOf(zap)).to.equal(0n);
  });

  it("supports multi-hop routes that end in MUSD", async () => {
    const { alice, mezo, btc, musd, zap, factory } = await loadFixture(deployFixture);
    const r = [await route(mezo, btc, factory), await route(btc, musd, factory)];
    await mezo.connect(alice).approve(zap, E(100));
    const before = await musd.balanceOf(alice);
    await zap.connect(alice).swap(r, E(100), 1n, await deadline());
    expect((await musd.balanceOf(alice)) - before).to.equal(E(78)); // 100 MEZO -> 0.001 BTC -> 78 MUSD
  });

  it("rejects bad routes, foreign factories, inactive vaults and slippage", async () => {
    const { owner, alice, btc, mezo, musd, zap, factory, registry, flex } = await loadFixture(deployFixture);
    await btc.connect(alice).approve(zap, E(1));
    const dl = await deadline();
    // does not end in MUSD
    await expect(zap.connect(alice).swap([await route(mezo, btc, factory)], E(0.001), 0, dl)).to.be.revertedWithCustomError(zap, "InvalidRoute");
    // not Mezo's pool factory
    const foreign = { ...(await route(btc, musd, factory)), factory: owner.address };
    await expect(zap.connect(alice).swap([foreign], E(0.001), 0, dl)).to.be.revertedWithCustomError(zap, "InvalidRoute");
    // broken hop chain
    await expect(
      zap.connect(alice).swap([await route(mezo, btc, factory), await route(mezo, musd, factory)], E(1), 0, dl)
    ).to.be.revertedWithCustomError(zap, "InvalidRoute");
    // slippage guard (router enforces amountOutMin)
    await expect(zap.connect(alice).swap([await route(btc, musd, factory)], E(0.001), E(79), dl)).to.be.reverted;
    // retired vault
    await registry.connect(owner).setActive(0, false);
    await expect(
      zap.connect(alice).swapAndDeposit([await route(btc, musd, factory)], E(0.001), 0, flex, dl)
    ).to.be.revertedWithCustomError(zap, "InactiveVault");
  });

  it("the lens reports nonces, MEZO balance and zap allowances", async () => {
    const { alice, btc, zap, lens } = await loadFixture(deployFixture);
    await btc.connect(alice).approve(zap, E(0.5));
    const a = await lens.getAccount(alice);
    expect(a.mezoBalance).to.equal(E(1000));
    expect(a.btcAllowanceToZap).to.equal(E(0.5));
    expect(a.musdNonce).to.equal(0n);
    const p = await lens.getProtocol();
    expect(p.swapCount).to.equal(0n);
  });
});

describe("Accounting hardening", () => {
  it("skim sweeps donated MUSD into the reward reserve", async () => {
    const { alice, bob, musd, flex } = await loadFixture(deployFixture);
    await flex.connect(alice).depositWithPermit(E(100), alice, await signPermit(musd, alice, flex, E(100)));
    const reserve = await flex.rewardReserve();
    await musd.connect(bob).transfer(flex, E(30));
    await flex.skim();
    expect(await flex.rewardReserve()).to.be.closeTo(reserve + E(30), E(0.001));
    expect(await flex.convertToAssets(await flex.balanceOf(alice))).to.be.closeTo(E(100), E(0.001));
  });

  it("a scheduled fee increase applies only after the delay; decreases are immediate", async () => {
    const { owner, alice, musd, spv, fees } = await loadFixture(deployFixture);
    await spv.connect(alice).depositWithPermit(E(100), alice, await signPermit(musd, alice, spv, E(100)));
    await fees.connect(owner).setWithdrawalFee(spv, 50);
    expect(await fees.withdrawalFeeBps(spv)).to.equal(10n);
    await time.increase(2 * DAY);
    expect(await fees.withdrawalFeeBps(spv)).to.equal(50n);
    await fees.connect(owner).setWithdrawalFee(spv, 0);
    expect(await fees.withdrawalFeeBps(spv)).to.equal(0n);
  });

  it("a lower early-exit penalty applies to existing holders", async () => {
    const { owner, alice, musd, term } = await loadFixture(deployFixture);
    await term.connect(alice).depositWithPermit(E(1000), alice, await signPermit(musd, alice, term, E(1000)));
    await term.connect(owner).setLockTerms(7 * DAY, 50); // 1.5% -> 0.5%
    expect(await term.penaltyFor(alice)).to.equal(50n);
  });

  it("invariant: vault MUSD balance always covers idle assets + reserve (seeded fuzz)", async () => {
    const { alice, bob, carol, musd, flex, term, spv, sp } = await loadFixture(deployFixture);
    const users = [alice, bob, carol];
    const vaults = [flex, term, spv];
    for (const u of users) for (const v of vaults) await musd.connect(u).approve(v, ethers.MaxUint256);
    let seed = 1337;
    const rnd = (n) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 120; i++) {
      const u = users[rnd(3)];
      const v = vaults[rnd(3)];
      const op = rnd(5);
      if (op <= 1) {
        await v.connect(u).deposit(E(1 + rnd(500)), u);
      } else if (op === 2) {
        const sh = await v.balanceOf(u);
        const max = await v.maxRedeem(u);
        const amt = sh < max ? sh : max;
        if (amt > 0n) await v.connect(u).redeem(amt / BigInt(1 + rnd(3)), u, u);
      } else if (op === 3) {
        await time.increase(1 + rnd(5) * DAY);
        await v.poke();
      } else if (rnd(4) === 0 && (await sp.getCompoundedMUSDDeposit(spv)) > E(5)) {
        await sp.simulateLiquidation(spv, E(1), { value: E(0.01) });
      } else {
        await musd.connect(u).transfer(v, E(rnd(3))); // stray donation
      }
      for (const vv of vaults) {
        const bal = await musd.balanceOf(vv);
        expect(bal).to.be.gte((await vv.idleAssets()) + (await vv.rewardReserve()));
      }
      const btcHeld = await ethers.provider.getBalance(spv);
      expect(btcHeld).to.be.gte(await spv.btcReserved());
    }
  });
});
