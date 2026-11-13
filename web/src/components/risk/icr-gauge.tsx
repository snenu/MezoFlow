"use client";

import { toNum } from "@/lib/format";

const MIN = 1.0;
const MAX = 2.0;
const pos = (v: number) => `${Math.max(0, Math.min(1, (v - MIN) / (MAX - MIN))) * 100}%`;

export type IcrState = "paused" | "close" | "healthy" | "unknown";

export function icrState(icr: number, open: boolean | undefined): IcrState {
  if (open === false) return "paused";
  if (!icr) return "unknown";
  if (icr < 1.2) return "close";
  return "healthy";
}

export const STATE_COPY: Record<IcrState, { label: string; tone: string; glyph: string }> = {
  paused: { label: "Withdrawals paused", tone: "text-coral", glyph: "!" },
  close: { label: "Close to the 110% line", tone: "text-sun", glyph: "!" },
  healthy: { label: "Healthy", tone: "text-tide", glyph: "✓" },
  unknown: { label: "Reading…", tone: "text-silt", glyph: "…" },
};

/**
 * Horizontal scale from 100% to 200% collateral. The 110% minimum collateral ratio is the
 * line Mezo liquidates at, and the point below which the Stability Pool blocks withdrawals.
 */
export function IcrGauge({ lowestIcr, mcr, open }: { lowestIcr: bigint | undefined; mcr: bigint | undefined; open: boolean | undefined }) {
  const icr = toNum(lowestIcr ?? 0n);
  const line = toNum(mcr ?? 0n) || 1.1;
  const state = icrState(icr, open);
  const copy = STATE_COPY[state];
  const over = icr > 0 ? (icr - line) * 100 : 0;
  const fallRoom = icr > 0 ? Math.max(0, (1 - line / icr) * 100) : 0;
  const markerColor =
    state === "paused" ? "var(--color-coral)" : state === "close" ? "var(--color-sun)" : "var(--color-tide)";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="label">Weakest trove on Mezo</p>
          <p className="mt-1 text-[2rem] font-bold tracking-tight tabular leading-none">
            {icr > 0 ? `${(icr * 100).toFixed(1)}%` : "—"}
            <span className="ml-2 text-base font-medium text-silt">collateral</span>
          </p>
        </div>
        <p className={`inline-flex items-center gap-2 text-sm font-semibold ${copy.tone}`} role="status">
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-full text-[0.7rem] font-bold text-white"
            style={{ background: markerColor }}
          >
            {copy.glyph}
          </span>
          {copy.label}
        </p>
      </div>

      <div className="relative mt-8 pb-14" aria-hidden>
        {/* zones */}
        <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
          <span className="h-full rounded-l-full" style={{ width: pos(line), background: "color-mix(in oklab, var(--color-coral) 55%, transparent)" }} />
          <span
            className="h-full"
            style={{
              width: `calc(${pos(1.2)} - ${pos(line)})`,
              background: "color-mix(in oklab, var(--color-sun) 50%, transparent)",
            }}
          />
          <span className="h-full flex-1 rounded-r-full" style={{ background: "color-mix(in oklab, var(--color-tide) 28%, transparent)" }} />
        </div>
        {/* 110% line */}
        <div className="absolute top-[-6px] h-6 w-[2px] -translate-x-1/2 bg-foam" style={{ left: pos(line) }} />
        <p className="absolute top-11 -translate-x-[1px] whitespace-nowrap border-l border-foam pl-1.5 text-xs text-mist" style={{ left: pos(line) }}>
          {(line * 100).toFixed(0)}% liquidation line
        </p>
        {/* weakest trove marker */}
        {icr > 0 && (
          <div className="absolute top-[-10px] -translate-x-1/2" style={{ left: pos(icr) }}>
            <div
              className="h-0 w-0 border-x-[7px] border-t-[9px] border-x-transparent"
              style={{ borderTopColor: markerColor }}
            />
          </div>
        )}
        <div className="absolute right-0 top-6 text-xs text-silt tabular">200%+</div>
        <div className="absolute left-0 top-6 text-xs text-silt tabular">100%</div>
      </div>

      <p className="text-sm leading-relaxed text-mist">
        {icr > 0 ? (
          <>
            The weakest trove is <span className="font-semibold text-foam tabular">{over.toFixed(1)} points</span> above the
            line. BTC would need to fall about <span className="font-semibold text-foam tabular">{fallRoom.toFixed(1)}%</span>{" "}
            for it to reach 110% and be liquidated.
          </>
        ) : (
          "Reading the sorted trove list from Mezo…"
        )}
      </p>
    </div>
  );
}
