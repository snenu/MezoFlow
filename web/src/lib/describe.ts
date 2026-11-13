import { vaultName } from "./contracts";

/** The tail of an activity sentence, e.g. " into Flexible Savings". */
export function describeTarget(kind: number, vault: string): string {
  switch (kind) {
    case 0:
      return ` into ${vaultName(vault)}`;
    case 1:
    case 4:
      return ` from ${vaultName(vault)}`;
    case 2:
      return " across strategies with the Auto Allocator";
    case 3:
      return ` from ${vaultName(vault)}`;
    case 5:
      return ` as ${vaultName(vault)} shares`;
    case 6:
      return ` as ${vaultName(vault)} shares`;
    case 7:
      return " from the faucet";
    case 8:
      return " into a new split";
    default:
      return "";
  }
}
