"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FlowCanvas, type Channel } from "@/components/flow-canvas";
import { useMezoFlow, usePresets, useSpHealth } from "@/hooks/useMezoFlow";
import { fmtAmount, fmtPct, parseAmount, toNum } from "@/lib/format";
import { KIND } from "@/lib/contracts";
import { Skel } from "@/components/ui";

function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(min-width: 768px)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true,
  );
}

function spread(n: number, from: number, to: number) {
  if (n <= 1) return [(from + to) / 2];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

type Dest = { key: string; name: string; amount: number; weight: number; detail: string; tone: Channel["tone"] };

const AMOUNT_RE = /^\d{0,9}(\.\d{0,2})?$/;

export function Hero() {
  const { strategies, protocol, isLoading } = useMezoFlow();
  const { data: presets } = usePresets();
  const { health } = useSpHealth();
  const reduce = useReducedMotion();
  const desktop = useIsDesktop();
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
      const rate = Number(s?.stats.rateBps ?? 0) / 10_000;
      return {
        key: v,
        name: s?.meta.name ?? "Strategy",
        amount: part,
        weight: w,
        detail: sp ? "earns BTC from liquidations" : `≈ ${fmtAmount(part * rate)} a year at ${fmtPct(s?.stats.rateBps ?? 0)}`,
        tone: sp ? "btc" : "musd",
      };
    });
    const kept = 1 - out.reduce((a, d) => a + d.weight, 0);
    if (kept > 0.001) {
      out.push({ key: "wallet", name: "Stays in your wallet", amount: amount * kept, weight: kept, detail: "yours to use any time", tone: "muted" });
    }
    return out;
  }, [plan, strategies, amount]);

  const ends = useMemo(() => spread(dests.length || 3, desktop ? 0.12 : 0.16, desktop ? 0.88 : 0.84), [dests.length, desktop]);
  const channels: Channel[] = useMemo(
    () =>
      dests.length
        ? dests.map((d, i) => ({ weight: d.weight, endY: ends[i], tone: d.tone }))
        : [0, 1, 2].map((i) => ({ weight: 1 / 3, endY: ends[i], tone: "musd" as const })),
    [dests, ends],
  );

  const yearly = dests.reduce((a, d) => {
    const s = strategies.find((x) => x.meta.vault === d.key);
    return a + (s && s.stats.rateBps > 0 ? d.amount * (s.stats.rateBps / 10_000) : 0);
  }, 0);
  const earnsBtc = dests.some((d) => d.tone === "btc" && d.weight > 0);
  const amountOk = amount > 0 && amount <= 1_000_000_000;

  const intro = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: 0.1 + i * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title">
      <div aria-hidden className="hero-sky absolute inset-0 -z-20" />
      <div className="relative mx-auto flex max-w-[1400px] flex-col md:min-h-[min(100svh,880px)]">
        <div className="relative z-10 px-5 pt-28 sm:px-10 md:w-[46%] md:pr-0 md:pt-32">
          <motion.h1 id="hero-title" {...intro(0)} className="display max-w-[11ch] text-[clamp(2.6rem,1.4rem+3.6vw,4.5rem)]">
            Make your MUSD work smarter.
          </motion.h1>
          <motion.p {...intro(1)} className="lede mt-5 max-w-[42ch]">
            MezoFlow puts your Bitcoin-backed dollars into savings vaults and Mezo&apos;s Stability Pool, and shows you where
            every MUSD is, live from the chain.
          </motion.p>

          <motion.form {...intro(2)} className="mt-9" onSubmit={(e) => e.preventDefault()} aria-label="Try a plan">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[1.15rem] text-mist">
              <label htmlFor="sim-amount">Put</label>
              <span className="inline-flex items-baseline border-b-2 border-tide px-1">
                <input
                  id="sim-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={value}
                  onChange={(e) => AMOUNT_RE.test(e.target.value) && setValue(e.target.value)}
                  className="bg-transparent text-center text-[1.3rem] font-bold text-foam outline-none"
                  style={{ width: `${Math.max(value.length, 2) + 1}ch` }}
                  aria-describedby="sim-result"
                />
              </span>
              <span>MUSD into the</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[1.15rem] text-mist">
              <span role="radiogroup" aria-label="Plan" className="inline-flex flex-wrap gap-1.5">
                {(presets ?? []).map((p, i) => (
                  <button
                    key={p.name}
                    type="button"
                    role="radio"
                    aria-checked={planId === i}
                    onClick={() => setPlanId(i)}
                    className={`rounded-full px-3.5 py-1 text-[0.95rem] font-semibold transition-colors ${
                      planId === i ? "bg-tide text-white" : "bg-white text-mist ring-1 ring-shoal hover:ring-reef"
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
                  About <span className="font-semibold text-foam tabular">{fmtAmount(yearly)} MUSD a year</span> from savings
                  rates{earnsBtc ? ", plus BTC whenever a trove is liquidated" : ""}. Rates can change; nothing is guaranteed.
                </>
              ) : (
                "Enter an amount to see the split."
              )}
            </p>
          </motion.form>

          <motion.div {...intro(3)} className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={amountOk ? `/app/allocate?plan=${planId}&amount=${encodeURIComponent(value)}` : "/app/allocate"}
              className="btn btn-primary btn-lg"
            >
              Use this plan
            </Link>
            <Link href="/app" className="btn btn-ghost btn-lg">
              Open the app
            </Link>
          </motion.div>
        </div>

        {/* The flow lives in its own zone so particles never cross the text. */}
        <div className="relative mt-8 h-[300px] md:absolute md:bottom-32 md:left-[46%] md:right-0 md:top-24 md:mt-0 md:h-auto">
          <FlowCanvas channels={channels} sourceX={0.04} sourceY={0.5} endX={desktop ? 0.64 : 0.9} className="h-full w-full" />
          <p
            className="pointer-events-none absolute hidden text-sm font-medium text-mist md:block"
            style={{ left: "2%", top: "calc(50% + 18px)" }}
          >
            Your wallet
          </p>
          <ol className="pointer-events-none absolute inset-0 hidden md:block" aria-label="Where this plan sends your MUSD">
            {dests.map((d, i) => (
              <li
                key={d.key}
                className="absolute -translate-y-1/2 pl-4 transition-[top] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ left: "64%", top: `${ends[i] * 100}%` }}
              >
                <p className="text-sm font-medium text-mist">{d.name}</p>
                <p className={`text-xl font-bold tracking-tight tabular ${d.tone === "muted" ? "text-silt" : "text-foam"}`}>
                  {fmtAmount(d.amount)} <span className="text-sm font-semibold text-silt">MUSD</span>
                </p>
                <p className={`text-xs ${d.tone === "btc" ? "text-ember" : d.tone === "muted" ? "text-silt" : "text-tide"}`}>
                  {d.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* mobile: the split as a list */}
        <ol className="grid gap-3 px-5 pb-2 pt-2 md:hidden" aria-label="Where this plan sends your MUSD">
          {dests.map((d) => (
            <li key={d.key} className="flex items-baseline justify-between gap-4 border-b rule pb-3">
              <span className="font-medium">{d.name}</span>
              <span className="text-right">
                <span className="block font-semibold tabular">{fmtAmount(d.amount)} MUSD</span>
                <span className={`block text-xs ${d.tone === "btc" ? "text-ember" : "text-silt"}`}>{d.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* live strip */}
        <div className="relative z-10 mt-auto px-5 pb-8 pt-10 sm:px-10">
          <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t rule pt-5 text-sm">
            <LiveStat label="Deposited in MezoFlow" loading={isLoading}>
              {protocol ? `${fmtAmount(protocol.tvl)} MUSD` : null}
            </LiveStat>
            <LiveStat label="Depositors" loading={isLoading}>
              {protocol ? protocol.uniqueUsers.toString() : null}
            </LiveStat>
            <LiveStat label="Actions on-chain" loading={isLoading}>
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
    <div>
      <dt className="text-silt">{label}</dt>
      <dd className="mt-1 text-base font-semibold tabular">{loading || children === null ? <Skel w="5rem" /> : children}</dd>
    </div>
  );
}
