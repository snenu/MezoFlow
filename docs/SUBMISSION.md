# AKINDO submission answers

Ready to paste. AKINDO's exact field names vary between forms, so each answer is grouped under the question it fits. Team details are left for you to fill in.

---

## Project name

MezoFlow

## One-line description

A money manager for MUSD on Mezo: save, earn BTC in the Stability Pool, or swap BTC straight into a strategy, with one signature and one transaction.

## Links

- **Live app:** https://mezoflow.vercel.app
- **GitHub:** https://github.com/snenu/MezoFlow
- **Demo video:** https://github.com/snenu/MezoFlow/blob/main/docs/demo/mezoflow-demo.mp4
- **Security review:** https://github.com/snenu/MezoFlow/blob/main/docs/SECURITY.md
- **Health check:** https://mezoflow.vercel.app/api/health

## Track

Pick the form's track closest to **DeFi / MUSD utility**. MezoFlow is a consumer-facing money app built entirely around MUSD.

## Description

MezoFlow gives MUSD holders somewhere useful to put their dollars, and shows them exactly where every MUSD is.

There are three strategies, each its own ERC-4626 vault over real testnet MUSD:

- **Flexible Savings:** withdraw any time, 4.50% APR from an on-chain reward reserve.
- **Term Savings:** 8.00% APR for a 7-day lock. A 1.5% early-exit penalty goes back to the reserve for the holders who stay.
- **Stability Pool:** deposits into Mezo's official MUSD Stability Pool and shares the BTC earned from liquidations.

On top of the vaults:

- **Auto allocator.** Splits one deposit across strategies using Conservative, Balanced or Growth plans stored on-chain, and can move an existing position to another plan in one step.
- **Get MUSD.** Swaps BTC or MEZO to MUSD through Mezo Pools and can send it straight into a strategy or plan in the same transaction. A new user can go from the Mezo faucet to a funded position with one signature.
- **Risk dashboard.** Reads Mezo's oracle, the weakest trove and the Stability Pool's state live. It shows plainly whether pool withdrawals are open and how long each reward reserve will last.
- **On-chain history.** Every action goes into an on-chain activity ledger. The portfolio chart, activity page, CSV export and alerts are all rebuilt from it, so there is no database.
- **Ask Flow.** An assistant that answers questions from the same chain data. It cannot move funds.

## The problem

MUSD lets Bitcoin holders borrow dollars without selling their BTC. Once they hold those dollars, though, they have few simple, transparent places to put them on Mezo. The best on-chain option, the Stability Pool, has rules most people don't know about. Withdrawals pause whenever any trove falls below 110% collateral, and returns arrive in BTC, not MUSD.

Getting started also costs extra steps: approve, then deposit; swap, then approve, then deposit.

## The solution

MezoFlow does each of these in one transaction and explains the trade-offs in plain English, right next to the return:

- **Every deposit is a single transaction.** It uses EIP-2612 permits for MUSD, for vault shares, and for Mezo's BTC and MEZO tokens.
- **BTC becomes a position in one step.** `MezoFlowZap` swaps through Mezo Pools and deposits or allocates in the same transaction, with slippage and deadline protection.
- **Nothing is hidden.** Each strategy shows its rate, where the return comes from, how withdrawals work, its risk score, and its reserve runway. The Stability Pool page shows live whether exits are open.
- **Nothing is off-chain.** Positions, history, alert preferences, strategy listings and announcements all live in contracts.

## How it uses Mezo and MUSD

- **MUSD is the unit of account.** Every vault, fee, reward, chart and balance is denominated in MUSD (`0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`).
- **MUSD permit.** `depositWithPermit`, `allocatePresetWithPermit`, `allocateWithPermit` and `fundReserveWithPermit` turn approve-then-deposit into one transaction.
- **BTC and MEZO permits.** MezoFlow recovered the EIP-712 domains of Mezo's BTC and MEZO precompile tokens, so swaps pull tokens with a signature instead of an approval.
- **Mezo Pools.** `MezoFlowZap` quotes and swaps through Mezo's router, with Mezo's pool factory pinned. Over the testnet runs it has handled 13 swaps; the live count is at `/api/health`.
- **Mezo Stability Pool.** `StabilityPoolVault` calls `provideToSP` and `withdrawFromSP`, harvests BTC gains, keeps a 10% idle buffer, and follows Mezo's 110% rule.
- **Mezo's price and trove data.** The PriceFeed, TroveManager and SortedTroves contracts feed the risk dashboard, alerts and Ask Flow.
- **Mezo Testnet.** All 11 contracts are deployed and verified on the Mezo explorer, compiled for Mezo's `london` EVM target.

## Technical details

- **Contracts.** Solidity 0.8.28 (london target), Hardhat, OpenZeppelin 5.1. There are 11 contracts: three ERC-4626 vaults with ERC20Permit shares, AutoAllocator, MezoFlowZap, ActivityLedger, StrategyRegistry, FeeManager, AlertCenter, MUSDFaucet and MezoFlowLens.
- **Frontend.** Next.js 16, wagmi 2, viem, Tailwind 4, deployed on Vercel. Reads are batched through one Lens call. Gas estimates are padded per function.
- **Tests.** 50 Hardhat tests, including 11 audit regressions and a 120-step invariant fuzz.
- **End-to-end.** A Playwright test drives the live site with a real testnet wallet: 20/20 checks passed and 11 transactions were confirmed on the explorer. Three seeded wallets made 28 more transactions, and the demo video made 6.
- **Security.** An internal review found 11 issues (6 medium, 4 low, 1 informational). All are fixed, each with a proof-of-concept test that failed before the fix. See `docs/SECURITY.md`.

## Contract addresses (Mezo Testnet, chain 31611)

| Contract | Address |
|---|---|
| FlexibleSavingsVault | `0x914bCE915DFaE6Bdd9d6773829E82909F36a2F84` |
| TermVault | `0x2EeBD6785AB282A07b20A4b1DdF73B126662F844` |
| StabilityPoolVault | `0xB57e3573E5eadF4468972B043C1E164d16aB2fA3` |
| MezoFlowZap | `0xebB377E8519d5B5125C33E31231cEbC3BB73Bfc3` |
| AutoAllocator | `0xf3DD9838269aFf50a5E702b71Da60ad5fE92B82B` |
| ActivityLedger | `0x8aE22979669d93B106304700B27657Fe2814Bd4a` |
| StrategyRegistry | `0xE496A7b6eA9D33f967d654428a23c906ed7D9C0D` |
| FeeManager | `0x836D0c8e9aAaF425e892c0c76A93e058C17Da9e2` |
| AlertCenter | `0xE25AC0100B76d154d44B1883CA15a2aAe90793cF` |
| MUSDFaucet | `0x217522c6C7d434E96034484e5f38c71a0747Cb56` |
| MezoFlowLens | `0x548D3c642e39593c7D31F3C678878a3dB859F5dd` |

## How to test it (for judges)

1. Get testnet BTC at https://faucet.test.mezo.org.
2. Open https://mezoflow.vercel.app/app/swap and connect your wallet.
3. Enter 0.0005 BTC, choose **Balanced plan**, and click **Swap and allocate**. That is one signature and one transaction.
4. Check **Overview**, **Activity** (with explorer links) and **Risk**.
5. Withdraw from **Flexible Savings** at any time.

If you have no BTC, the **Get 10 test MUSD** button claims from MezoFlow's faucet.

## Challenges

- **OpenZeppelin version.** OpenZeppelin 5.2+ emits `mcopy`, which Mezo's `london` target rejects. We pinned 5.1.0 and kept every contract under the 24 KB size limit.
- **BTC and MEZO permit domains.** Mezo's BTC and MEZO tokens support permit but don't publish their EIP-712 domain. We derived the domains from `DOMAIN_SEPARATOR`.
- **Stability Pool rule.** Mezo blocks pool withdrawals while any trove is under 110% collateral. The vault keeps an idle buffer, and the app checks the weakest trove live so users know before they try.
- **Gas estimates.** `eth_estimateGas` underestimates nested calls (permit, then swap, then deposit), so the app pads estimates with per-function floors.
- **Security.** Our own review found real issues: lock griefing, donation-based share inflation, unverified reallocation targets, owner front-running and BTC leaking on share transfers. Each was proven with a failing test before we fixed it.

## What's next

- Third-party audit, then mainnet with a multisig and timelock.
- Mezo Passport, so Bitcoin wallets can connect.
- An MUSD/BTC liquidity vault on Mezo Pools, and a "borrow to save" flow that opens a trove and deposits in one step.
- Alerts by email or push, using the on-chain preferences that already exist.

## Team

_(fill in: names, roles, contact, socials)_
