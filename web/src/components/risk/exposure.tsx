"use client";

import Link from "next/link";
import { useState } from "react";
import type { AccountView, StrategyView } from "@/hooks/useMezoFlow";
import { RISK_LABEL } from "@/lib/contracts";
import { fmtAmount, toNum } from "@/lib/format";
import { SERIES, seriesForVault } from "@/lib/viz";
import { RiskMeter } from "@/components/ui";

type Slice = { key: string; name: string; value: number; color: string; risk: number | null; href?: string };

/** Where the user's MUSD sits, and how much of it is exposed to each risk level. */
export function Exposure({ strategies, account }: { strategies: readonly StrategyView[]; account: AccountView }) {
  const [hover, setHover] = useState<string | null>(null);

  const slices: Slice[] = strategies
    .filter((s) => s.user.assets > 0n)
    .map((s) => ({
      key: s.meta.vault,
      name: s.meta.name,
      value: toNum(s.user.assets),
      color: seriesForVault(s.meta.vault),
      risk: s.meta.riskScore,
      href: `/app/strategies/${s.meta.slug}`,
    }));
  const wallet = toNum(account.musdBalance);
  if (wallet > 0) slices.push({ key: "wallet", name: "In your wallet", value: wallet, color: SERIES.wallet, risk: null });

  const total = slices.reduce((a, b) => a + b.value, 0);
  const deployed = slices.filter((s) => s.risk !== null);
  const deployedTotal = deployed.reduce((a, b) => a + b.value, 0);
  const weighted = deployedTotal > 0 ? deployed.reduce((a, b) => a + b.value * (b.risk ?? 0), 0) / deployedTotal : 0;

  if (total === 0) {
    return (
      <div className="panel p-6">
        <p className="font-semibold">Nothing to measure yet</p>
        <p className="mt-1 max-w-[52ch] text-sm text-silt">
          You have no MUSD in your wallet or in any strategy. Claim test MUSD from the faucet, then come back to see your
          exposure.
        </p>
      </div>
    );
  }

  const groups = [1, 2, 3, 4, 5]
    .map((score) => {
      const items = deployed.filter((d) => d.risk === score);
      return { score, items, value: items.reduce((a, b) => a + b.value, 0) };
    })
    .filter((g) => g.value > 0);

  const active = slices.find((s) => s.key === hover);

  return (
    <div className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Value-weighted risk of your deposits</p>
          <div className="mt-2 flex items-center gap-3">
            {deployedTotal > 0 ? (
              <>
                <span className="text-2xl font-bold tracking-tight tabular">{weighted.toFixed(1)}</span>
                <span className="text-silt">of 5</span>
                <RiskMeter score={weighted} />
              </>
            ) : (
              <span className="text-silt">No deposits yet, everything is in your wallet.</span>
            )}
          </div>
        </div>
        <p className="text-sm text-silt tabular">{fmtAmount(total)} MUSD tracked</p>
      </div>

      {/* stacked bar */}
      <div className="relative mt-6">
        <div className="flex h-4 w-full gap-[2px]" role="img" aria-label="Share of your MUSD by location">
          {slices.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={`${s.name}: ${fmtAmount(s.value)} MUSD, ${((s.value / total) * 100).toFixed(1)}%`}
              onMouseEnter={() => setHover(s.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
              className={`h-full min-w-[3px] transition-opacity ${i === 0 ? "rounded-l-[4px]" : ""} ${
                i === slices.length - 1 ? "rounded-r-[4px]" : ""
              } ${hover && hover !== s.key ? "opacity-45" : ""}`}
              style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            />
          ))}
        </div>
        <div className="mt-2 h-5 text-sm" aria-live="polite">
          {active ? (
            <span>
              <span className="font-semibold">{active.name}</span>{" "}
              <span className="tabular text-mist">
                {fmtAmount(active.value)} MUSD, {((active.value / total) * 100).toFixed(1)}%
              </span>
              {active.risk !== null && <span className="text-silt">, risk {RISK_LABEL[active.risk].toLowerCase()}</span>}
            </span>
          ) : (
            <span className="text-silt">Hover or focus a segment for details.</span>
          )}
        </div>
      </div>

      {/* legend with direct values */}
      <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.color }} aria-hidden />
            {s.href ? (
              <Link href={s.href} className="hover:text-tide">
                {s.name}
              </Link>
            ) : (
              <span>{s.name}</span>
            )}
            <span className="ml-auto tabular text-mist">
              {fmtAmount(s.value)} <span className="text-silt">({((s.value / total) * 100).toFixed(0)}%)</span>
            </span>
          </li>
        ))}
      </ul>

      {groups.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="table min-w-[480px]">
            <caption className="sr-only">Your deposits grouped by risk score</caption>
            <thead>
              <tr>
                <th scope="col">Risk level</th>
                <th scope="col">Strategies</th>
                <th scope="col" className="text-right">
                  Value
                </th>
                <th scope="col" className="text-right">
                  Share of deposits
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.score}>
                  <td>
                    <RiskMeter score={g.score} size="sm" />
                  </td>
                  <td className="text-sm text-mist">{g.items.map((i) => i.name).join(", ")}</td>
                  <td className="text-right tabular">{fmtAmount(g.value)} MUSD</td>
                  <td className="text-right tabular">{((g.value / deployedTotal) * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
