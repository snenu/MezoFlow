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
  zapAbi,
} from "./contracts";
import { fmtDuration } from "./format";

/** Every custom error from every MezoFlow contract, appended to any ABI we call so that
 * reverts bubbling up from nested calls (e.g. allocator → vault) still decode. */
const all = [
  ...vaultAbi,
  ...termVaultAbi,
  ...spVaultAbi,
  ...allocatorAbi,
  ...faucetAbi,
  ...ledgerAbi,
  ...registryAbi,
  ...alertCenterAbi,
  ...zapAbi,
];
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
          return "The test faucet is empty right now. Swap a little testnet BTC for MUSD on the Get MUSD page instead.";
        case "InactiveVault":
          return "One of the selected strategies is not accepting allocations right now.";
        case "WeightsTooHigh":
          return "Your split adds up to more than 100%.";
        case "InactivePreset":
          return "That preset is no longer offered.";
        case "NothingAllocated":
          return "Nothing would be allocated with this amount and split.";
        case "UnknownVault":
          return "That position isn't in a MezoFlow vault.";
        case "UnknownPreset":
          return "That preset doesn't exist.";
        case "NotRouter":
          return "Only MezoFlow's swap contract can allocate on someone's behalf.";
        case "ThirdPartyDeposit":
          return "Term Savings only accepts deposits into your own position, so nobody can extend your lock.";
        case "PermitFailed":
          return "The permit signature wasn't accepted. It may have expired; sign again.";
        case "InvalidRoute":
          return "That swap route isn't supported. Swaps must go through Mezo Pools and end in MUSD.";
        case "InsufficientOutput":
          return "The price moved more than your slippage limit. Get a fresh quote and try again.";
        case "SafeERC20FailedOperation":
          return "A token transfer failed. Check your balance and try again.";
        default:
          if (name) return `The contract rejected this transaction (${name}).`;
          if (reverted.reason) return reverted.reason;
      }
    }
    const msg = (e.details || e.shortMessage || "").toLowerCase();
    if (msg.includes("insufficient_output") || msg.includes("insufficientoutput"))
      return "The price moved more than your slippage limit. Get a fresh quote and try again.";
    if (msg.includes("expired")) return "The quote or signature expired. Try again.";
    if (msg.includes("insufficient funds"))
      return "You need a little testnet BTC for gas. Get some from faucet.test.mezo.org.";
    if (msg.includes("chain") && msg.includes("mismatch")) return "Switch your wallet to Mezo Testnet and try again.";
    return e.shortMessage || e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}
