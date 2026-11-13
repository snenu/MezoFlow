"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/app/shell";
import { RiskMeter, Skel } from "@/components/ui";
import { useMezoFlow } from "@/hooks/useMezoFlow";
import { KIND } from "@/lib/contracts";
import { STRATEGY_COPY } from "@/lib/strategy-copy";
import { aprToApy, fmtAmount, fmtDuration, fmtPct, toNum } from "@/lib/format";
import { seriesForVault } from "@/lib/viz";

const SORTS = [
  ["risk", "Lowest risk"],
  ["rate", "Top rate"],
  ["tvl", "Largest"],
] as const;

export default function StrategiesPage() {
  const { strategies, isLoading, protocol } = useMezoFlow();
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("risk");

  const sorted = useMemo(() => {
    const list = [...strategies];
    if (sort === "risk") list.sort((a, b) => a.meta.riskScore - b.meta.riskScore);
    if (sort === "rate") list.sort((a, b) => b.stats.rateBps - a.stats.rateBps);
    if (sort === "tvl") list.sort((a, b) => toNum(b.stats.totalAssets) - toNum(a.stats.totalAssets));
    return list;
  }, [strategies, sort]);

  return (
    <>
      <PageHeader
        title="Strategies"
        description={
          <>
            Every strategy listed here is registered in MezoFlow&apos;s on-chain strategy registry
            {protocol ? `, ${protocol.strategyCount.toString()} live right now` : ""}. Returns, deposits and terms are read from
            each vault contract.
          </>
        }
        actions={
          <div className="seg" role="group" aria-label="Sort strategies">
            {SORTS.map(([k, label]) => (
              <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>
                {label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4">
        {isLoading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="panel p-6">
              <Skel w="40%" h="1.4rem" />
              <div className="mt-3">
                <Skel w="80%" />
              </div>
            </div>
          ))}
        {sorted.map((s) => {
          const isSp = s.meta.kind === KIND.STABILITY_POOL;
          const copy = STRATEGY_COPY[s.meta.kind];
          const held = s.user.shares > 0n;
          return (
            <article key={s.meta.vault} className="panel grid gap-6 p-6 transition-colors hover:border-reef lg:grid-cols-[1.4fr_1.6fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="h-3 w-3 rounded-[3px]" style={{ background: seriesForVault(s.meta.vault) }} aria-hidden />
                  <h2 className="text-xl font-semibold tracking-tight">
                    <Link href={`/app/strategies/${s.meta.slug}`} className="hover:text-tide">
                      {s.meta.name}
                    </Link>
                  </h2>
                  {held && <span className="chip">You hold {fmtAmount(s.user.assets)} MUSD</span>}
                  {s.stats.paused && <span className="chip text-sun">Deposits paused</span>}
                </div>
                <p className="mt-1 text-sm text-silt">{s.meta.protocol}</p>
                <p className="mt-3 max-w-[58ch] leading-relaxed text-mist">{s.meta.summary}</p>
                <p className="mt-3 text-sm text-silt">Good for: {copy?.goodFor}</p>
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 self-start sm:grid-cols-3">
                <div>
                  <dt className="label">Return</dt>
                  <dd className={`mt-1 text-lg font-semibold tabular ${isSp ? "text-ember" : "text-tide"}`}>
                    {isSp ? "BTC, variable" : `${fmtPct(s.stats.rateBps)} APR`}
                  </dd>
                  <dd className="text-xs text-silt">{isSp ? "from liquidations" : `≈ ${aprToApy(s.stats.rateBps).toFixed(2)}% APY`}</dd>
                </div>
                <div>
                  <dt className="label">Deposited</dt>
                  <dd className="mt-1 text-lg font-semibold tabular">{fmtAmount(s.stats.totalAssets)}</dd>
                  <dd className="text-xs text-silt">MUSD, {s.stats.depositorCount.toString()} depositors</dd>
                </div>
                <div>
                  <dt className="label">Risk</dt>
                  <dd className="mt-2">
                    <RiskMeter score={s.meta.riskScore} />
                  </dd>
                </div>
                <div>
                  <dt className="label">Exit fee</dt>
                  <dd className="mt-1 font-semibold tabular">{s.stats.exitFeeBps > 0 ? fmtPct(s.stats.exitFeeBps) : "None"}</dd>
                </div>
                <div>
                  <dt className="label">Minimum</dt>
                  <dd className="mt-1 font-semibold tabular">{fmtAmount(s.stats.minDeposit)} MUSD</dd>
                </div>
                <div>
                  <dt className="label">{isSp ? "Liquid now" : "Reserve lasts"}</dt>
                  <dd className="mt-1 font-semibold tabular">
                    {isSp ? `${fmtAmount(s.stats.availableLiquidity)} MUSD` : fmtDuration(Number(s.stats.runwaySeconds))}
                  </dd>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <dt className="label">Withdrawals</dt>
                  <dd className="mt-1 text-sm text-mist">{s.meta.liquidityTerms}</dd>
                </div>
              </dl>

              <div className="flex items-start gap-2 lg:flex-col lg:items-stretch">
                <Link href={`/app/strategies/${s.meta.slug}`} className="btn btn-primary">
                  {held ? "Manage" : "Deposit"}
                </Link>
                <Link href={`/app/strategies/${s.meta.slug}#risks`} className="btn btn-ghost">
                  Read the risks
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      <section className="panel-quiet mt-8 p-6">
        <h2 className="font-semibold">Not sure where to start?</h2>
        <p className="mt-2 max-w-[70ch] text-silt">
          The auto allocator splits one deposit across these strategies using a Conservative, Balanced or Growth plan, in a
          single transaction. You see the proposed split, the expected earnings and the risks before you sign anything.
        </p>
        <Link href="/app/allocate" className="btn btn-ghost mt-4">
          Try the auto allocator
        </Link>
      </section>
    </>
  );
}
