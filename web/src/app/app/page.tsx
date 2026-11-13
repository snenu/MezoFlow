"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "@/hooks/useAccount";
import { PageHeader, ConnectPrompt } from "@/components/app/shell";
import { FaucetButton } from "@/components/app/faucet";
import { LineChart, Legend, StackBar, type Segment } from "@/components/charts";
import { RiskMeter, Skel, Ticker, useNow } from "@/components/ui";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTxHashes, useUserEntries } from "@/hooks/useMezoFlow";
import { useTx } from "@/hooks/useTx";
import { ADDR, KIND, LEDGER_KIND, spVaultAbi } from "@/lib/contracts";
import { describeTarget } from "@/lib/describe";
import { txUrl } from "@/lib/chain";
import { aprToApy, fmtAmount, fmtBtc, fmtDate, fmtDuration, fmtPct, fmtUsd, timeAgo } from "@/lib/format";
import { SERIES, seriesForVault, CHART } from "@/lib/viz";

const RANGES = [
  ["7D", 7 * 86400],
  ["30D", 30 * 86400],
  ["All", Infinity],
] as const;

const money = (n: number) => fmtAmount(n);

export default function OverviewPage() {
  const { isConnected } = useAccount();
  const p = usePortfolio();
  const now = useNow(30_000);
  const [range, setRange] = useState<(typeof RANGES)[number][0]>("All");
  const { run, busy } = useTx();

  const chart = useMemo(() => {
    const span = RANGES.find((r) => r[0] === range)![1];
    const cutoff = now ? now / 1000 - span : 0;
    const pts = p.history.filter((h) => h.t >= cutoff);
    return {
      value: pts.map((h) => ({ t: h.t, v: h.value })),
      net: pts.map((h) => ({ t: h.t, v: h.net })),
    };
  }, [p.history, range, now]);

  const segments: Segment[] = useMemo(
    () => [
      ...p.positions.map((pos) => ({
        key: pos.strategy.meta.vault,
        label: pos.strategy.meta.name,
        value: pos.value,
        color: seriesForVault(pos.strategy.meta.vault),
      })),
      { key: "wallet", label: "In your wallet", value: p.wallet, color: SERIES.wallet, detail: "Not earning" },
    ],
    [p.positions, p.wallet],
  );

  if (!isConnected) {
    return (
      <>
        <PageHeader title="Overview" description="Your MezoFlow portfolio, read live from Mezo Testnet." />
        <ConnectPrompt
          title="Connect a wallet to see your portfolio"
          body="You can browse every strategy, the risk dashboard and the on-chain activity feed without connecting. To deposit or track your own position, connect a wallet on Mezo Testnet."
        />
        <ProtocolGlance />
      </>
    );
  }

  const sp = p.strategies.find((s) => s.meta.kind === KIND.STABILITY_POOL);
  const held = p.positions.filter((x) => x.shares > 0n);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything you hold in MezoFlow, read live from Mezo Testnet."
        actions={
          <>
            <FaucetButton />
            <Link href="/app/allocate" className="btn btn-primary">
              Allocate MUSD
            </Link>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <section className="panel overflow-hidden" aria-labelledby="value-title">
          <div className="slab flex flex-wrap items-start justify-between gap-4 p-6">
            <div>
              <h2 id="value-title" className="slab-muted text-sm font-medium">
                Portfolio value
              </h2>
              <p className="wide mt-2 text-[clamp(2.2rem,1.6rem+2vw,3rem)] font-bold leading-none tracking-[-0.035em]">
                {p.loading ? <span className="inline-block h-10 w-40 rounded bg-white/25 align-middle" /> : <Ticker value={p.totalValue} format={money} />}
                <span className="slab-muted ml-2 text-lg font-semibold">MUSD</span>
              </p>
              <p className="mt-3 text-sm">
                <span className="font-semibold tabular">
                  {p.pnl >= 0 ? "+" : "−"}
                  {fmtAmount(Math.abs(p.pnl))} MUSD
                </span>{" "}
                <span className="slab-muted">all-time result in MUSD, after fees</span>
              </p>
            </div>
            <div className="seg bg-white" role="group" aria-label="Chart range">
              {RANGES.map(([r]) => (
                <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="px-6 pt-6">
            <LineChart
              ariaLabel="Portfolio value compared with net deposits over time"
              height={250}
              series={[
                { key: "net", label: "Net deposited", color: CHART.reference, points: chart.net, reference: true },
                { key: "value", label: "Portfolio value", color: SERIES.flex, points: chart.value, area: true },
              ]}
              formatValue={(v) => fmtAmount(v, { max: v < 100 ? 2 : 0 })}
              formatTime={(t) => fmtDate(t)}
              emptyText="Your value chart starts with your first deposit."
            />
          </div>
          <div className="px-6 pb-6 pt-4">
            <Legend
              items={[
                { label: "Portfolio value", color: SERIES.flex },
                { label: "Net deposited (deposits minus withdrawals)", color: CHART.reference, dashed: true },
              ]}
            />
          </div>
        </section>

        <section className="panel flex flex-col p-6" aria-labelledby="wallet-title">
          <h2 id="wallet-title" className="label">
            Wallet
          </h2>
          <dl className="mt-3 grid gap-5">
            <div>
              <dt className="text-sm text-silt">MUSD available to deposit</dt>
              <dd className="mt-1 text-2xl font-semibold tabular">
                {p.loading ? <Skel w="6rem" /> : <Ticker value={p.wallet} format={money} />}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-silt">BTC for gas</dt>
              <dd className="mt-1 font-semibold tabular">{fmtBtc(p.account?.btcBalance)} BTC</dd>
            </div>
            <div className="rounded-xl border border-ember/30 bg-ember/[0.06] p-4">
              <dt className="text-sm text-silt">BTC earned in the Stability Pool</dt>
              <dd className="mt-1 text-lg font-semibold tabular text-ember">{p.pendingBtc.toFixed(8)} BTC</dd>
              <dd className="text-sm text-silt">
                {p.pendingBtc > 0
                  ? `ready to claim, worth ${fmtUsd(p.pendingBtc * p.btcPrice)} at the Mezo oracle price`
                  : (sp?.user.shares ?? 0n) > 0n
                    ? "Nothing yet. BTC arrives when a trove is liquidated while you hold Stability Pool shares."
                    : "Deposit into the Stability Pool to start earning BTC from liquidations."}
              </dd>
              {sp && sp.user.pendingBtc > 0n && (
                <button
                  className="btn btn-ember mt-3 w-full"
                  disabled={!!busy}
                  onClick={() =>
                    run([
                      {
                        title: "Claiming BTC",
                        done: `Claimed ${fmtBtc(sp.user.pendingBtc)} BTC`,
                        request: { address: ADDR.sp, abi: spVaultAbi, functionName: "claimBtc" },
                      },
                    ])
                  }
                >
                  Claim BTC
                </button>
              )}
            </div>
          </dl>
          {p.wallet < 1 && (
            <div className="mt-5 border-t rule pt-5">
              <p className="text-sm text-silt">You need MUSD to get started. Claim test MUSD from the MezoFlow faucet.</p>
              <FaucetButton className="btn btn-primary mt-3 w-full" />
            </div>
          )}
        </section>
      </div>

      <section className="panel mt-5 p-6" aria-labelledby="where-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="where-title" className="text-lg font-semibold tracking-tight">
            Where your MUSD is
          </h2>
          <p className="text-sm text-silt tabular">{fmtAmount(p.totalValue + p.wallet)} MUSD in total</p>
        </div>
        <div className="mt-5">
          <StackBar segments={segments} format={(v) => `${fmtAmount(v)} MUSD`} />
        </div>
      </section>

      <section className="panel mt-5 overflow-hidden" aria-labelledby="positions-title">
        <div className="flex items-center justify-between px-6 pt-6">
          <h2 id="positions-title" className="text-lg font-semibold tracking-tight">
            Positions
          </h2>
          <Link href="/app/strategies" className="link text-sm">
            Browse strategies
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col" className="text-right">
                  Value
                </th>
                <th scope="col">Earning</th>
                <th scope="col">Status</th>
                <th scope="col">Risk</th>
                <th scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {p.positions.map(({ strategy: s, value }) => {
                const isSp = s.meta.kind === KIND.STABILITY_POOL;
                const isTerm = s.meta.kind === KIND.TERM;
                const unlock = Number(s.user.unlockAt);
                const locked = isTerm && unlock * 1000 > now;
                return (
                  <tr key={s.meta.vault}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seriesForVault(s.meta.vault) }} aria-hidden />
                        <div>
                          <Link href={`/app/strategies/${s.meta.slug}`} className="font-semibold hover:text-tide">
                            {s.meta.name}
                          </Link>
                          <p className="text-xs text-silt">{s.meta.protocol}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-right">
                      <span className="font-semibold tabular">{fmtAmount(value)}</span>
                      <span className="text-silt"> MUSD</span>
                    </td>
                    <td className="text-sm">
                      {isSp ? (
                        <span className="text-ember">BTC from liquidations</span>
                      ) : (
                        <span className="tabular">
                          {fmtPct(s.stats.rateBps)} APR <span className="text-silt">≈ {aprToApy(s.stats.rateBps).toFixed(2)}% APY</span>
                        </span>
                      )}
                    </td>
                    <td className="text-sm text-mist">
                      {s.user.shares === 0n
                        ? "No position"
                        : isTerm
                          ? locked
                            ? `Locked for ${fmtDuration(unlock - now / 1000)}`
                            : "Unlocked"
                          : isSp
                            ? s.user.pendingBtc > 0n
                              ? `${fmtBtc(s.user.pendingBtc)} BTC to claim`
                              : "Active"
                            : "Withdraw any time"}
                    </td>
                    <td>
                      <RiskMeter score={s.meta.riskScore} size="sm" showLabel={false} />
                    </td>
                    <td className="text-right">
                      <Link href={`/app/strategies/${s.meta.slug}`} className="btn btn-ghost h-9 px-3 text-sm">
                        {s.user.shares > 0n ? "Manage" : "Deposit"}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {held.length === 0 && !p.loading && (
          <p className="border-t rule px-6 py-4 text-sm text-silt">
            You don&apos;t have a position yet. Pick a strategy, or let the{" "}
            <Link className="link" href="/app/allocate">
              auto allocator
            </Link>{" "}
            split your MUSD for you.
          </p>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <section className="panel p-6" aria-labelledby="totals-title">
          <h2 id="totals-title" className="text-lg font-semibold tracking-tight">
            Lifetime totals
          </h2>
          <p className="mt-1 text-sm text-silt">From MezoFlow&apos;s on-chain activity ledger.</p>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
            <Total label="Deposited" value={`${fmtAmount(p.deposited)} MUSD`} />
            <Total label="Withdrawn" value={`${fmtAmount(p.withdrawn)} MUSD`} />
            <Total label="Fees and penalties paid" value={`${fmtAmount(p.fees)} MUSD`} />
            <Total
              label="Result in MUSD"
              value={`${p.pnl >= 0 ? "+" : "−"}${fmtAmount(Math.abs(p.pnl))} MUSD`}
              tone={p.pnl >= 0 ? "text-tide" : "text-coral"}
            />
            <Total label="BTC earned" value={`${(p.pendingBtc + p.claimedBtc).toFixed(8)} BTC`} tone="text-ember" />
            <Total label="Actions recorded" value={p.actions.toString()} />
          </dl>
        </section>
        <RecentActivity />
      </div>
    </>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-sm text-silt">{label}</dt>
      <dd className={`mt-1 font-semibold tabular ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function RecentActivity() {
  const { entries, isLoading } = useUserEntries(6);
  const recent = entries.slice(0, 6);
  const { data: hashes } = useTxHashes(recent);
  const now = useNow(15_000);
  return (
    <section className="panel p-6" aria-labelledby="recent-title">
      <div className="flex items-center justify-between">
        <h2 id="recent-title" className="text-lg font-semibold tracking-tight">
          Recent activity
        </h2>
        <Link href="/app/activity" className="link text-sm">
          Full history
        </Link>
      </div>
      <ul className="mt-4 divide-y divide-shoal/70">
        {isLoading && (
          <li className="py-3">
            <Skel w="70%" />
          </li>
        )}
        {!isLoading && recent.length === 0 && <li className="py-3 text-sm text-silt">Nothing yet. Your deposits and withdrawals will show up here.</li>}
        {recent.map((e) => {
          const hash = hashes?.[e.id.toString()];
          return (
            <li key={e.id.toString()} className="flex items-baseline justify-between gap-4 py-3 text-sm">
              <span>
                {LEDGER_KIND[e.kind]?.verb}{" "}
                <span className="font-semibold tabular">
                  {e.kind === 3 ? `${fmtBtc(e.assets)} BTC` : `${fmtAmount(e.assets)} ${e.kind === 7 ? "test MUSD" : "MUSD"}`}
                </span>
                {describeTarget(e.kind, e.vault)}
              </span>
              <span className="flex flex-none items-baseline gap-3">
                <span className="text-silt tabular">{now ? timeAgo(e.timestamp, now) : ""}</span>
                {hash && (
                  <a className="link" href={txUrl(hash)} target="_blank" rel="noreferrer" aria-label="View transaction">
                    Tx
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ProtocolGlance() {
  const p = usePortfolio();
  return (
    <section className="mt-6 grid gap-5 md:grid-cols-3">
      {p.strategies.map((s) => (
        <Link
          key={s.meta.vault}
          href={`/app/strategies/${s.meta.slug}`}
          className="panel group block p-5 transition-colors hover:border-reef"
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold group-hover:text-tide">{s.meta.name}</p>
            <RiskMeter score={s.meta.riskScore} size="sm" showLabel={false} />
          </div>
          <p className={`mt-3 text-2xl font-semibold tabular ${s.meta.kind === KIND.STABILITY_POOL ? "text-ember" : "text-tide"}`}>
            {s.meta.kind === KIND.STABILITY_POOL ? "BTC" : `${fmtPct(s.stats.rateBps)}`}
          </p>
          <p className="text-sm text-silt">
            {s.meta.kind === KIND.STABILITY_POOL ? "earned from liquidations" : "APR from the reward reserve"}
          </p>
          <p className="mt-4 text-sm text-mist tabular">{fmtAmount(s.stats.totalAssets)} MUSD deposited</p>
        </Link>
      ))}
    </section>
  );
}
