"use client";

import { useState } from "react";
import { ALERT_BITS, type Prefs } from "@/hooks/useAlerts";
import { useTx } from "@/hooks/useTx";
import { ADDR, alertCenterAbi, RISK_LABEL } from "@/lib/contracts";
import { Badge } from "@/components/ui";

const TYPES: { bit: number; name: string; body: string }[] = [
  { bit: ALERT_BITS.DEPOSIT, name: "Deposits and allocations", body: "When a deposit or allocation is confirmed on-chain." },
  { bit: ALERT_BITS.WITHDRAW, name: "Withdrawals", body: "When a withdrawal or early exit completes." },
  { bit: ALERT_BITS.RATE_CHANGE, name: "Rates and reserves", body: "When a strategy's rate moves, or its reward reserve runs low." },
  { bit: ALERT_BITS.ANNOUNCEMENT, name: "Protocol announcements", body: "Notices posted to the on-chain strategy registry." },
  { bit: ALERT_BITS.RISK, name: "Risk limit", body: "When you hold a strategy above your risk limit." },
  { bit: ALERT_BITS.LIQUIDITY, name: "Withdrawal liquidity", body: "When a trove nears 110% and Stability Pool exits may pause." },
  { bit: ALERT_BITS.BTC_GAINS, name: "BTC gains", body: "When Stability Pool BTC is waiting for you or has been claimed." },
  { bit: ALERT_BITS.UNLOCK, name: "Term unlocks", body: "When your Term Savings position is about to unlock, or has." },
];

function same(a: Prefs, b: Prefs) {
  return (
    a.mask === b.mask &&
    a.rateChangeBps === b.rateChangeBps &&
    a.maxRiskScore === b.maxRiskScore &&
    a.minRunwayDays === b.minRunwayDays &&
    a.minIcrBps === b.minIcrBps
  );
}

function Threshold({
  id,
  label,
  help,
  value,
  min,
  max,
  step,
  onChange,
  display,
}: {
  id: string;
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="text-sm font-semibold tabular">
          {display}
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
        style={{ ["--pct" as string]: `${pct}%` } as React.CSSProperties}
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className="mt-2 text-xs text-silt">
        {help}
      </p>
    </div>
  );
}

/** Notification preferences, stored on-chain in AlertCenter. */
export function PreferencesForm({ prefs, isDefault }: { prefs: Prefs; isDefault: boolean }) {
  const [draft, setDraft] = useState<Prefs | null>(null);
  const { run, busy } = useTx();
  const form = draft ?? prefs;
  const dirty = !same(form, prefs);
  const set = (patch: Partial<Prefs>) => setDraft({ ...form, ...patch });

  async function save() {
    const r = await run([
      {
        title: "Saving alert preferences",
        done: "Alert preferences saved on-chain",
        request: {
          address: ADDR.alerts,
          abi: alertCenterAbi,
          functionName: "setPreferences",
          args: [form.mask, form.rateChangeBps, form.maxRiskScore, form.minRunwayDays, form.minIcrBps],
        },
      },
    ]);
    if (r) setDraft(null);
  }

  return (
    <form
      className="panel p-5 sm:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) save();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">What to alert you about</h2>
        {isDefault ? <Badge>Using defaults</Badge> : <Badge tone="tide">Saved on-chain</Badge>}
      </div>
      <p className="mt-1 text-sm text-silt">Stored in the AlertCenter contract, so they follow your wallet to any device.</p>

      <ul className="mt-5 grid gap-1">
        {TYPES.map((t) => {
          const on = (form.mask & t.bit) !== 0;
          const id = `alert-type-${t.bit}`;
          return (
            <li key={t.bit} className="flex items-start justify-between gap-4 rounded-[10px] px-1 py-2.5">
              <div className="min-w-0">
                <p id={id} className="text-sm font-medium">
                  {t.name}
                </p>
                <p className="mt-0.5 text-xs text-silt">{t.body}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={id}
                className="toggle mt-0.5"
                onClick={() => set({ mask: on ? form.mask & ~t.bit : form.mask | t.bit })}
              />
            </li>
          );
        })}
      </ul>

      <div className="mt-6 grid gap-6 border-t rule pt-6">
        <Threshold
          id="pref-rate"
          label="Rate change worth telling you about"
          help="Ignore smaller moves in a strategy's annual rate."
          value={form.rateChangeBps}
          min={10}
          max={500}
          step={10}
          onChange={(v) => set({ rateChangeBps: v })}
          display={`${(form.rateChangeBps / 100).toFixed(2)} points`}
        />
        <Threshold
          id="pref-risk"
          label="Highest risk you're comfortable holding"
          help="Holding anything scored above this raises a warning."
          value={form.maxRiskScore}
          min={1}
          max={5}
          step={1}
          onChange={(v) => set({ maxRiskScore: v })}
          display={`${form.maxRiskScore} of 5, ${RISK_LABEL[form.maxRiskScore]?.toLowerCase() ?? ""}`}
        />
        <Threshold
          id="pref-runway"
          label="Warn when a reserve has less than"
          help="Reserve-funded rates stop paying when the reserve is empty."
          value={form.minRunwayDays}
          min={1}
          max={90}
          step={1}
          onChange={(v) => set({ minRunwayDays: v })}
          display={`${form.minRunwayDays} ${form.minRunwayDays === 1 ? "day" : "days"} left`}
        />
        <Threshold
          id="pref-icr"
          label="Warn when the weakest trove drops under"
          help="At 110% Mezo liquidates the trove and Stability Pool withdrawals pause."
          value={form.minIcrBps}
          min={11000}
          max={20000}
          step={50}
          onChange={(v) => set({ minIcrBps: v })}
          display={`${(form.minIcrBps / 100).toFixed(1)}% collateral`}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!dirty || !!busy}>
          {busy ? <span className="spinner" /> : null}
          {busy ? "Saving…" : "Save preferences"}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
            Discard changes
          </button>
        )}
        {!dirty && <span className="text-sm text-silt">No unsaved changes</span>}
      </div>
    </form>
  );
}
