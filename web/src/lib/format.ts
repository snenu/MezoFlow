import { formatUnits } from "viem";

export const WAD = 10n ** 18n;
export const MAX_UINT = 2n ** 256n - 1n;

export function toNum(v: bigint | undefined | null, decimals = 18): number {
  if (v === undefined || v === null) return 0;
  return Number(formatUnits(v, decimals));
}

/** Money with a sensible number of decimals for its size. */
export function fmtAmount(v: bigint | number | undefined | null, opts: { decimals?: number; max?: number } = {}): string {
  const n = typeof v === "number" ? v : toNum(v ?? 0n);
  const abs = Math.abs(n);
  const max = opts.max ?? (abs === 0 ? 2 : abs < 1 ? 4 : abs < 1000 ? 2 : abs < 1_000_000 ? 2 : 1);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 10_000_000) return (n / 1_000_000).toFixed(2) + "M";
  return n.toLocaleString("en-US", { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max });
}

export function fmtBtc(v: bigint | undefined | null): string {
  const n = toNum(v ?? 0n);
  if (n === 0) return "0";
  if (n < 0.00000001) return "<0.00000001";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 });
}

export function fmtPct(bps: number | bigint, digits = 2): string {
  return (Number(bps) / 100).toFixed(digits) + "%";
}

/** Effective APY from a simple APR that is compounded on each on-chain accrual (≈ daily). */
export function aprToApy(bps: number | bigint): number {
  const r = Number(bps) / 10_000;
  return (Math.pow(1 + r / 365, 365) - 1) * 100;
}

export function shortAddr(a?: string, n = 4): string {
  if (!a) return "";
  return `${a.slice(0, 2 + n)}…${a.slice(-n)}`;
}

export function shortHash(h?: string): string {
  if (!h) return "";
  return `${h.slice(0, 8)}…${h.slice(-6)}`;
}

export function fmtDuration(seconds: number): string {
  // type(uint256).max from the contracts means "no rate, so no runway limit".
  if (!Number.isFinite(seconds) || seconds > 1e12) return "No limit";
  if (seconds > 730 * 86400) return `About ${Math.floor(seconds / (365 * 86400))} years`;
  if (seconds <= 0) return "Now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d >= 2) return `${d} days`;
  if (d === 1) return `1 day ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

export function fmtDate(ts: number | bigint): string {
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(ts: number | bigint, now: number): string {
  const s = Math.max(0, Math.floor(now / 1000) - Number(ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Parse a user-typed decimal amount into wei; returns null when invalid. */
export function parseAmount(input: string, decimals = 18): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  } catch {
    return null;
  }
}

/** Value for an input field from wei, trimmed to 6 decimals, rounding down. */
export function toInputValue(v: bigint): string {
  const s = formatUnits(v, 18);
  const [w, f = ""] = s.split(".");
  const ff = f.slice(0, 6).replace(/0+$/, "");
  return ff ? `${w}.${ff}` : w;
}
