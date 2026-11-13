"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, useReducedMotion } from "motion/react";
import { RISK_LABEL } from "@/lib/contracts";
import { addressUrl } from "@/lib/chain";
import { shortAddr, toInputValue } from "@/lib/format";

/** Five segments, filled up to the score, coloured by severity. */
export function RiskMeter({ score, showLabel = true, size = "md" }: { score: number; showLabel?: boolean; size?: "sm" | "md" }) {
  const s = Math.max(1, Math.min(5, Math.round(score)));
  return (
    <span className={`risk-${s} inline-flex items-center gap-2`} title={`Risk ${s} of 5: ${RISK_LABEL[s]}`}>
      <span className="inline-flex gap-[3px]" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={size === "sm" ? "h-2.5 w-1.5 rounded-[2px]" : "h-3.5 w-2 rounded-[3px]"}
            style={{ background: i <= s ? "var(--risk)" : "var(--color-shoal)" }}
          />
        ))}
      </span>
      {showLabel && <span className="text-sm text-mist">{RISK_LABEL[s]}</span>}
      <span className="sr-only">Risk {s} of 5</span>
    </span>
  );
}

/** Number that eases to its new value when on-chain data refreshes. */
export function Ticker({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current ?? value;
    prev.current = value;
    if (reduce || from === value) {
      el.textContent = format(value);
      return;
    }
    const c = animate(from, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => (el.textContent = format(v)),
    });
    return () => c.stop();
  }, [value, format, reduce]);
  return (
    <span ref={ref} className={`tabular ${className ?? ""}`}>
      {format(value)}
    </span>
  );
}

export function Skel({ w = "4rem", h = "1em", className = "" }: { w?: string; h?: string; className?: string }) {
  return <span className={`skeleton align-middle ${className}`} style={{ width: w, height: h }} aria-hidden />;
}

export function Stat({
  label,
  children,
  hint,
  source,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  source?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="label" title={source ? `Read from ${source}` : undefined}>
        {label}
      </dt>
      <dd className="mt-1.5 text-xl font-semibold tracking-tight tabular">{children}</dd>
      {hint && <dd className="mt-1 text-sm text-silt">{hint}</dd>}
    </div>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a className="link tabular" href={addressUrl(address)} target="_blank" rel="noreferrer">
      {label ?? shortAddr(address, 6)}
    </a>
  );
}

export function AmountInput({
  value,
  onChange,
  max,
  maxLabel,
  invalid,
  id,
  unit = "MUSD",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  max?: bigint;
  maxLabel?: string;
  invalid?: boolean;
  id?: string;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <div className="input-wrap" data-invalid={invalid ? "true" : "false"}>
      <input
        id={id}
        className="amount-input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(",", ".");
          if (/^\d*\.?\d{0,18}$/.test(v)) onChange(v);
        }}
      />
      <div className="flex flex-col items-end gap-1.5">
        <span className="text-sm font-semibold text-mist">{unit}</span>
        {max !== undefined && (
          <button type="button" className="chip chip-btn" onClick={() => onChange(toInputValue(max))} disabled={disabled}>
            {maxLabel ?? "Max"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-6 py-10">
      <p className="font-semibold">{title}</p>
      {body && <p className="max-w-md text-sm text-silt">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Ticks every `ms` so relative times stay fresh without calling Date.now() in render. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [ms]);
  return now;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "tide" | "ember" | "coral" | "sun"; children: ReactNode }) {
  const tones: Record<string, string> = {
    neutral: "bg-shoal text-mist",
    tide: "bg-tide/12 text-tide",
    ember: "bg-ember/14 text-ember",
    coral: "bg-coral/14 text-coral",
    sun: "bg-sun/14 text-sun",
  };
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
