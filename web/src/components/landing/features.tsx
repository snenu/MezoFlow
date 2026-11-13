"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMezoFlow, usePresets, useSpHealth } from "@/hooks/useMezoFlow";
import { KIND } from "@/lib/contracts";
import { fmtAmount, fmtDuration, toNum } from "@/lib/format";
import { SERIES, seriesForVault } from "@/lib/viz";
import { Skel } from "@/components/ui";

function Row({
  title,
  body,
  href,
  cta,
  flip = false,
  children,
}: {
  title: string;
  body: ReactNode;
  href: string;
  cta: string;
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-10 py-14 md:grid-cols-[5fr_7fr] md:gap-16">
      <div className={`min-w-0 ${flip ? "md:order-2" : ""}`}>
        <h3 className="text-[clamp(1.5rem,1.1rem+1.3vw,2.1rem)] font-bold leading-[1.1] tracking-[-0.03em]">{title}</h3>
        <div className="mt-4 max-w-[46ch] text-[1.02rem] leading-relaxed text-mist">{body}</div>
        <Link href={href} className="link mt-6 inline-block font-medium">
          {cta}
        </Link>
      </div>
      <div className={`stage min-w-0 p-5 sm:p-8 ${flip ? "md:order-1" : ""}`}>{children}</div>
    </div>
  );
}

function PlansFragment() {
  const { strategies } = useMezoFlow();
  const { data: presets } = usePresets();
  const name = (v: string) => strategies.find((s) => s.meta.vault.toLowerCase() === v.toLowerCase())?.meta.name ?? "";
  if (!presets) return <Skel w="100%" h="10rem" />;
  return (
    <ul className="grid grid-cols-1 gap-6" aria-label="Allocator plans stored on-chain">
      {presets.map((p) => {
        const used = p.weightsBps.reduce((a, b) => a + Number(b), 0);
        const parts = [
          ...p.vaults.map((v, j) => ({ label: name(v), pct: Number(p.weightsBps[j]) / 100, color: seriesForVault(v) })),
          ...(used < 10_000 ? [{ label: "Wallet", pct: (10_000 - used) / 100, color: SERIES.wallet }] : []),
        ];
        return (
          <li key={p.name}>
            <div className="flex items-baseline justify-between">
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-silt">risk {p.riskLevel} of 5</p>
            </div>
            <div className="mt-2 flex h-9 gap-[2px] overflow-hidden rounded-[8px]">
              {parts.map((x) => (
                <span
                  key={x.label}
                  className="flex min-w-0 items-center overflow-hidden px-2 text-xs font-semibold text-white"
                  style={{ width: `${x.pct}%`, background: x.color, opacity: x.label === "Wallet" ? 0.55 : 1 }}
                  title={`${x.label} ${x.pct}%`}
                >
                  <span className="truncate">{x.pct >= 15 ? `${x.label} ${x.pct}%` : `${x.pct}%`}</span>
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RiskFragment() {
  const { strategies } = useMezoFlow();
  const { health } = useSpHealth();
  const icr = health ? toNum(health.lowestIcr) * 100 : 0;
  const pos = Math.min(Math.max((icr - 100) / 100, 0), 1) * 100;
  const close = icr > 0 && icr < 120;
  return (
    <div className="grid gap-6">
      <div>
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-mist">Weakest trove on Mezo</p>
          <p className="text-2xl font-bold tracking-tight tabular">{health ? `${icr.toFixed(1)}%` : "…"}</p>
        </div>
        <div className="relative mt-3 h-2.5 rounded-full bg-white">
          <span className="absolute inset-y-0 left-0 rounded-l-full bg-coral/30" style={{ width: "10%" }} />
          <span className="absolute -top-1.5 h-[22px] w-[3px] rounded-full bg-foam transition-[left] duration-700" style={{ left: `${pos}%` }} />
        </div>
        <p className="mt-3 text-sm text-mist">
          {health
            ? health.withdrawalsOpen
              ? close
                ? "Withdrawals are open, but a trove is close to the 110% line. A liquidation may come soon."
                : "Every trove is safely above 110%, so Stability Pool withdrawals are open."
              : "A trove is under 110%, so Stability Pool withdrawals are paused. The idle buffer still pays out."
            : "Reading Mezo…"}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] bg-shoal">
        {strategies
          .filter((s) => s.meta.kind !== KIND.STABILITY_POOL)
          .map((s) => (
            <div key={s.meta.vault} className="bg-white p-4">
              <dt className="text-xs text-silt">{s.meta.name} reserve lasts</dt>
              <dd className="mt-1 font-semibold tabular">{fmtDuration(Number(s.stats.runwaySeconds))}</dd>
            </div>
          ))}
        <div className="bg-white p-4">
          <dt className="text-xs text-silt">BTC price, Mezo oracle</dt>
          <dd className="mt-1 font-semibold tabular">{health ? `$${fmtAmount(health.btcPrice, { max: 0 })}` : "…"}</dd>
        </div>
        <div className="bg-white p-4">
          <dt className="text-xs text-silt">Stability Pool size</dt>
          <dd className="mt-1 font-semibold tabular">{health ? `${fmtAmount(health.poolTotalDeposits)} MUSD` : "…"}</dd>
        </div>
      </dl>
    </div>
  );
}

function AnswersFragment() {
  const { health } = useSpHealth();
  return (
    <div className="grid gap-5">
      <ul className="grid gap-2" aria-label="Example alerts">
        {[
          ["Deposit confirmed", "10.00 MUSD is now in Flexible Savings.", "bg-sky"],
          ["Term Savings unlocks soon", "Your position unlocks in 22 hours.", "bg-sky"],
          ["A trove is close to liquidation", "Below 110%, Stability Pool withdrawals pause.", "bg-sun"],
        ].map(([t, b, dot]) => (
          <li key={t} className="flex items-start gap-3 rounded-[12px] bg-white px-4 py-3">
            <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${dot}`} aria-hidden />
            <span>
              <span className="block text-sm font-semibold">{t}</span>
              <span className="block text-sm text-silt">{b}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 text-sm">
        <p className="ml-auto max-w-[80%] rounded-lg rounded-br-md bg-tide px-4 py-2.5 text-white">Is it safe to withdraw from the Stability Pool now?</p>
        <p className="max-w-[92%] rounded-lg rounded-bl-md bg-white px-4 py-2.5 leading-relaxed text-mist">
          {health
            ? health.withdrawalsOpen
              ? `Yes. Withdrawals are open and the weakest trove is at ${(toNum(health.lowestIcr) * 100).toFixed(1)}%. I read that from Mezo's TroveManager just now.`
              : `Only partly. A trove is at ${(toNum(health.lowestIcr) * 100).toFixed(1)}%, under the 110% line, so only the vault's idle buffer can leave until it is fixed.`
            : "Reading Mezo Testnet…"}
        </p>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  return (
    <section id="features" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 sm:px-10">
      <h2 className="h-section max-w-[20ch]">What changes when your MUSD runs through MezoFlow</h2>
      <div className="mt-6 divide-y divide-shoal">
        <Row
          title="Split once, sign once."
          body={
            <p>
              Pick a plan and the allocator deposits into every vault in a single transaction. The plans live inside the
              allocator contract, so what you see here is exactly what runs. Changed your mind later? Move an existing position
              to a new plan in one step.
            </p>
          }
          href="/app/allocate"
          cta="Plan an allocation"
        >
          <PlansFragment />
        </Row>
        <Row
          flip
          title="The risk sits next to the return."
          body={
            <p>
              Every rate comes with how long its reserve lasts, and every Stability Pool number comes with the health of
              Mezo&apos;s weakest trove. Plain words, live readings, no fine print.
            </p>
          }
          href="/app/risk"
          cta="Open the risk dashboard"
        >
          <RiskFragment />
        </Row>
        <Row
          title="Alerts and answers when something changes."
          body={
            <p>
              Choose which events you care about and save the thresholds on-chain. Ask Flow anything about your MUSD; it
              reads the same contracts you can, and it never moves funds.
            </p>
          }
          href="/app/assistant"
          cta="Ask Flow a question"
        >
          <AnswersFragment />
        </Row>
      </div>
    </section>
  );
}

const FAQ: [string, ReactNode][] = [
  [
    "What is MUSD?",
    "MUSD is Mezo's Bitcoin-backed stablecoin. People mint it by borrowing against BTC on Mezo, and it aims to stay worth one US dollar.",
  ],
  [
    "Where does the return come from?",
    "Flexible and Term Savings pay a fixed rate from an on-chain reward reserve funded by protocol fees. The Stability Pool strategy earns BTC when Mezo troves are liquidated. MezoFlow shows the source next to every number.",
  ],
  [
    "Can I lose money?",
    "Yes. The Stability Pool converts some MUSD into BTC during liquidations, and BTC can fall. Leaving Term Savings early costs 1.5%. And the contracts are new: reviewed internally, but not audited by a third party. The risk dashboard spells out each case.",
  ],
  [
    "Can I withdraw at any time?",
    "Flexible Savings, yes. Term Savings after its 7-day lock, or earlier with a penalty. The Stability Pool vault keeps a 10% buffer you can always withdraw; the rest follows Mezo's rule that withdrawals pause while any trove is under 110% collateral.",
  ],
  [
    "Does MezoFlow hold my funds?",
    "Your MUSD sits in the vault contracts, and your wallet holds the vault shares. No one at MezoFlow can withdraw on your behalf, and every action needs your signature.",
  ],
  [
    "Which network is this on?",
    "Mezo Testnet (chain 31611). Get testnet BTC from the Mezo faucet, then swap some of it for MUSD on the Get MUSD page. Gas costs a tiny fraction of a cent in BTC.",
  ],
];

export function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-24 sm:px-10">
      <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
        <div>
          <h2 className="h-section max-w-[12ch]">Questions people ask first</h2>
          <p className="lede mt-4">
            Still unsure? <Link className="link" href="/app/assistant">Ask Flow</Link>, which answers from live chain data.
          </p>
        </div>
        <div className="divide-y divide-shoal border-y rule">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-4 text-[1.05rem] font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  aria-hidden
                  className="grid h-7 w-7 flex-none place-items-center rounded-full border border-shoal text-tide transition-transform duration-300 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="max-w-[62ch] pb-5 leading-relaxed text-mist">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBand() {
  const { protocol } = useMezoFlow();
  return (
    <section className="border-t rule">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-24 sm:px-10 md:grid-cols-[1.5fr_1fr] md:items-end">
        <div>
          <h2 className="display text-[clamp(2.2rem,1.4rem+3vw,3.8rem)]">From the Mezo faucet to a funded vault in a minute.</h2>
          <p className="lede mt-5">
            Get testnet BTC, then swap it into any strategy in one transaction. No separate approve, no second step
            {protocol && protocol.swapCount > 0n ? `. ${protocol.swapCount.toString()} swaps have gone through MezoFlow so far` : ""}.
          </p>
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <Link href="/app/swap" className="btn btn-primary btn-lg w-full md:w-auto">
            Get MUSD with BTC
          </Link>
          <a
            href="https://faucet.test.mezo.org"
            target="_blank"
            rel="noreferrer"
            className="link text-sm"
          >
            Get testnet BTC from the Mezo faucet
          </a>
        </div>
      </div>
    </section>
  );
}
