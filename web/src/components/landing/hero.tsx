"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMezoFlow, usePresets, useSpHealth } from "@/hooks/useMezoFlow";
import { fmtAmount, fmtPct, parseAmount, toNum } from "@/lib/format";
import { KIND } from "@/lib/contracts";
import { Skel } from "@/components/ui";

type Dest = { key: string; name: string; amount: number; weight: number; detail: string; btc: boolean; wallet: boolean };

const AMOUNT_RE = /^\d{0,9}(\.\d{0,2})?$/;

export function Hero() {
  const { strategies, protocol, isLoading } = useMezoFlow();
  const { data: presets } = usePresets();
  const { health } = useSpHealth();
  const [value, setValue] = useState("1000");
  const [planId, setPlanId] = useState(1);

  const amount = toNum(parseAmount(value) ?? 0n);
  const plan = presets?.[planId];

  const dests: Dest[] = useMemo(() => {
    if (!plan) return [];
    const byVault = new Map(strategies.map((s) => [s.meta.vault.toLowerCase(), s]));
    const out: Dest[] = plan.vaults.map((v, i) => {
      const s = byVault.get(v.toLowerCase());
      const w = Number(plan.weightsBps[i]) / 10_000;
      const part = amount * w;
      const sp = s?.meta.kind === KIND.STABILITY_POOL;
      return {
        key: v,
        name: s?.meta.name ?? "Strategy",
        amount: part,
        weight: w,
        detail: sp ? "BTC from liquidations" : `${fmtPct(s?.stats.rateBps ?? 0)} a year`,
        btc: sp,
        wallet: false,
      };
    });
    const kept = 1 - out.reduce((a, d) => a + d.weight, 0);
    if (kept > 0.001) {
      out.push({ key: "wallet", name: "Stays in your wallet", amount: amount * kept, weight: kept, detail: "yours any time", btc: false, wallet: true });
    }
    return out;
  }, [plan, strategies, amount]);

  const yearly = dests.reduce((a, d) => {
    const s = strategies.find((x) => x.meta.vault === d.key);
    return a + (s && s.stats.rateBps > 0 ? d.amount * (s.stats.rateBps / 10_000) : 0);
  }, 0);
  const earnsBtc = dests.some((d) => d.btc && d.weight > 0);
  const amountOk = amount > 0 && amount <= 1_000_000_000;

  return (
    <section className="border-b rule" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-5 pb-14 pt-28 sm:px-10 md:grid-cols-[1fr_minmax(0,500px)] md:gap-14 md:pt-32 lg:pb-20">
        <div className="min-w-0">
          <h1 id="hero-title" className="display max-w-[12ch] text-[clamp(2.5rem,1.3rem+4vw,4.6rem)]">
            Put your MUSD to work.
          </h1>
          <p className="lede mt-6 max-w-[44ch]">
            MezoFlow puts Bitcoin-backed dollars into savings vaults and Mezo&apos;s Stability Pool, in one transaction, and
            shows you where every MUSD is. Everything is read straight from Mezo.
          </p>

          <form className="mt-9" onSubmit={(e) => e.preventDefault()} aria-label="Try a plan">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[1.15rem] text-mist">
              <label htmlFor="sim-amount">Put</label>
              <span className="inline-flex items-baseline border-b-2 border-black px-1">
                <input
                  id="sim-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => AMOUNT_RE.test(e.target.value) && setValue(e.target.value)}
                  className="semi-wide bg-transparent text-center text-[1.3rem] font-bold text-black outline-none tabular"
                  style={{ width: `${Math.max(value.length, 2) + 1}ch` }}
                  aria-describedby="sim-result"
                />
              </span>
              <span>MUSD into the</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[1.15rem] text-mist">
              <span role="radiogroup" aria-label="Plan" className="inline-flex flex-wrap gap-1.5">
                {(presets ?? []).map((p, i) => (
                  <button
                    key={p.name}
                    type="button"
                    role="radio"
                    aria-checked={planId === i}
                    onClick={() => setPlanId(i)}
                    className={`rounded-md border px-3.5 py-1 text-[0.95rem] font-semibold ${
                      planId === i ? "border-black bg-black text-white" : "border-shoal bg-white text-mist hover:border-black"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
                {!presets && <Skel w="16rem" h="2rem" />}
              </span>
              <span>plan.</span>
            </div>
            <p id="sim-result" className="mt-4 max-w-[46ch] text-sm leading-relaxed text-silt" aria-live="polite">
              {amountOk ? (
                <>
                  About <span className="font-semibold text-black tabular">{fmtAmount(yearly)} MUSD a year</span> from savings
                  rates{earnsBtc ? ", plus BTC whenever a trove is liquidated" : ""}. Rates can change and nothing is guaranteed.
                </>
              ) : (
                "Enter an amount to see the split."
              )}
            </p>
          </form>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={amountOk ? `/app/allocate?plan=${planId}&amount=${encodeURIComponent(value)}` : "/app/allocate"}
              className="btn btn-primary btn-lg"
            >
              Use this plan
            </Link>
            <Link href="/app/swap" className="btn btn-ghost btn-lg">
              Start with testnet BTC
            </Link>
          </div>
        </div>

        {/* The rate board: the plan's split, live rates from the vaults. */}
        <div className="slab min-w-0 self-start rounded-lg p-6 sm:p-8" aria-label="Where this plan sends your MUSD">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-semibold">{plan ? `${plan.name} plan` : "Plan"}</p>
            <p className="slab-muted text-sm tabular">{amountOk ? `${fmtAmount(amount)} MUSD` : ""}</p>
          </div>
          <ol className="mt-6 grid gap-5">
            {dests.length === 0 &&
              [0, 1, 2].map((i) => (
                <li key={i} className="grid gap-2">
                  <span className="h-4 w-1/2 rounded bg-white/20" />
                  <span className="h-2 w-full rounded bg-white/20" />
                </li>
              ))}
            {dests.map((d) => (
              <li key={d.key} className="grid gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-medium">{d.name}</span>
                  <span className="wide text-xl font-bold tabular tracking-tight">{fmtAmount(d.amount)}</span>
                </div>
                <div className="h-2 w-full rounded-sm bg-white/20" aria-hidden>
                  <div
                    className={`h-full rounded-sm ${d.wallet ? "bg-white/55" : "bg-white"}`}
                    style={{ width: `${Math.round(d.weight * 100)}%` }}
                  />
                </div>
                <div className="slab-muted flex justify-between text-sm">
                  <span className="tabular">{Math.round(d.weight * 100)}%</span>
                  <span>{d.detail}</span>
                </div>
              </li>
            ))}
          </ol>
          <dl className="slab-rule mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 text-sm">
            <LiveStat label="Deposited in MezoFlow" loading={isLoading}>
              {protocol ? `${fmtAmount(protocol.tvl, { max: 0 })} MUSD` : null}
            </LiveStat>
            <LiveStat label="Depositors" loading={isLoading}>
              {protocol ? protocol.uniqueUsers.toString() : null}
            </LiveStat>
            <LiveStat label="Actions recorded on-chain" loading={isLoading}>
              {protocol ? protocol.entryCount.toString() : null}
            </LiveStat>
            <LiveStat label="BTC, Mezo oracle" loading={!health}>
              {health ? `$${fmtAmount(health.btcPrice, { max: 0 })}` : null}
            </LiveStat>
          </dl>
        </div>
      </div>
    </section>
  );
}

function LiveStat({ label, children, loading }: { label: string; children: React.ReactNode; loading: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="slab-muted">{label}</dt>
      <dd className="mt-1 text-base font-semibold tabular">
        {loading || children === null ? <span className="inline-block h-4 w-16 rounded bg-white/25 align-middle" /> : children}
      </dd>
    </div>
  );
}
