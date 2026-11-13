"use client";

import Link from "next/link";
import type { StrategyView } from "@/hooks/useMezoFlow";
import { STRATEGY_COPY } from "@/lib/strategy-copy";
import { KIND, RISK_LABEL } from "@/lib/contracts";
import { fmtAmount, fmtDuration, fmtPct } from "@/lib/format";
import { AddressLink, RiskMeter } from "@/components/ui";

/** One strategy's risks, each explained in plain language next to its live terms. */
export function StrategyRiskCard({ s }: { s: StrategyView }) {
  const copy = STRATEGY_COPY[s.meta.kind];
  const rateVault = s.meta.kind !== KIND.STABILITY_POOL;
  const runway = Number(s.stats.runwaySeconds);
  const lowRunway = rateVault && Number.isFinite(runway) && runway < 14 * 86400;

  return (
    <article className="panel overflow-hidden" aria-labelledby={`risk-${s.meta.slug}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b rule p-5 sm:p-6">
        <div className="min-w-0">
          <h3 id={`risk-${s.meta.slug}`} className="text-lg font-semibold tracking-tight">
            <Link href={`/app/strategies/${s.meta.slug}`} className="hover:text-tide">
              {s.meta.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-silt">{s.meta.protocol}</p>
        </div>
        <div className="text-right">
          <RiskMeter score={s.meta.riskScore} />
          <p className="mt-1 text-xs text-silt">Risk score {s.meta.riskScore} of 5, set in the on-chain registry</p>
        </div>
      </header>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.35fr_1fr]">
        <div>
          <p className="label">What could go wrong</p>
          <ul className="mt-3 grid gap-4">
            {copy?.risks.map((r) => (
              <li key={r.name} className="grid grid-cols-[auto_1fr] gap-x-3">
                <span className="mt-1">
                  <RiskMeter score={r.level} size="sm" showLabel={false} />
                </span>
                <div>
                  <p className="font-semibold">
                    {r.name}
                    <span className="ml-2 text-sm font-normal text-silt">{RISK_LABEL[r.level]}</span>
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-mist">{r.plain}</p>
                </div>
              </li>
            ))}
          </ul>
          {copy && (
            <p className="mt-5 border-l-2 border-coral/60 pl-4 text-sm leading-relaxed text-mist">
              <span className="font-semibold text-foam">Worst realistic case. </span>
              {copy.lossScenario}
            </p>
          )}
        </div>

        <dl className="grid content-start gap-4 rounded-[14px] bg-trench/60 p-4 text-sm">
          <div>
            <dt className="text-silt">Withdrawal conditions</dt>
            <dd className="mt-1 leading-relaxed">{s.meta.liquidityTerms}</dd>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-silt">Exit fee</dt>
              <dd className="mt-1 font-semibold tabular">
                {s.stats.exitFeeBps > 0 ? fmtPct(s.stats.exitFeeBps) : "None"}
              </dd>
            </div>
            <div>
              <dt className="text-silt">Available to withdraw now</dt>
              <dd className="mt-1 font-semibold tabular">{fmtAmount(s.stats.availableLiquidity)} MUSD</dd>
            </div>
          </div>
          {rateVault ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-silt">Reserve left</dt>
                <dd className="mt-1 font-semibold tabular">{fmtAmount(s.stats.rewardReserve)} MUSD</dd>
              </div>
              <div>
                <dt className="text-silt">Reserve runway</dt>
                <dd className={`mt-1 font-semibold tabular ${lowRunway ? "text-sun" : ""}`}>
                  {fmtDuration(runway)}
                  {lowRunway && <span className="ml-1 text-xs font-normal">(running low)</span>}
                </dd>
              </div>
            </div>
          ) : (
            <div>
              <dt className="text-silt">Yield source</dt>
              <dd className="mt-1 leading-relaxed text-mist">BTC from liquidations, which arrive unevenly and can be zero for long periods.</dd>
            </div>
          )}
          <div>
            <dt className="text-silt">Status</dt>
            <dd className="mt-1">
              {s.stats.paused ? (
                <span className="font-semibold text-sun">Deposits paused, withdrawals still open</span>
              ) : (
                <span className="font-semibold text-tide">Accepting deposits</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-silt">Vault contract</dt>
            <dd className="mt-1">
              <AddressLink address={s.meta.vault} />
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
