"use client";

import { useState } from "react";
import { fmtAmount, toNum } from "@/lib/format";

const LIQ_CR = 1.1;

function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  fill,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  fill?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="font-semibold tabular">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="range mt-3"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--pct" as string]: `${pct}%`, ["--fill" as string]: fill } as React.CSSProperties}
      />
    </div>
  );
}

/**
 * Illustrative Stability Pool outcome: a liquidation burns part of the position and pays
 * BTC worth ~110% of it at the oracle price; BTC then moves before the user sells.
 */
export function ScenarioCalculator({ defaultPosition, btcPrice }: { defaultPosition: number; btcPrice: bigint | undefined }) {
  const [position, setPosition] = useState<string>(defaultPosition > 0 ? defaultPosition.toFixed(2) : "1000");
  const [absorbed, setAbsorbed] = useState(10);
  const [move, setMove] = useState(-10);

  const P = Math.max(0, Number(position) || 0);
  const price = toNum(btcPrice ?? 0n);
  const lost = P * (absorbed / 100);
  const btcValueAtLiq = lost * LIQ_CR;
  const btcAmount = price > 0 ? btcValueAtLiq / price : 0;
  const btcValueAfter = btcValueAtLiq * (1 + move / 100);
  const net = btcValueAfter - lost;
  const breakEven = (1 / LIQ_CR - 1) * 100;
  const positive = net >= 0;

  return (
    <div className="panel grid gap-8 p-5 sm:p-6 lg:grid-cols-[1fr_1fr]">
      <div className="grid content-start gap-6">
        <div>
          <label htmlFor="scenario-position" className="text-sm font-medium">
            Your Stability Pool position
          </label>
          <div className="input-wrap mt-3">
            <input
              id="scenario-position"
              className="amount-input !text-xl"
              inputMode="decimal"
              value={position}
              onChange={(e) => {
                const v = e.target.value.replace(",", ".");
                if (/^\d*\.?\d{0,6}$/.test(v)) setPosition(v);
              }}
            />
            <span className="text-sm font-semibold text-mist">MUSD</span>
          </div>
          <p className="mt-2 text-xs text-silt">
            {defaultPosition > 0 ? "Prefilled with your current position." : "You have no position yet, so this starts at 1,000 MUSD."}
          </p>
        </div>
        <Slider
          id="scenario-absorbed"
          label="Share of the pool used in liquidations"
          value={absorbed}
          min={0}
          max={100}
          step={1}
          onChange={setAbsorbed}
          format={(v) => `${v}%`}
          fill="var(--color-tide)"
        />
        <Slider
          id="scenario-move"
          label="BTC price change before you sell"
          value={move}
          min={-40}
          max={40}
          step={1}
          onChange={setMove}
          format={(v) => `${v > 0 ? "+" : ""}${v}%`}
          fill={move < breakEven ? "var(--color-coral)" : "var(--color-ember)"}
        />
        <p className="text-sm leading-relaxed text-silt">
          Liquidations happen at 110% collateral, so every 100 MUSD the pool absorbs comes back as roughly 110 MUSD of BTC at
          the oracle price. Mezo keeps a small slice as gas compensation, so real payouts are slightly lower.
        </p>
      </div>

      <div className="flex flex-col">
        <dl className="grid gap-4">
          <Row label="MUSD burned to repay debt" value={`−${fmtAmount(lost)} MUSD`} />
          <Row
            label="BTC you receive"
            value={`${btcAmount > 0 ? btcAmount.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "0"} BTC`}
            hint={`Worth ${fmtAmount(btcValueAtLiq)} MUSD at today's oracle price${price > 0 ? ` of $${fmtAmount(price, { max: 0 })}` : ""}`}
            accent="text-ember"
          />
          <Row
            label={`That BTC after a ${move > 0 ? "+" : ""}${move}% move`}
            value={`${fmtAmount(btcValueAfter)} MUSD`}
          />
        </dl>
        <div className={`mt-6 rounded-lg border p-5 ${positive ? "border-tide/40 bg-tide/8" : "border-coral/45 bg-coral/8"}`}>
          <p className="text-sm text-mist">Net result of this scenario</p>
          <p className={`mt-1 text-3xl font-bold tracking-tight tabular ${positive ? "text-tide" : "text-coral"}`}>
            {positive ? "+" : "−"}
            {fmtAmount(Math.abs(net))} MUSD
          </p>
          <p className="mt-1 text-sm font-medium">{positive ? "Gain" : "Loss"} compared with keeping the MUSD</p>
          <p className="mt-3 text-sm leading-relaxed text-silt">
            Break-even is a BTC drop of about {Math.abs(breakEven).toFixed(1)}%. Anything smaller than that, or a rise, leaves
            you ahead.
          </p>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-silt">
          An illustration, not a prediction. Real liquidations vary in size, timing and collateral ratio, and nothing here is
          a promise of returns.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b rule pb-3">
      <dt className="text-sm text-mist">{label}</dt>
      <dd className={`font-semibold tabular ${accent ?? ""}`}>{value}</dd>
      {hint && <dd className="w-full text-xs text-silt">{hint}</dd>}
    </div>
  );
}
