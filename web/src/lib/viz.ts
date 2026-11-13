import { ADDR } from "./contracts";

/**
 * Chart palette (light theme) — validated with the dataviz six-checks script against the
 * white chart surface: lightness band, chroma floor, CVD ΔE ≥ 12.8, normal-vision
 * ΔE ≥ 15.2, contrast ≥ 3:1 all pass. Sky leads; royal, teal and violet sit next to it
 * on the hue wheel so the app stays in the sky-blue family.
 * Fixed order; colour follows the entity, never its rank.
 */
export const SERIES = {
  flex: "#0B8FD0",
  term: "#2F55D4",
  sp: "#0A9484",
  wallet: "#8B6BE0",
} as const;

export function seriesForVault(addr: string): string {
  const a = addr.toLowerCase();
  if (a === ADDR.flex.toLowerCase()) return SERIES.flex;
  if (a === ADDR.term.toLowerCase()) return SERIES.term;
  if (a === ADDR.sp.toLowerCase()) return SERIES.sp;
  return SERIES.wallet;
}

/** Recessive chart chrome. */
export const CHART = {
  grid: "rgba(88,115,137,0.14)",
  axis: "#587389",
  ink: "#0b2540",
  reference: "#33506b",
  surface: "#ffffff",
} as const;
