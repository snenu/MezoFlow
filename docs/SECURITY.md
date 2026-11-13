# MezoFlow security review

This is an internal review of every MezoFlow contract, done before the v2 deployment on Mezo Testnet. It is not a third-party audit. All contracts hold test funds only.

- **Scope:** `contracts/contracts/` — `MezoFlowVault` (base), `FlexibleSavingsVault`, `TermVault`, `StabilityPoolVault`, `AutoAllocator`, `MezoFlowZap`, `FeeManager`, `StrategyRegistry`, `ActivityLedger`, `AlertCenter`, `MUSDFaucet`, `MezoFlowLens`, `libraries/SafePermit`.
- **Compiler:** Solidity 0.8.28, `evmVersion: london`, optimizer 200 runs, `viaIR`. OpenZeppelin pinned to 5.1.0 (5.2+ emits `mcopy`, which Mezo does not support).
- **Result:** 10 findings (0 critical, 0 high, 6 medium, 3 low, 1 informational), all fixed. Each has a proof-of-concept test that failed against the pre-audit code and now runs as a regression test.
- **Tests:** 49 passing (`cd contracts && npx hardhat test`): 21 behaviour tests, 10 audit regressions, 18 tests for the new permit / zap / accounting code including a seeded invariant fuzz.

## Method

1. Listed every external and public function and who may call it.
2. Traced every money path: MUSD in (deposit, mint, fund reserve, allocate, swap), MUSD out (withdraw, redeem, reserve withdrawal, fee transfer, faucet, allocator remainder), BTC in (Stability Pool gains, swaps) and BTC out (claims).
3. Wrote down the state each path changes and the invariant it must keep, then tried to break it: donations, rounding, reentrancy through token and BTC callbacks, caller-supplied addresses, owner front-running, transfers between holders, and permit replay or front-running.
4. For each issue: wrote a failing test first ([`docs/audit/poc-before-fix.txt`](audit/poc-before-fix.txt) is the captured output), fixed it, and kept the test.

## Findings

| ID | Severity | Contract | Finding | Status |
|---|---|---|---|---|
| F-01 | Medium | TermVault | Anyone could extend someone else's lock | Fixed |
| F-02 | Medium | All vaults | Donations could inflate the share price and rob the next depositor | Fixed |
| F-03 | Low | All vaults | Donations inflated the reward drip paid from the reserve | Fixed |
| F-04 | Medium | AutoAllocator | `reallocate` trusted any address and its return value | Fixed |
| F-05 | Medium | TermVault | Raising the early-exit penalty hit people already locked | Fixed |
| F-06 | Medium | FeeManager | The owner could front-run exits with a fee increase | Fixed |
| F-07 | Medium | StabilityPoolVault | Transferring shares handed the sender's earned BTC to the recipient | Fixed |
| F-08 | Low | TermVault | ERC-4626 previews over-promised to locked holders | Fixed |
| F-09 | Low | ActivityLedger | Amounts were silently truncated to `uint128` | Fixed |
| F-10 | Info | StrategyRegistry | Announcements accepted any severity value | Fixed |

### F-01 · Medium · Anyone could extend someone else's Term lock

**What happened.** `TermVault` re-weights a holder's unlock time on every deposit into their position, and ERC-4626 lets anyone deposit for any `receiver`. A stranger could deposit 1 MUSD "for" a holder a minute before their unlock and push it out by hours or days. The holder then had to wait again or pay the early-exit penalty.

**Proof.** `F-01` in [`test/Security.test.js`](../contracts/test/Security.test.js): Bob's deposit for Alice succeeded and moved her `unlockAt`.

**Fix.** Only the holder, or an owner-approved router acting for its own caller (`AutoAllocator`, `MezoFlowZap`), can add to a Term position. Other third-party deposits revert with `ThirdPartyDeposit`. Both routers always pass their own `msg.sender` as the beneficiary.

### F-02 · Medium · Donations could inflate the share price

**What happened.** Vaults valued shares with `MUSD.balanceOf(vault) - rewardReserve`. A holder could redeem down to 1 wei of shares, send MUSD straight to the vault, and make the next depositor's shares round down. In the PoC the victim deposited 150 MUSD and was left with 125.

**Fix.** Vaults track depositor MUSD in `idleAssets` and never read `balanceOf` for share pricing. The Stability Pool vault credits exactly what the pool returns, measured by balance difference. Stray MUSD can be moved into the reward reserve with `skim()`, where it is paid out to holders over time.

### F-03 · Low · Donations inflated the reward drip

**What happened.** The reserve drip is `assets × rate × time`. Because assets came from `balanceOf`, a large donation just before an accrual made the reserve pay interest on money that was never deposited: 37 MUSD instead of 0.37 in the PoC. The donor needed to own most shares to profit, but the reserve was drained either way.

**Fix.** Same as F-02: the drip uses tracked `idleAssets`.

### F-04 · Medium · `reallocate` trusted any vault address

**What happened.** `AutoAllocator.reallocate` called `redeem()` on caller-supplied addresses and trusted the returned amount. A fake "vault" that returned 50e18 without sending anything let the caller walk away with any MUSD sitting in the allocator. It also wrote a false amount into the activity ledger.

**Fix.** Source vaults must be registered in `StrategyRegistry`. Retired strategies are still accepted so exits keep working. The moved amount is the allocator's measured MUSD balance change.

### F-05 · Medium · Penalty increases applied to people already locked

**What happened.** `setLockTerms` changed the penalty for everyone at once. The owner could raise it from 1.5% to the 5% cap and front-run a locked holder's exit.

**Fix.** Each holder's penalty is snapshotted when they deposit. They pay `min(own snapshot, current penalty)`, so later increases never apply to them and decreases always do.

### F-06 · Medium · Fee increases could front-run exits

**What happened.** `FeeManager.setWithdrawalFee` applied instantly. The owner could raise the Stability Pool vault's exit fee from 0.10% to the 2% cap just before a withdrawal.

**Fix.** On a vault that has depositors, an increase is scheduled and takes effect after `FEE_INCREASE_DELAY` (2 days), so holders can leave at the old fee. Decreases, and settings made before anyone deposits, are immediate. `withdrawalFeeBps(vault)` always returns the fee in force.

### F-07 · Medium · Share transfers moved the sender's BTC

**What happened.** BTC liquidation gains sit inside Mezo's Stability Pool until the vault harvests them, and they are then split across whoever holds shares. A transfer before the next harvest handed the sender's earned BTC to the recipient.

**Fix.** A share transfer harvests pending pool gains and settles both parties before balances change.

### F-08 · Low · Previews over-promised to locked holders

**What happened.** `previewRedeem` and `previewWithdraw` ignored the Term early-exit penalty. A locked holder, or an integrator, was shown more than an exit would actually pay, which breaks the ERC-4626 rule that previews never over-promise.

**Fix.** The owner-agnostic previews assume the penalty. `previewRedeemFor` and `previewWithdrawFor` give exact per-holder numbers, and the app uses those.

### F-09 · Low · Ledger amounts silently truncated

`ActivityLedger` cast amounts to `uint128` without checking. It now uses `SafeCast`, so an out-of-range value reverts instead of being recorded wrongly.

### F-10 · Info · Unbounded announcement severity

`announce` accepted any `uint8` severity, but the app only understands levels 0–3. Values above 3 now revert with `InvalidSeverity`.

## Hardening in new v2 code

These protections were built into the new permit and swap code from the start, so there is no pre-audit version to fail against. Each one has its own test.

| ID | Where | Protection | Test |
|---|---|---|---|
| H-01 | `SafePermit` | A permit signature is public once it is in the mempool, and anyone can submit it first, which makes the user's own `permit` call revert. `SafePermit` catches that and continues when the allowance is already in place. | "a front-run permit does not block the deposit" |
| H-02 | `MezoFlowZap` | Routes must start from a non-MUSD token, end in MUSD, chain hop to hop, use at most 3 hops, and use only Mezo's own pool factory. | "rejects bad routes, foreign factories…" |
| H-03 | `MezoFlowZap` | The output is the zap's measured MUSD balance change, never the router's return value, and it is checked against the caller's `minMusdOut`. The deadline is passed through to the router. | "quotes and swaps BTC to MUSD…" |
| H-04 | `MezoFlowZap` | The zap is ownerless and holds nothing between transactions. It always deposits or allocates for `msg.sender`, approves exact amounts and resets the allocator approval to zero. | "the unallocated part lands in the wallet" checks the zap's balance is 0 |
| H-05 | `AutoAllocator` | `allocatePresetFor` can only be called by owner-approved routers. | "only owner-approved routers can allocate for someone else" |
| H-06 | All | `nonReentrant` on every function that moves MUSD or BTC. BTC claims follow checks-effects-interactions before the native transfer. | covered by the fuzz below |

**Invariant fuzz.** A seeded run of 120 random deposits, redeems, time jumps, liquidations and stray donations across all three vaults and three users checks, after every step, that:
- each vault's MUSD balance is at least `idleAssets + rewardReserve`;
- the Stability Pool vault's BTC balance is at least `btcReserved`.

## Owner powers (trust assumptions)

The deployer key owns the vaults, registry, allocator, fee manager and faucet. The owner **cannot** move depositor principal. It can:

| Power | Limit |
|---|---|
| Pause deposits | Withdrawals can never be paused |
| Set a savings rate | Capped at 20% APR; paid only from the visible reward reserve |
| Withdraw the reward reserve | Reserve only, never `idleAssets` or pool deposits |
| Change Term lock and penalty | Penalty capped at 5%; never higher than a holder's deposit-time snapshot |
| Raise an exit fee | Capped at 2%; 2-day delay on live vaults |
| Retire a strategy or preset | Exits from retired vaults keep working, including via `reallocate` |
| Approve routers | Only routers that pass their own caller as the beneficiary should be approved; today that is the allocator and the zap |

On mainnet these powers would sit behind a multisig and a timelock. On testnet they are held by a single EOA.

## What a contract can't prevent

- **Mezo protocol rules.** Mezo's Stability Pool blocks withdrawals while any trove is below 110% collateral. The vault keeps a 10% idle buffer, but larger exits wait until the pool reopens. This is surfaced live in the app.
- **Liquidation and BTC price risk.** Stability Pool deposits are converted to BTC during liquidations. If BTC falls before you claim, you can end up with less value than you deposited.
- **Swap prices.** Mezo Pools on testnet are thin, and the pool price can drift from the Mezo oracle (the app shows the gap). The zap enforces your minimum output and a deadline, but it can't make a thin pool deep.
- **Finite rewards.** Savings rates are paid from an on-chain reserve. When it runs out, the rate is effectively zero. The app shows each reserve's remaining runway.
- **Key and wallet security.** Permits are scoped to an exact amount, spender and deadline, but a user who signs a malicious permit on another site can still lose tokens.
- **Activity spam.** Anyone can send dust vault shares to an address, which adds "shares received" entries to its history. Balances are unaffected.
- **BTC arriving while a vault is empty.** BTC that reaches the Stability Pool vault while it has no shares outstanding goes to the next depositor.
- **Faucet sybils.** The test MUSD faucet is rate-limited per address only.

## Reproduce

```bash
cd contracts
npm install
npx hardhat test                       # 49 passing
npx hardhat test test/Security.test.js # the 10 audit regressions
```

To watch the proofs fail, check out the commit before the fixes (`git log --oneline -- contracts/test/Security.test.js`, the first "test(audit)" commit) and run the same file.
