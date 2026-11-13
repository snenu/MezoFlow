import { erc20Abi, type Address } from "viem";
import {
  deployment,
  activityLedgerAbi,
  alertCenterAbi,
  autoAllocatorAbi,
  feeManagerAbi,
  flexibleSavingsVaultAbi,
  mezoFlowLensAbi,
  mUSDFaucetAbi,
  mezoFlowZapAbi,
  stabilityPoolVaultAbi,
  strategyRegistryAbi,
  termVaultAbi,
} from "./generated";

export const C = deployment.contracts;
export const MEZO = deployment.mezo;
export const START_BLOCK = BigInt(deployment.startBlock);

export const ADDR = {
  musd: MEZO.MUSD as Address,
  ledger: C.ActivityLedger as Address,
  fees: C.FeeManager as Address,
  registry: C.StrategyRegistry as Address,
  flex: C.FlexibleSavingsVault as Address,
  term: C.TermVault as Address,
  sp: C.StabilityPoolVault as Address,
  allocator: C.AutoAllocator as Address,
  faucet: C.MUSDFaucet as Address,
  alerts: C.AlertCenter as Address,
  lens: C.MezoFlowLens as Address,
  zap: C.MezoFlowZap as Address,
  btc: MEZO.BTC as Address,
  mezo: MEZO.MEZO as Address,
  poolsRouter: MEZO.PoolsRouter as Address,
  poolFactory: MEZO.PoolFactory as Address,
  stabilityPool: MEZO.StabilityPool as Address,
  priceFeed: MEZO.PriceFeed as Address,
  troveManager: MEZO.TroveManager as Address,
  sortedTroves: MEZO.SortedTroves as Address,
} as const;

export {
  erc20Abi,
  activityLedgerAbi as ledgerAbi,
  alertCenterAbi,
  autoAllocatorAbi as allocatorAbi,
  feeManagerAbi,
  flexibleSavingsVaultAbi as vaultAbi,
  mezoFlowLensAbi as lensAbi,
  mUSDFaucetAbi as faucetAbi,
  mezoFlowZapAbi as zapAbi,
  stabilityPoolVaultAbi as spVaultAbi,
  strategyRegistryAbi as registryAbi,
  termVaultAbi,
};

/** Every vault-shaped ABI merged, so viem can decode any vault's custom errors. */
export const anyVaultAbi = [
  ...flexibleSavingsVaultAbi,
  ...termVaultAbi.filter((x) => !flexibleSavingsVaultAbi.some((y) => "name" in y && "name" in x && y.name === x.name && y.type === x.type)),
  ...stabilityPoolVaultAbi.filter((x) => !flexibleSavingsVaultAbi.some((y) => "name" in y && "name" in x && y.name === x.name && y.type === x.type)),
] as const;

export const KIND = { FLEXIBLE: 1, TERM: 2, STABILITY_POOL: 3 } as const;

export const LEDGER_KIND: Record<number, { label: string; verb: string; sign: 1 | -1 | 0 }> = {
  0: { label: "Deposit", verb: "Deposited", sign: 1 },
  1: { label: "Withdrawal", verb: "Withdrew", sign: -1 },
  2: { label: "Allocation", verb: "Allocated", sign: 0 },
  3: { label: "BTC claim", verb: "Claimed", sign: 0 },
  4: { label: "Early exit", verb: "Exited early", sign: -1 },
  5: { label: "Shares received", verb: "Received", sign: 1 },
  6: { label: "Shares sent", verb: "Sent", sign: -1 },
  7: { label: "Faucet", verb: "Claimed", sign: 0 },
  8: { label: "Reallocation", verb: "Reallocated", sign: 0 },
  9: { label: "Swap", verb: "Swapped", sign: 0 },
};

export const RISK_LABEL: Record<number, string> = {
  1: "Very low",
  2: "Low",
  3: "Moderate",
  4: "Elevated",
  5: "High",
};

export function vaultName(addr: string): string {
  const a = addr.toLowerCase();
  if (a === ADDR.flex.toLowerCase()) return "Flexible Savings";
  if (a === ADDR.term.toLowerCase()) return "Term Savings";
  if (a === ADDR.sp.toLowerCase()) return "Stability Pool";
  if (a === ADDR.allocator.toLowerCase()) return "Auto Allocator";
  if (a === ADDR.faucet.toLowerCase()) return "Test faucet";
  if (a === ADDR.zap.toLowerCase()) return "Mezo Pools swap";
  if (a === ADDR.btc.toLowerCase()) return "BTC";
  if (a === ADDR.mezo.toLowerCase()) return "MEZO";
  return "Contract";
}

export function slugForVault(addr: string): string | null {
  const a = addr.toLowerCase();
  if (a === ADDR.flex.toLowerCase()) return "flexible-savings";
  if (a === ADDR.term.toLowerCase()) return "term-savings";
  if (a === ADDR.sp.toLowerCase()) return "stability-pool";
  return null;
}
