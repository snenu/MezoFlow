"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHART } from "@/lib/viz";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export type Point = { t: number; v: number };
export type Series = {
  key: string;
  label: string;
  color: string;
  points: Point[];
  /** Reference line: dashed, text-ink coloured, no area. */
  reference?: boolean;
  area?: boolean;
};

function niceTicks(min: number, max: number, count = 4) {
  if (max === min) {
    const d = Math.abs(max) * 0.05 || 1;
    min -= d;
    max += d;
  }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}

/**
 * Time-series line chart with a crosshair tooltip. One y-axis only; a reference series
 * (e.g. net deposits) renders as a dashed ink line rather than a second colour.
 */
export function LineChart({
  series,
  height = 240,
  formatValue,
  formatTime,
  emptyText = "Not enough history yet.",
  ariaLabel,
}: {
  series: Series[];
  height?: number;
  formatValue: (v: number) => string;
  formatTime: (t: number) => string;
  emptyText?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 16, right: 64, bottom: 28, left: 8 };

  const model = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (all.length < 2 || width === 0) return null;
    const t0 = Math.min(...all.map((p) => p.t));
    const t1 = Math.max(...all.map((p) => p.t));
    const vals = all.map((p) => p.v);
    const { lo, hi, ticks } = niceTicks(Math.min(...vals), Math.max(...vals));
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom;
    const x = (t: number) => pad.left + (t1 === t0 ? iw : ((t - t0) / (t1 - t0)) * iw);
    const y = (v: number) => pad.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
    const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
    return { t0, t1, lo, hi, ticks, x, y, iw, ih, times };
  }, [series, width, height, pad.left, pad.right, pad.top, pad.bottom]);

  const valueAt = (s: Series, t: number) => {
    let v: number | null = null;
    for (const p of s.points) {
      if (p.t <= t) v = p.v;
      else break;
    }
    return v;
  };

  const step = (s: Series) => {
    if (!model || s.points.length === 0) return "";
    // Step-after path: value holds until the next on-chain observation.
    let d = `M${model.x(s.points[0].t)},${model.y(s.points[0].v)}`;
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i];
      d += ` H${model.x(p.t)} V${model.y(p.v)}`;
    }
    return d;
  };

  const hoverT = hover !== null && model ? model.times[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {!model ? (
        <div className="grid h-full place-items-center rounded-xl border border-dashed border-shoal text-sm text-silt">
          {emptyText}
        </div>
      ) : (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={ariaLabel}
            onPointerLeave={() => setHover(null)}
            onPointerMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = e.clientX - r.left;
              let best = 0;
              let bd = Infinity;
              model.times.forEach((t, i) => {
                const d = Math.abs(model.x(t) - px);
                if (d < bd) {
                  bd = d;
                  best = i;
                }
              });
              setHover(best);
            }}
          >
            {model.ticks.map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={pad.left + model.iw} y1={model.y(v)} y2={model.y(v)} stroke={CHART.grid} />
                <text x={width - pad.right + 8} y={model.y(v) + 4} fill={CHART.axis} fontSize="11">
                  {formatValue(v)}
                </text>
              </g>
            ))}
            <text x={pad.left} y={height - 8} fill={CHART.axis} fontSize="11">
              {formatTime(model.t0)}
            </text>
            <text x={pad.left + model.iw} y={height - 8} fill={CHART.axis} fontSize="11" textAnchor="end">
              {formatTime(model.t1)}
            </text>
            {series.map((s) =>
              s.area && s.points.length ? (
                <path
                  key={`a-${s.key}`}
                  d={`${step(s)} V${model.y(model.lo)} H${model.x(s.points[0].t)} Z`}
                  fill={s.color}
                  fillOpacity={0.1}
                />
              ) : null,
            )}
            {series.map((s) => (
              <path
                key={s.key}
                d={step(s)}
                fill="none"
                stroke={s.reference ? CHART.reference : s.color}
                strokeWidth={2}
                strokeDasharray={s.reference ? "4 4" : undefined}
                strokeLinejoin="round"
                opacity={s.reference ? 0.7 : 1}
              />
            ))}
            {hoverT !== null && (
              <g>
                <line
                  x1={model.x(hoverT)}
                  x2={model.x(hoverT)}
                  y1={pad.top}
                  y2={pad.top + model.ih}
                  stroke={CHART.axis}
                  strokeOpacity={0.5}
                />
                {series.map((s) => {
                  const v = valueAt(s, hoverT);
                  if (v === null) return null;
                  return (
                    <circle
                      key={s.key}
                      cx={model.x(hoverT)}
                      cy={model.y(v)}
                      r={4.5}
                      fill={s.reference ? CHART.reference : s.color}
                      stroke={CHART.surface}
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}
          </svg>
          {hoverT !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 min-w-[170px] rounded-lg border border-reef bg-trench/95 px-3 py-2 text-xs shadow-xl"
              style={{
                left: Math.min(Math.max(model.x(hoverT) + 12, 0), width - 200),
              }}
            >
              <p className="text-silt">{formatTime(hoverT)}</p>
              {series.map((s) => {
                const v = valueAt(s, hoverT);
                if (v === null) return null;
                return (
                  <p key={s.key} className="mt-1 flex items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-mist">
                      <span
                        className="inline-block h-0.5 w-3"
                        style={{ background: s.reference ? CHART.reference : s.color }}
                        aria-hidden
                      />
                      {s.label}
                    </span>
                    <span className="font-semibold text-foam">{formatValue(v)}</span>
                  </p>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; value?: ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2 text-mist">
          <span
            aria-hidden
            className="inline-block h-0.5 w-4"
            style={
              i.dashed
                ? { borderTop: `2px dashed ${i.color}`, height: 0 }
                : { background: i.color, height: 3, borderRadius: 2 }
            }
          />
          {i.label}
          {i.value !== undefined && <span className="font-semibold text-foam">{i.value}</span>}
        </li>
      ))}
    </ul>
  );
}

export type Segment = { key: string; label: string; value: number; color: string; detail?: string };

/** Stacked horizontal bar with 2px surface gaps between segments and a hover tooltip. */
export function StackBar({ segments, format }: { segments: Segment[]; format: (v: number) => string }) {
  const total = segments.reduce((s, x) => s + Math.max(x.value, 0), 0);
  const [hover, setHover] = useState<string | null>(null);
  const shown = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="relative flex h-4 w-full gap-[2px] overflow-visible" role="img" aria-label="Allocation by strategy">
        {total === 0 ? (
          <div className="h-full w-full rounded-[4px] bg-shoal" />
        ) : (
          shown.map((s, i) => (
            <div
              key={s.key}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
              className="relative h-full transition-opacity"
              style={{
                width: `${(s.value / total) * 100}%`,
                minWidth: 4,
                background: s.color,
                borderRadius: `${i === 0 ? 4 : 1}px ${i === shown.length - 1 ? 4 : 1}px ${i === shown.length - 1 ? 4 : 1}px ${i === 0 ? 4 : 1}px`,
                opacity: hover && hover !== s.key ? 0.45 : 1,
              }}
            >
              {hover === s.key && (
                <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 w-max -translate-x-1/2 rounded-lg border border-reef bg-trench/95 px-3 py-2 text-xs shadow-xl">
                  <p className="font-semibold text-foam">{s.label}</p>
                  <p className="text-mist">{format(s.value)}</p>
                  <p className="text-silt">{((s.value / total) * 100).toFixed(1)}% of total</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {segments.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5">
            <span className="mt-1.5 h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.color }} aria-hidden />
            <div className="min-w-0">
              <p className="text-sm text-mist">{s.label}</p>
              <p className="font-semibold tabular">
                {format(s.value)}
                <span className="ml-2 text-sm font-normal text-silt">
                  {total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "0%"}
                </span>
              </p>
              {s.detail && <p className="text-xs text-silt">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
