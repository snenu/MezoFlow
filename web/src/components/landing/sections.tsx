"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMezoFlow } from "@/hooks/useMezoFlow";
import { ADDR, KIND, MEZO } from "@/lib/contracts";
import { addressUrl } from "@/lib/chain";
import { aprToApy, fmtAmount, fmtPct, shortAddr } from "@/lib/format";
import { RiskMeter, Skel } from "@/components/ui";

export function StrategiesSection() {
  const { strategies, isLoading } = useMezoFlow();
  const router = useRouter();
  return (
    <section id="strategies" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-24 sm:px-10">
      <div className="grid gap-6 md:grid-cols-[1fr_1.2fr] md:items-end">
        <h2 className="h-section max-w-[16ch]">Three places your MUSD can go</h2>
        <p className="lede">
          Each strategy is its own vault contract. The marketplace below is read from the on-chain strategy registry, so a
          new strategy appears here the moment it is registered.
        </p>
      </div>

      {/* Phones and tablets: one stacked row per strategy, nothing to scroll sideways. */}
      <ul className="panel mt-12 divide-y divide-shoal lg:hidden" aria-label="Strategies">
        {isLoading &&
          [0, 1, 2].map((i) => (
            <li key={i} className="p-5">
              <Skel w="100%" h="5rem" />
            </li>
          ))}
        {strategies.map((s) => {
          const sp = s.meta.kind === KIND.STABILITY_POOL;
          return (
            <li key={s.meta.vault} className="p-5">
              <Link href={`/app/strategies/${s.meta.slug}`} className="text-lg font-semibold hover:text-tide">
                {s.meta.name}
              </Link>
              <p className="mt-1 text-sm leading-relaxed text-silt">{s.meta.summary}</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-silt">Return</dt>
                  <dd className="mt-0.5 font-semibold tabular">
                    {sp ? "Variable, in BTC" : `${fmtPct(s.stats.rateBps)} APR`}
                  </dd>
                </div>
                <div>
                  <dt className="text-silt">Risk</dt>
                  <dd className="mt-1">
                    <RiskMeter score={s.meta.riskScore} />
                  </dd>
                </div>
                <div>
                  <dt className="text-silt">Deposited</dt>
                  <dd className="mt-0.5 font-semibold tabular">{fmtAmount(s.stats.totalAssets)} MUSD</dd>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-silt">Withdrawals</dt>
                  <dd className="mt-0.5 text-mist">{s.meta.liquidityTerms}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      <div className="panel mt-12 hidden overflow-x-auto lg:block">
        <table className="table min-w-[860px]">
          <thead>
            <tr>
              <th scope="col">Strategy</th>
              <th scope="col">Return</th>
              <th scope="col">Withdrawals</th>
              <th scope="col">Risk</th>
              <th scope="col" className="text-right">
                Deposited
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              [0, 1, 2].map((i) => (
                <tr key={i}>
                  <td colSpan={5}>
                    <Skel w="100%" h="2.5rem" />
                  </td>
                </tr>
              ))}
            {strategies.map((s) => {
              const sp = s.meta.kind === KIND.STABILITY_POOL;
              const href = `/app/strategies/${s.meta.slug}`;
              return (
                <tr key={s.meta.vault} data-href={href} onClick={() => router.push(href)}>
                  <td className="max-w-[340px]">
                    <Link href={href} className="font-semibold hover:text-tide" onClick={(e) => e.stopPropagation()}>
                      {s.meta.name}
                    </Link>
                    <p className="mt-1 text-sm leading-relaxed text-silt">{s.meta.summary}</p>
                  </td>
                  <td className="whitespace-nowrap">
                    {sp ? (
                      <>
                        <span className="font-semibold text-ember">Variable, in BTC</span>
                        <p className="text-sm text-silt">From liquidations</p>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-tide tabular">{fmtPct(s.stats.rateBps)} APR</span>
                        <p className="text-sm text-silt tabular">≈ {aprToApy(s.stats.rateBps).toFixed(2)}% APY</p>
                      </>
                    )}
                  </td>
                  <td className="max-w-[240px] text-sm text-mist">{s.meta.liquidityTerms}</td>
                  <td>
                    <RiskMeter score={s.meta.riskScore} />
                  </td>
                  <td className="text-right tabular font-semibold">{fmtAmount(s.stats.totalAssets)} MUSD</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm text-silt">
        Rates are paid from on-chain reserves and can change. Nothing here is a promise of future returns.
      </p>
    </section>
  );
}

const STEPS = [
  {
    title: "Connect a wallet",
    body: "MetaMask or any browser wallet. MezoFlow adds Mezo Testnet for you.",
    cost: "No transaction",
  },
  {
    title: "Get some MUSD",
    body: "Swap testnet BTC from the Mezo faucet for MUSD through Mezo Pools, or claim a little from the MezoFlow faucet.",
    cost: "1 transaction, or none if you swap and deposit together",
  },
  {
    title: "Choose where it goes",
    body: "Pick one strategy, or let the allocator split it with a Conservative, Balanced or Growth plan.",
    cost: "No transaction",
  },
  {
    title: "Deposit and receive shares",
    body: "Vault shares are ERC-4626 tokens in your wallet. They grow in value as the strategy earns.",
    cost: "1 transaction: you sign a permit, then deposit",
  },
  {
    title: "Track it, then withdraw",
    body: "Every deposit, fee and exit is written to the on-chain ledger and linked to its transaction.",
    cost: "1 transaction to withdraw",
  },
];

export function HowSection() {
  return (
    <section id="how" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-24 sm:px-10">
      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-end">
        <h2 className="h-section max-w-[16ch]">From wallet to working in five steps</h2>
        <p className="lede">
          About a minute end to end. Gas on Mezo is paid in BTC and costs a tiny fraction of a cent, so the only thing you
          spend is a few signatures.
        </p>
      </div>
      <ol className="mt-14 grid gap-x-6 gap-y-10 border-t rule md:grid-cols-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="relative pt-6">
            <span aria-hidden className="absolute left-0 top-[-1px] h-[2px] w-10 bg-tide" />
            <span className="text-sm font-semibold tabular text-tide">Step {i + 1}</span>
            <h3 className="mt-2 font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-silt">{s.body}</p>
            <p className="mt-3 text-xs font-medium text-mist">{s.cost}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function RiskSection() {
  return (
    <section id="risks" className="scroll-mt-20 border-y rule bg-trench/60">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-24 sm:px-10 md:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="h-section max-w-[14ch]">Know what can go wrong first</h2>
          <p className="lede mt-5">
            A return figure on its own tells you very little. Every strategy in MezoFlow shows its risks in plain language
            right next to the number.
          </p>
          <Link href="/app/risk" className="btn btn-ghost mt-8">
            Open the risk dashboard
          </Link>
        </div>
        <dl className="grid gap-8">
          <div className="border-l-2 border-tide/60 pl-5">
            <dt className="font-semibold">Savings rates come from a reserve you can inspect</dt>
            <dd className="mt-2 text-silt leading-relaxed">
              Flexible and Term Savings pay their rate from an on-chain reward reserve funded by protocol fees. The app shows
              how many days it will last. When it runs out, growth stops but your deposit is untouched.
            </dd>
          </div>
          <div className="border-l-2 border-ember/70 pl-5">
            <dt className="font-semibold">The Stability Pool swaps MUSD for BTC</dt>
            <dd className="mt-2 text-silt leading-relaxed">
              When troves are liquidated, part of your MUSD is used to repay debt and you receive BTC collateral, usually worth
              about 10% more. If BTC falls before you claim, that gain can turn into a loss.
            </dd>
          </div>
          <div className="border-l-2 border-coral/70 pl-5">
            <dt className="font-semibold">Testnet, and not yet audited</dt>
            <dd className="mt-2 text-silt leading-relaxed">
              These contracts are tested and reviewed internally, but not audited by a third party, and they run on Mezo Testnet with test funds. Treat this as a working
              preview, not a place for real savings.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const CONTRACT_ROWS: [string, string, string][] = [
  ["Flexible Savings vault", ADDR.flex, "ERC-4626 MUSD vault with a reserve-funded rate"],
  ["Term Savings vault", ADDR.term, "7-day lock, higher rate, early-exit penalty to reserve"],
  ["Stability Pool vault", ADDR.sp, "Routes MUSD into Mezo's Stability Pool, shares BTC gains"],
  ["Auto Allocator", ADDR.allocator, "Splits one deposit across vaults in a single transaction"],
  ["Mezo Pools zap", ADDR.zap, "Swaps BTC or MEZO to MUSD and deposits it, in one transaction"],
  ["Strategy registry", ADDR.registry, "Strategy catalogue and protocol announcements"],
  ["Activity ledger", ADDR.ledger, "Every user action, on-chain"],
  ["Fee manager", ADDR.fees, "Disclosed fee schedule and treasury"],
  ["Alert center", ADDR.alerts, "Your notification preferences"],
  ["Test MUSD faucet", ADDR.faucet, "A little MUSD per address per day"],
  ["MUSD token (Mezo)", MEZO.MUSD, "Mezo's Bitcoin-backed stablecoin"],
  ["Stability Pool (Mezo)", MEZO.StabilityPool, "Official MUSD Stability Pool"],
  ["Pools router (Mezo)", MEZO.PoolsRouter, "Mezo Pools swap router"],
];

export function ContractsSection() {
  return (
    <section id="contracts" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 pb-24 sm:px-10">
      <h2 className="h-section">Every contract is public</h2>
      <p className="lede mt-4">Deployed on Mezo Testnet (chain 31611). Open any of them on the explorer and check the numbers yourself.</p>
      <ul className="mt-10 divide-y divide-shoal border-y rule md:hidden" aria-label="Contracts">
        {CONTRACT_ROWS.map(([name, addr, what]) => (
          <li key={addr} className="py-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-semibold">{name}</span>
              <a className="link tabular text-sm" href={addressUrl(addr)} target="_blank" rel="noreferrer">
                {shortAddr(addr, 4)}
              </a>
            </div>
            <p className="mt-1 text-sm text-silt">{what}</p>
          </li>
        ))}
      </ul>
      <div className="mt-10 hidden overflow-x-auto md:block">
        <table className="table min-w-[680px]">
          <tbody>
            {CONTRACT_ROWS.map(([name, addr, what]) => (
              <tr key={addr}>
                <td className="font-semibold">{name}</td>
                <td className="text-sm text-silt">{what}</td>
                <td className="text-right">
                  <a className="link tabular text-sm" href={addressUrl(addr)} target="_blank" rel="noreferrer">
                    {shortAddr(addr, 6)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

