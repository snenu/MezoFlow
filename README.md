# MezoFlow

Make your MUSD work smarter. MezoFlow is an MUSD money-management app on **Mezo Testnet**: savings vaults, Mezo's official MUSD Stability Pool, a one-transaction auto allocator, a live risk dashboard, on-chain alerts, a portfolio tracker, a fully on-chain activity ledger and an AI assistant that reads the chain.

Everything the app shows is read from deployed contracts. There is no backend database.

## What's inside

| Feature | How it works |
| --- | --- |
| Smart MUSD vaults | ERC-4626 vaults over real testnet MUSD. Shares are receipt tokens in your wallet. |
| Flexible Savings | Instant withdrawals, fixed rate paid from an on-chain reward reserve (fee-backed). |
| Term Savings | 7-day size-weighted lock, higher rate, 1.5% early-exit penalty returned to the reserve. |
| Stability Pool | Routes MUSD into Mezo's official StabilityPool, distributes BTC liquidation gains pro-rata, keeps a 10% idle buffer, honours Mezo's 110% ICR withdrawal rule. |
| Strategy marketplace | Read from the on-chain StrategyRegistry. |
| Smart auto allocator | Conservative / Balanced / Growth presets stored on-chain, custom splits, atomic reallocation. |
| Risk dashboard | Live Mezo telemetry (oracle price, weakest trove ICR, TCR, pool size), plain-language risks, a loss calculator. |
| Alerts | Preferences stored on-chain in AlertCenter; alerts derived from ledger events, rate history, announcements and live pool health. |
| Portfolio tracker | Value over time rebuilt from ledger share movements and vault share-price checkpoints. |
| Transaction history | ActivityLedger records every action; tx hashes resolved from its events. CSV export. |
| Ask Flow | AI SDK + Vercel AI Gateway with read-only chain tools. It never moves funds. |
| Test MUSD faucet | 25 real testnet MUSD per address per day. |

## Contracts (Mezo Testnet, chain 31611)

| Contract | Address |
| --- | --- |
| ActivityLedger | [0x0686dF54618A0769c27b815d01103cCDDD29382e](https://explorer.test.mezo.org/address/0x0686dF54618A0769c27b815d01103cCDDD29382e) |
| FeeManager | [0x1670D38659452f6F7eb64c8536E8Bd9f9b555aF4](https://explorer.test.mezo.org/address/0x1670D38659452f6F7eb64c8536E8Bd9f9b555aF4) |
| StrategyRegistry | [0xD0B07a5372b02Ea6aFDbCe6ba32E7E5740C799c6](https://explorer.test.mezo.org/address/0xD0B07a5372b02Ea6aFDbCe6ba32E7E5740C799c6) |
| FlexibleSavingsVault | [0x099D2B1b662e3CFcCb95eFbaed29676ff633990f](https://explorer.test.mezo.org/address/0x099D2B1b662e3CFcCb95eFbaed29676ff633990f) |
| TermVault | [0x3370ee55909893aBCBF47792065473Aa497c314b](https://explorer.test.mezo.org/address/0x3370ee55909893aBCBF47792065473Aa497c314b) |
| StabilityPoolVault | [0x7fE6B061B0d5E206f8Fc9627849D419ACC2E14C1](https://explorer.test.mezo.org/address/0x7fE6B061B0d5E206f8Fc9627849D419ACC2E14C1) |
| AutoAllocator | [0xF525a47Fb77dC453454737119A5178E845CE457A](https://explorer.test.mezo.org/address/0xF525a47Fb77dC453454737119A5178E845CE457A) |
| MUSDFaucet | [0x6d0F1885331e70fb585386B485a31f8548Ba8F3f](https://explorer.test.mezo.org/address/0x6d0F1885331e70fb585386B485a31f8548Ba8F3f) |
| AlertCenter | [0x4aD032d5b6641F2A738f21559f2A848Fed8ca1Ed](https://explorer.test.mezo.org/address/0x4aD032d5b6641F2A738f21559f2A848Fed8ca1Ed) |
| MezoFlowLens | [0x503199B159DbAC9212Ae28A8C8E6f26E06D5002b](https://explorer.test.mezo.org/address/0x503199B159DbAC9212Ae28A8C8E6f26E06D5002b) |
| MUSD (Mezo) | [0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503](https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503) |
| StabilityPool (Mezo) | [0x1CCA7E410eE41739792eA0A24e00349Dd247680e](https://explorer.test.mezo.org/address/0x1CCA7E410eE41739792eA0A24e00349Dd247680e) |

Compiled with Solidity 0.8.28 for the `london` EVM (Mezo's documented target) and OpenZeppelin 5.1.

## Repository layout

- `contracts/` — Hardhat project: contracts, 21 unit tests, deploy and end-to-end scripts.
- `web/` — Next.js 16 app (wagmi, viem, motion, AI SDK).

## Run it

```bash
# contracts
cd contracts && npm install
npx hardhat test
npx hardhat run scripts/deploy.js --network mezotestnet   # needs PRIVATE_KEY
npx hardhat run scripts/e2e.js --network mezotestnet
node scripts/export-web.js                               # ABIs + addresses -> web

# web
cd web && npm install && npm run dev
```

## Notes from building on Mezo

- Mezo's `eth_estimateGas` underestimates transactions with nested calls, so the app pads every estimate. Gas is about 150 wei, so the padding costs nothing.
- `eth_getLogs` is capped at 10,000 blocks. The ledger stores block numbers, so the app only queries the windows it needs.
- OpenZeppelin 5.2+ uses the Cancun `mcopy` opcode, which does not compile for `london`; the contracts pin 5.1.

Testnet only. Not audited. No returns are promised.
