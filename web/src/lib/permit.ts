import type { Address } from "viem";
import { ADDR } from "./contracts";

/** The EIP-2612 permit struct every MezoFlow `...WithPermit` function takes. */
export type PermitSig = { deadline: bigint; v: number; r: `0x${string}`; s: `0x${string}` };

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/**
 * EIP-712 domain names. MUSD is "Mezo USD". Mezo's BTC and MEZO precompiles support
 * permit but not eip712Domain(), so their domains ("BTC" / "MEZO", version "1") are fixed
 * here; they were derived from each token's on-chain DOMAIN_SEPARATOR(). MezoFlow vault
 * shares use their ERC-20 name.
 */
export function knownPermitName(token: Address): string | null {
  const t = token.toLowerCase();
  if (t === ADDR.musd.toLowerCase()) return "Mezo USD";
  if (t === ADDR.btc.toLowerCase()) return "BTC";
  if (t === ADDR.mezo.toLowerCase()) return "MEZO";
  if (t === ADDR.flex.toLowerCase()) return "MezoFlow Flexible Savings";
  if (t === ADDR.term.toLowerCase()) return "MezoFlow Term Savings";
  if (t === ADDR.sp.toLowerCase()) return "MezoFlow Stability Pool";
  return null;
}

export const nonceAbi = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
