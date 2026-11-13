import { ADDR } from "./contracts";

/**
 * Chart palette inside the brand rule (blue, black, white and their mixes). Four series
 * stay distinguishable by lightness as well as hue: blue, black, light blue, grey.
 * Fixed order; colour follows the entity, never its rank.
 */
export const SERIES = {
  flex: "#1840F0",
  term: "#000000",
  sp: "#7B91F7",
  wallet: "#B5B5B5",
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
  grid: "#ececec",
  axis: "#595959",
  ink: "#000000",
  reference: "#262626",
  surface: "#ffffff",
} as const;
