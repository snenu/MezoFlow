"use client";

import { useAccount } from "wagmi";
import { PageHeader, ConnectPrompt } from "@/components/app/shell";
import { useMezoFlow, useSpHealth } from "@/hooks/useMezoFlow";
import { ADDR, KIND, MEZO } from "@/lib/contracts";
import { fmtAmount, fmtBtc, fmtPct, toNum } from "@/lib/format";
import { AddressLink, Skel, Stat } from "@/components/ui";
import { IcrGauge, icrState } from "@/components/risk/icr-gauge";
import { StrategyRiskCard } from "@/components/risk/strategy-risks";
import { Exposure } from "@/components/risk/exposure";
import { ScenarioCalculator } from "@/components/risk/scenario";

function poolShare(part: bigint | undefined, whole: bigint | undefined): string {
  const p = toNum(part ?? 0n);
  const w = toNum(whole ?? 0n);
  if (!w || !p) return "0%";
  const pct = (p / w) * 100;
  if (pct < 0.01) return "under 0.01%";
  return `${pct.toFixed(2)}%`;
}

export default function RiskPage() {
  const { isConnected } = useAccount();
  const { strategies, account, isLoading } = useMezoFlow();
  const { health, btc } = useSpHealth();
  const sp = strategies.find((s) => s.meta.kind === KIND.STABILITY_POOL);
  const spAssets = toNum(sp?.user.assets ?? 0n);
  const state = icrState(toNum(health?.lowestIcr ?? 0n), health?.withdrawalsOpen);

  return (
    <>
      <PageHeader
        title="Risk dashboard"
        description="What could go wrong with each strategy, explained plainly and shown next to live readings from Mezo's own contracts."
      />

      {/* Live protocol telemetry */}
      <section aria-labelledby="sp-health" className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="panel p-5 sm:p-6">
          <h2 id="sp-health" className="text-lg font-semibold tracking-tight">
            Mezo Stability Pool health
          </h2>
          <p className="mt-1 text-sm text-silt">
            Read live from Mezo&apos;s SortedTroves, TroveManager and price oracle through the Stability Pool vault.
          </p>
          <div className="mt-6">
            {health ? <IcrGauge lowestIcr={health.lowestIcr} mcr={health.mcr} open={health.withdrawalsOpen} /> : <Skel w="100%" h="7rem" />}
          </div>
        </div>

        <div className="panel flex flex-col p-5 sm:p-6">
          <h2 className="text-lg font-semibold tracking-tight">Can Stability Pool money leave right now?</h2>
          {health ? (
            <>
              <p
                className={`mt-4 text-2xl font-bold tracking-tight ${health.withdrawalsOpen ? "text-tide" : "text-coral"}`}
                role="status"
              >
                {health.withdrawalsOpen ? "Yes, withdrawals are open" : "Only the idle buffer"}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-mist">
                {health.withdrawalsOpen
                  ? "Every trove on Mezo is above 110% collateral, so the Stability Pool lets depositors withdraw in full."
                  : "A trove is below 110% collateral. Mezo's Stability Pool blocks withdrawals until it is liquidated or topped up, so only MUSD held idle in the vault can leave."}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-silt">
                Withdrawals may be delayed if any trove falls below 110% collateral. MezoFlow keeps{" "}
                {fmtPct(Number(health.bufferBps), 0)} of the vault idle so smaller exits stay instant even then.
              </p>
              <dl className="mt-auto grid grid-cols-2 gap-4 border-t rule pt-5">
                <Stat label="Idle buffer" source="StabilityPoolVault.spHealth()">
                  {fmtAmount(health.idle)} MUSD
                </Stat>
                <Stat label="In the pool" source="StabilityPool.getCompoundedMUSDDeposit()">
                  {fmtAmount(health.vaultDeposit)} MUSD
                </Stat>
              </dl>
            </>
          ) : (
            <Skel w="100%" h="8rem" className="mt-4" />
          )}
        </div>
      </section>

      <section aria-label="Protocol readings" className="panel-quiet mt-6 p-5 sm:p-6">
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="BTC price, Mezo oracle" source="PriceFeed.fetchPrice()">
            {health ? `$${fmtAmount(health.btcPrice, { max: 0 })}` : <Skel />}
          </Stat>
          <Stat label="System collateral (TCR)" source="TroveManager.getTCR()" hint="Below 150% Mezo enters recovery mode">
            {health ? `${(toNum(health.tcr) * 100).toFixed(1)}%` : <Skel />}
          </Stat>
          <Stat label="MUSD in the Stability Pool" source="StabilityPool.getTotalMUSDDeposits()">
            {health ? fmtAmount(health.poolTotalDeposits) : <Skel />}
          </Stat>
          <Stat label="MezoFlow's share of the pool" source="vault deposit ÷ pool total">
            {health ? poolShare(health.vaultDeposit, health.poolTotalDeposits) : <Skel />}
          </Stat>
          <Stat label="BTC gains waiting in the pool" source="StabilityPool.getDepositorCollateralGain()">
            {health ? `${fmtBtc(health.vaultPendingGain)} BTC` : <Skel />}
          </Stat>
          <Stat label="BTC paid out to vault holders" source="StabilityPoolVault.btcStats()">
            {btc ? `${fmtBtc(btc.totalDistributed)} BTC` : <Skel />}
          </Stat>
        </dl>
        {state === "close" && (
          <p className="mt-5 text-sm text-sun">
            The weakest trove is within 10 points of the liquidation line. A liquidation may come soon, which would convert part of
            the pool&apos;s MUSD into BTC.
          </p>
        )}
      </section>

      {/* Your exposure */}
      <section aria-labelledby="exposure" className="mt-14">
        <h2 id="exposure" className="text-xl font-semibold tracking-tight">
          Your exposure
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-silt">
          Where your MUSD sits right now, weighted by each strategy&apos;s on-chain risk score.
        </p>
        <div className="mt-5">
          {!isConnected ? (
            <ConnectPrompt title="Connect to see your exposure" body="Your positions are read from each vault for the connected address." />
          ) : account ? (
            <Exposure strategies={strategies} account={account} />
          ) : (
            <Skel w="100%" h="10rem" />
          )}
        </div>
      </section>

      {/* Per-strategy breakdown */}
      <section aria-labelledby="by-strategy" className="mt-14">
        <h2 id="by-strategy" className="text-xl font-semibold tracking-tight">
          Strategy by strategy
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-silt">
          Each risk is scored from 1 to 5 and explained in plain language. Terms and reserve figures come from the vault contracts.
        </p>
        <div className="mt-5 grid gap-6">
          {isLoading && [0, 1, 2].map((i) => <Skel key={i} w="100%" h="14rem" />)}
          {strategies.map((s) => (
            <StrategyRiskCard key={s.meta.vault} s={s} />
          ))}
        </div>
      </section>

      {/* Scenario */}
      <section aria-labelledby="scenario" className="mt-14">
        <h2 id="scenario" className="text-xl font-semibold tracking-tight">
          What a liquidation does to a Stability Pool position
        </h2>
        <p className="mt-1 max-w-[62ch] text-sm text-silt">
          Move the sliders to see how your MUSD turns into BTC, and when a falling BTC price turns that into a loss.
        </p>
        <div className="mt-5">
          <ScenarioCalculator key={spAssets > 0 ? "held" : "none"} defaultPosition={spAssets} btcPrice={health?.btcPrice} />
        </div>
      </section>

      {/* Contracts */}
      <section aria-labelledby="risk-contracts" className="mt-14">
        <h2 id="risk-contracts" className="text-xl font-semibold tracking-tight">
          Contracts behind these numbers
        </h2>
        <div className="panel mt-5 overflow-x-auto">
          <table className="table min-w-[560px]">
            <tbody>
              {(
                [
                  ["Flexible Savings vault", ADDR.flex, "MezoFlow"],
                  ["Term Savings vault", ADDR.term, "MezoFlow"],
                  ["Stability Pool vault", ADDR.sp, "MezoFlow"],
                  ["Fee manager", ADDR.fees, "MezoFlow"],
                  ["Stability Pool", MEZO.StabilityPool, "Mezo"],
                  ["Trove manager", MEZO.TroveManager, "Mezo"],
                  ["Sorted troves", MEZO.SortedTroves, "Mezo"],
                  ["Price feed (BTC oracle)", MEZO.PriceFeed, "Mezo"],
                ] as const
              ).map(([name, addr, owner]) => (
                <tr key={addr}>
                  <td className="font-semibold">{name}</td>
                  <td className="text-sm text-silt">{owner}</td>
                  <td className="text-right">
                    <AddressLink address={addr} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
