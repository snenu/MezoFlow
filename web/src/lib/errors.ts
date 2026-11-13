import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Abi } from "viem";
import {
  allocatorAbi,
  alertCenterAbi,
  faucetAbi,
  ledgerAbi,
  registryAbi,
  spVaultAbi,
  termVaultAbi,
  vaultAbi,
} from "./contracts";
import { fmtDuration } from "./format";

/** Every custom error from every MezoFlow contract, appended to any ABI we call so that
 * reverts bubbling up from nested calls (e.g. allocator → vault) still decode. */
const all = [...vaultAbi, ...termVaultAbi, ...spVaultAbi, ...allocatorAbi, ...faucetAbi, ...ledgerAbi, ...registryAbi, ...alertCenterAbi];
const seen = new Set<string>();
export const errorsAbi = all.filter((x) => {
  if (x.type !== "error") return false;
  const k = x.name + JSON.stringify(x.inputs);
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
}) as Abi;

export function withErrors<T extends Abi | readonly unknown[]>(abi: T): T {
  return [...(abi as readonly unknown[]), ...errorsAbi] as unknown as T;
}

/** Turn a wallet / RPC / contract error into one sentence telling the user what to do. */
export function explainError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You declined the request in your wallet.";
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted) {
      const name = reverted.data?.errorName;
      const args = (reverted.data?.args ?? []) as readonly unknown[];
      switch (name) {
        case "BelowMinDeposit":
          return "Each deposit must be at least 1 MUSD.";
        case "ZeroShares":
          return "That amount is too small to mint any vault shares.";
        case "ERC4626ExceededMaxWithdraw":
        case "ERC4626ExceededMaxRedeem":
          return "That's more than you can withdraw right now. Use Max to see what is available.";
        case "ERC20InsufficientBalance":
          return "Your wallet doesn't hold enough MUSD for this.";
        case "ERC20InsufficientAllowance":
          return "MezoFlow isn't approved to move that much MUSD yet. Approve it first.";
        case "EnforcedPause":
          return "Deposits into this strategy are paused. Withdrawals still work.";
        case "SPWithdrawalsLocked":
          return "Mezo's Stability Pool is blocking withdrawals because a trove is below 110% collateral. You can still withdraw up to the idle buffer.";
        case "SharesLocked":
          return "These shares are still locked, so they can't be transferred yet.";
        case "NothingToClaim":
          return "There is no BTC waiting to be claimed yet.";
        case "CoolingDown": {
          const next = Number(args[0] ?? 0);
          const wait = next - Math.floor(Date.now() / 1000);
          return `You've already claimed from the faucet. Try again in ${fmtDuration(wait)}.`;
        }
        case "FaucetEmpty":
          return "The test faucet is empty right now. Get MUSD by borrowing on the Mezo testnet app instead.";
        case "InactiveVault":
          return "One of the selected strategies is not accepting allocations right now.";
        case "WeightsTooHigh":
          return "Your split adds up to more than 100%.";
        case "InactivePreset":
          return "That preset is no longer offered.";
        case "NothingAllocated":
          return "Nothing would be allocated with this amount and split.";
        default:
          if (name) return `The contract rejected this transaction (${name}).`;
          if (reverted.reason) return reverted.reason;
      }
    }
    const msg = (e.details || e.shortMessage || "").toLowerCase();
    if (msg.includes("insufficient funds"))
      return "You need a little testnet BTC for gas. Get some from faucet.test.mezo.org.";
    if (msg.includes("chain") && msg.includes("mismatch")) return "Switch your wallet to Mezo Testnet and try again.";
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}
