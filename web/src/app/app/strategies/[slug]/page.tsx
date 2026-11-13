"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ActionPanel } from "@/components/strategy/action-panel";
import { LineChart } from "@/components/charts";
import { AddressLink, Badge, RiskMeter, Skel, useNow } from "@/components/ui";
import { useMezoFlow, useSpHealth, useUserEntries, useVaultHistory } from "@/hooks/useMezoFlow";
import { KIND, MEZO } from "@/lib/contracts";
import { STRATEGY_COPY } from "@/lib/strategy-copy";
import { aprToApy, fmtAmount, fmtBtc, fmtDate, fmtDuration, fmtPct, fmtUsd, toNum } from "@/lib/format";
import { seriesForVault } from "@/lib/viz";

export default function StrategyPage() {
  const { slug } = useParams<{ slug: string }>();
  const { strategies, isLoading } = useMezoFlow();
  const s = strategies.find((x) => x.meta.slug === slug);
  const { byVault } = useVaultHistory();
  const { health, btc } = useSpHealth();
  const { entries } = useUserEntries(500);
  const now = useNow(30_000);

  const history = s ? byVault[s.meta.vault.toLowerCase()] : undefined;
  const pricePoints = useMemo(() => {
    if (!history || !s) return [];
    const pts = history.checkpoints.map((c) => ({ t: c.t, v: toNum(c.price) }));
    if (now) pts.push({ t: Math.floor(now / 1000), v: toNum(s.stats.sharePrice) });
    return pts;
  }, [history, s, now]);

  const mine = useMemo(() => {
    if (!s) return { net: 0 };
    let net = 0;
    for (const e of entries) {
      if (e.vault.toLowerCase() !== s.meta.vault.toLowerCase()) continue;
      if (e.kind === 0) net += toNum(e.assets);
      if (e.kind === 1 || e.kind === 4) net -= toNum(e.assets);
    }
    return { net };
  }, [entries, s]);

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <Skel w="30%" h="2rem" />
        <Skel w="60%" />
        <Skel w="100%" h="18rem" />
      </div>
    );
  }
  if (!s) {
    return (
      <div className="panel p-8">
        <h1 className="text-xl font-semibold">Strategy not found</h1>
        <p className="mt-2 text-silt">There is no registered strategy called &ldquo;{slug}&rdquo;.</p>
        <Link href="/app/strategies" className="btn btn-ghost mt-4">
          See all strategies
        </Link>
      </div>
    );
  }

  const isSp = s.meta.kind === KIND.STABILITY_POOL;
  const isTerm = s.meta.kind === KIND.TERM;
  const copy = STRATEGY_COPY[s.meta.kind];
  const value = toNum(s.user.assets);
  const earned = value - mine.net;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-silt">
        <Link href="/app/strategies" className="hover:text-foam">
          Strategies
        </Link>
        <span aria-hidden className="mx-2">/</span>
        <span className="text-mist">{s.meta.name}</span>
      </nav>

      <header className="mb-8 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-3.5 w-3.5 rounded-[4px]" style={{ background: seriesForVault(s.meta.vault) }} aria-hidden />
            <h1 className="text-[clamp(1.9rem,1.4rem+1.8vw,2.6rem)] font-bold leading-tight tracking-[-0.03em]">{s.meta.name}</h1>
            {s.meta.active ? <Badge tone="tide">Live on testnet</Badge> : <Badge tone="sun">Not accepting deposits</Badge>}
          </div>
          <p className="mt-1 text-silt">{s.meta.protocol}</p>
          <p className="mt-3 max-w-[64ch] leading-relaxed text-mist">{s.meta.summary}</p>
        </div>
        <RiskMeter score={s.meta.riskScore} />
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <div className="grid min-w-0 gap-6">
          <section className="panel p-6" aria-label="Key figures">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
              <div>
                <dt className="label">Return</dt>
                <dd className={`mt-1.5 text-2xl font-semibold tabular ${isSp ? "text-ember" : "text-tide"}`}>
                  {isSp ? "BTC" : fmtPct(s.stats.rateBps)}
                </dd>
                <dd className="text-sm text-silt">{isSp ? "variable, from liquidations" : `APR, ≈ ${aprToApy(s.stats.rateBps).toFixed(2)}% APY`}</dd>
              </div>
              <div>
                <dt className="label">Deposited</dt>
                <dd className="mt-1.5 text-2xl font-semibold tabular">{fmtAmount(s.stats.totalAssets)}</dd>
                <dd className="text-sm text-silt">MUSD by {s.stats.depositorCount.toString()} depositors</dd>
              </div>
              <div>
                <dt className="label">Share price</dt>
                <dd className="mt-1.5 text-2xl font-semibold tabular">{toNum(s.stats.sharePrice).toFixed(6)}</dd>
                <dd className="text-sm text-silt">MUSD per share</dd>
              </div>
              <div>
                <dt className="label">Withdrawable now</dt>
                <dd className="mt-1.5 text-2xl font-semibold tabular">{fmtAmount(s.stats.availableLiquidity)}</dd>
                <dd className="text-sm text-silt">MUSD across all depositors</dd>
              </div>
              {!isSp && (
                <>
                  <div>
                    <dt className="label">Reward reserve</dt>
                    <dd className="mt-1.5 font-semibold tabular">{fmtAmount(s.stats.rewardReserve)} MUSD</dd>
                  </div>
                  <div>
                    <dt className="label">Reserve lasts</dt>
                    <dd className="mt-1.5 font-semibold tabular">{fmtDuration(Number(s.stats.runwaySeconds))}</dd>
                    <dd className="text-xs text-silt">at today&apos;s deposits</dd>
                  </div>
                  <div>
                    <dt className="label">Paid out so far</dt>
                    <dd className="mt-1.5 font-semibold tabular">{fmtAmount(s.stats.totalRewardsPaid)} MUSD</dd>
                  </div>
                </>
              )}
              {isSp && (
                <>
                  <div>
                    <dt className="label">BTC distributed</dt>
                    <dd className="mt-1.5 font-semibold tabular text-ember">{fmtBtc(btc?.totalDistributed)} BTC</dd>
                  </div>
                  <div>
                    <dt className="label">Pool withdrawals</dt>
                    <dd className={`mt-1.5 font-semibold ${health?.withdrawalsOpen ? "text-tide" : "text-coral"}`}>
                      {health ? (health.withdrawalsOpen ? "Open" : "Paused") : "…"}
                    </dd>
                    <dd className="text-xs text-silt">
                      weakest trove {health ? `${(toNum(health.lowestIcr) * 100).toFixed(1)}%` : "…"}
                    </dd>
                  </div>
                  <div>
                    <dt className="label">In Mezo&apos;s pool</dt>
                    <dd className="mt-1.5 font-semibold tabular">{fmtAmount(health?.vaultDeposit)} MUSD</dd>
                    <dd className="text-xs text-silt">of {fmtAmount(health?.poolTotalDeposits)} total</dd>
                  </div>
                </>
              )}
              <div>
                <dt className="label">Exit fee</dt>
                <dd className="mt-1.5 font-semibold tabular">{s.stats.exitFeeBps > 0 ? fmtPct(s.stats.exitFeeBps) : "None"}</dd>
                <dd className="text-xs text-silt">{fmtAmount(s.stats.feesCollected)} MUSD collected</dd>
              </div>
            </dl>
          </section>

          <section className="panel p-6" aria-labelledby="price-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="price-title" className="text-lg font-semibold tracking-tight">
                Share price
              </h2>
              <p className="text-sm text-silt">MUSD each share is worth, from on-chain checkpoints</p>
            </div>
            <div className="mt-5">
              <LineChart
                ariaLabel={`${s.meta.name} share price over time`}
                height={220}
                series={[{ key: "pps", label: "Share price", color: seriesForVault(s.meta.vault), points: pricePoints, area: true }]}
                formatValue={(v) => v.toFixed(6)}
                formatTime={(t) => fmtDate(t)}
                emptyText="The share price chart fills in as deposits and withdrawals happen."
              />
            </div>
            {isSp && (
              <p className="mt-3 text-sm text-silt">
                The share price only tracks MUSD. It dips when liquidations swap pool MUSD for BTC; that BTC is paid out
                separately and shows up under &ldquo;BTC distributed&rdquo;.
              </p>
            )}
          </section>

          <section className="panel p-6" aria-labelledby="how-title">
            <h2 id="how-title" className="text-lg font-semibold tracking-tight">
              How it works
            </h2>
            <ol className="mt-4 grid gap-4">
              {copy.howItWorks.map((step, i) => (
                <li key={i} className="grid grid-cols-[2rem_1fr] gap-3">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-reef text-sm font-semibold text-tide">
                    {i + 1}
                  </span>
                  <p className="leading-relaxed text-mist">{step}</p>
                </li>
              ))}
            </ol>
            <dl className="mt-6 grid gap-4 border-t rule pt-5 md:grid-cols-2">
              <div>
                <dt className="font-semibold">Where the return comes from</dt>
                <dd className="mt-1 text-sm leading-relaxed text-silt">{copy.yieldSource}</dd>
              </div>
              <div>
                <dt className="font-semibold">Withdrawal conditions</dt>
                <dd className="mt-1 text-sm leading-relaxed text-silt">{copy.withdrawals}</dd>
              </div>
            </dl>
          </section>

          <section id="risks" className="panel scroll-mt-24 p-6" aria-labelledby="risk-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="risk-title" className="text-lg font-semibold tracking-tight">
                Risks, in plain words
              </h2>
              <Link href="/app/risk" className="link text-sm">
                Open the risk dashboard
              </Link>
            </div>
            <ul className="mt-4 divide-y divide-shoal/70">
              {copy.risks.map((r) => (
                <li key={r.name} className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <div className="mt-1.5">
                      <RiskMeter score={r.level} size="sm" />
                    </div>
                  </div>
                  <p className="leading-relaxed text-silt">{r.plain}</p>
                </li>
              ))}
            </ul>
            <div className="mt-2 rounded-xl border border-shoal bg-trench/50 p-4">
              <p className="text-sm font-semibold">How you could lose money</p>
              <p className="mt-1 text-sm leading-relaxed text-silt">{copy.lossScenario}</p>
            </div>
          </section>

          <section className="panel p-6" aria-labelledby="contracts-title">
            <h2 id="contracts-title" className="text-lg font-semibold tracking-tight">
              Contracts
            </h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-silt">{s.meta.name} vault (ERC-4626)</dt>
                <dd>
                  <AddressLink address={s.meta.vault} />
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-silt">Deposit asset: MUSD</dt>
                <dd>
                  <AddressLink address={MEZO.MUSD} />
                </dd>
              </div>
              {isSp && (
                <>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-silt">Mezo MUSD Stability Pool</dt>
                    <dd>
                      <AddressLink address={MEZO.StabilityPool} />
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-silt">Mezo price feed</dt>
                    <dd>
                      <AddressLink address={MEZO.PriceFeed} />
                    </dd>
                  </div>
                </>
              )}
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-silt">Added to the registry</dt>
                <dd className="tabular">{fmtDate(s.meta.addedAt)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="grid gap-5 xl:sticky xl:top-24">
          <ActionPanel s={s} />
          {s.user.shares > 0n && (
            <section className="panel p-5" aria-labelledby="pos-title">
              <h2 id="pos-title" className="font-semibold">
                Your position
              </h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-silt">Value</dt>
                  <dd className="font-semibold tabular">{fmtAmount(value)} MUSD</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silt">Shares</dt>
                  <dd className="tabular">{fmtAmount(s.user.shares)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silt">Net deposited</dt>
                  <dd className="tabular">{fmtAmount(mine.net)} MUSD</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-silt">Change in MUSD</dt>
                  <dd className={`font-semibold tabular ${earned >= 0 ? "text-tide" : "text-coral"}`}>
                    {earned >= 0 ? "+" : "−"}
                    {fmtAmount(Math.abs(earned), { max: 4 })} MUSD
                  </dd>
                </div>
                {isTerm && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-silt">Unlocks</dt>
                    <dd className="tabular">
                      {Number(s.user.unlockAt) * 1000 > now ? fmtDate(s.user.unlockAt) : "Unlocked"}
                    </dd>
                  </div>
                )}
                {isSp && (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-silt">BTC to claim</dt>
                      <dd className="tabular text-ember">{fmtBtc(s.user.pendingBtc)} BTC</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-silt">BTC value</dt>
                      <dd className="tabular">{fmtUsd(toNum(s.user.pendingBtc) * toNum(health?.btcPrice))}</dd>
                    </div>
                  </>
                )}
              </dl>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
