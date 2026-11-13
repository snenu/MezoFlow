"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount } from "@/hooks/useAccount";
import type { Address } from "viem";
import { PageHeader } from "@/components/app/shell";
import { StackBar, type Segment } from "@/components/charts";
import { AmountInput, RiskMeter, Skel, useNow } from "@/components/ui";
import { FaucetButton } from "@/components/app/faucet";
import { useWalletModal } from "@/components/wallet";
import { useMezoFlow, usePlan, usePresets, type StrategyView } from "@/hooks/useMezoFlow";
import { permitStep, useTx, type TxStep } from "@/hooks/useTx";
import { ADDR, allocatorAbi, erc20Abi, KIND, RISK_LABEL } from "@/lib/contracts";
import { aprToApy, fmtAmount, fmtDate, fmtPct, parseAmount, toNum } from "@/lib/format";
import { SERIES, seriesForVault } from "@/lib/viz";

const CUSTOM = 4294967295;
const BPS = 10_000n;

type Choice = { kind: "preset"; id: number } | { kind: "custom" };

export default function AllocatePage() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const { strategies, account } = useMezoFlow();
  const { data: presets, isLoading: presetsLoading } = usePresets();
  const { data: plan } = usePlan();
  const { run, busy } = useTx();
  // The landing page simulator links here with ?plan=<id>&amount=<musd>.
  const params = useSearchParams();
  const [value, setValue] = useState(() => {
    const a = params.get("amount") ?? "";
    return /^\d{1,9}(\.\d{0,6})?$/.test(a) ? a : "";
  });
  const [choice, setChoice] = useState<Choice>(() => {
    const id = Number(params.get("plan"));
    return { kind: "preset", id: Number.isInteger(id) && id >= 0 && id < 16 ? id : 1 };
  });
  const [custom, setCustom] = useState<Record<string, number>>({});

  // Until the user moves a slider, the custom split starts from a sensible default.
  const defaults = useMemo(() => {
    const init: Record<string, number> = {};
    strategies.forEach((s) => (init[s.meta.vault.toLowerCase()] = s.meta.kind === KIND.FLEXIBLE ? 50 : s.meta.kind === KIND.TERM ? 20 : 30));
    return init;
  }, [strategies]);
  const weights = Object.keys(custom).length ? custom : defaults;

  const byVault = useMemo(() => {
    const m: Record<string, StrategyView> = {};
    strategies.forEach((s) => (m[s.meta.vault.toLowerCase()] = s));
    return m;
  }, [strategies]);

  const split = useMemo((): { vaults: Address[]; weights: number[] } => {
    if (choice.kind === "preset") {
      const p = presets?.[choice.id];
      if (!p) return { vaults: [], weights: [] };
      return { vaults: [...p.vaults] as Address[], weights: p.weightsBps.map(Number) };
    }
    const vaults = strategies.map((s) => s.meta.vault as Address);
    return { vaults, weights: vaults.map((v) => Math.round((weights[v.toLowerCase()] ?? 0) * 100)) };
  }, [choice, presets, strategies, weights]);

  const weightSum = split.weights.reduce((a, b) => a + b, 0);
  const amount = parseAmount(value);
  const wallet = account?.musdBalance ?? 0n;

  const rows = split.vaults.map((v, i) => {
    const part = amount ? (amount * BigInt(split.weights[i])) / BPS : 0n;
    return { vault: v, s: byVault[v.toLowerCase()], weight: split.weights[i], part };
  });
  const allocated = rows.reduce((a, r) => a + r.part, 0n);
  const kept = amount ? amount - allocated : 0n;
  const tooSmall = rows.filter((r) => r.part > 0n && r.s && r.part < r.s.stats.minDeposit);
  const yearly = rows.reduce((a, r) => a + (r.s && r.s.stats.rateBps > 0 ? toNum(r.part) * (r.s.stats.rateBps / 10_000) : 0), 0);
  const blendedRisk =
    allocated > 0n ? rows.reduce((a, r) => a + toNum(r.part) * (r.s?.meta.riskScore ?? 0), 0) / toNum(allocated) : 0;
  const btcShare = rows.filter((r) => r.s?.meta.kind === KIND.STABILITY_POOL).reduce((a, r) => a + r.weight, 0) / 100;

  const err =
    value === ""
      ? null
      : amount === null || amount === 0n
        ? "Enter an amount"
        : amount > wallet
          ? "That's more MUSD than your wallet holds"
          : weightSum > 10_000
            ? "Your split adds up to more than 100%"
            : allocated === 0n
              ? "Nothing would be allocated with this split"
              : tooSmall.length
                ? `Each strategy needs at least 1 MUSD. Raise the amount or change the split.`
                : null;
  const ok = !!amount && !err;

  const segments: Segment[] = [
    ...rows.map((r) => ({
      key: r.vault,
      label: r.s?.meta.name ?? "Strategy",
      value: toNum(r.part),
      color: seriesForVault(r.vault),
    })),
    { key: "wallet", label: "Stays in your wallet", value: toNum(kept), color: SERIES.wallet },
  ];

  async function allocate() {
    if (!ok || !amount || !address) return;
    const title = `Allocating ${fmtAmount(allocated)} MUSD`;
    const done = `Allocated ${fmtAmount(allocated)} MUSD across ${rows.filter((r) => r.part > 0n).length} strategies`;
    const plain =
      choice.kind === "preset"
        ? { address: ADDR.allocator, abi: allocatorAbi, functionName: "allocatePreset", args: [amount, BigInt(choice.id)] }
        : { address: ADDR.allocator, abi: allocatorAbi, functionName: "allocate", args: [amount, split.vaults, split.weights] };
    const step: TxStep =
      (account?.allocatorAllowance ?? 0n) >= amount
        ? { title, done, request: plain }
        : permitStep({
            title,
            done,
            token: ADDR.musd,
            tokenLabel: `${fmtAmount(amount)} MUSD`,
            spender: ADDR.allocator,
            value: amount,
            withPermit: (sig) =>
              choice.kind === "preset"
                ? { address: ADDR.allocator, abi: allocatorAbi, functionName: "allocatePresetWithPermit", args: [amount, BigInt(choice.id), sig] }
                : { address: ADDR.allocator, abi: allocatorAbi, functionName: "allocateWithPermit", args: [amount, split.vaults, split.weights, sig] },
            plain,
          });
    const res = await run([step]);
    if (res) setValue("");
  }

  const planName =
    plan && plan[0] > 0n ? (Number(plan[1]) === CUSTOM ? "Custom split" : presets?.[Number(plan[1])]?.name ?? "Preset") : null;

  return (
    <>
      <PageHeader
        title="Auto allocator"
        description="Split one deposit across MezoFlow strategies in a single transaction. Review the plan, the expected earnings and the risks before you sign."
      />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_440px]">
        <div className="grid min-w-0 gap-6">
          <section className="panel p-6" aria-labelledby="amt-title">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="amt-title" className="text-lg font-semibold tracking-tight">
                How much MUSD?
              </h2>
              {isConnected && <span className="text-sm text-silt tabular">Wallet: {fmtAmount(wallet)} MUSD</span>}
            </div>
            <div className="mt-4">
              <AmountInput id="alloc-amount" value={value} onChange={setValue} max={isConnected ? wallet : undefined} invalid={!!err} disabled={!!busy} />
              {err && (
                <p role="alert" className="mt-2 text-sm">
                  {err}
                </p>
              )}
              {isConnected && wallet === 0n && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-silt">
                  Your wallet has no MUSD yet.
                  <Link href="/app/swap" className="btn btn-primary h-9 px-3 text-sm">
                    Swap BTC for MUSD
                  </Link>
                  <FaucetButton className="btn btn-ghost h-9 px-3 text-sm" />
                </div>
              )}
            </div>
          </section>

          <section className="panel p-6" aria-labelledby="plan-title">
            <h2 id="plan-title" className="text-lg font-semibold tracking-tight">
              Choose a plan
            </h2>
            <p className="mt-1 text-sm text-silt">Plans are stored on-chain in the allocator contract.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Allocation plan">
              {presetsLoading &&
                [0, 1, 2].map((i) => (
                  <div key={i} className="panel-quiet p-4">
                    <Skel w="50%" />
                  </div>
                ))}
              {presets?.map((p, i) => {
                const selected = choice.kind === "preset" && choice.id === i;
                return (
                  <button
                    key={p.name}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setChoice({ kind: "preset", id: i })}
                    disabled={!p.active}
                    className={`rounded-lg border p-4 text-left transition-colors ${
                      selected ? "border-tide bg-tide/[0.06]" : "border-shoal hover:border-reef"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{p.name}</span>
                      <RiskMeter score={p.riskLevel} size="sm" showLabel={false} />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-silt">{p.description}</p>
                    <div className="mt-3 flex h-1.5 gap-[2px]" aria-hidden>
                      {p.vaults.map((v, j) => (
                        <span
                          key={v}
                          className="h-full rounded-[2px]"
                          style={{ width: `${Number(p.weightsBps[j]) / 100}%`, background: seriesForVault(v) }}
                        />
                      ))}
                      <span
                        className="h-full rounded-[2px] opacity-60"
                        style={{
                          width: `${100 - p.weightsBps.reduce((a, b) => a + Number(b), 0) / 100}%`,
                          background: SERIES.wallet,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
              <button
                role="radio"
                aria-checked={choice.kind === "custom"}
                onClick={() => setChoice({ kind: "custom" })}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  choice.kind === "custom" ? "border-tide bg-tide/[0.06]" : "border-shoal hover:border-reef"
                }`}
              >
                <span className="font-semibold">Custom split</span>
                <p className="mt-2 text-sm leading-relaxed text-silt">Set your own percentage for each strategy. Whatever is left stays in your wallet.</p>
              </button>
            </div>

            {choice.kind === "custom" && (
              <div className="mt-6 grid gap-5 border-t rule pt-6">
                {strategies.map((s) => {
                  const k = s.meta.vault.toLowerCase();
                  const v = weights[k] ?? 0;
                  const others = Object.entries(weights).reduce((a, [kk, vv]) => (kk === k ? a : a + vv), 0);
                  return (
                    <div key={k}>
                      <div className="flex items-baseline justify-between text-sm">
                        <label htmlFor={`w-${k}`} className="flex items-center gap-2 font-medium">
                          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seriesForVault(s.meta.vault) }} aria-hidden />
                          {s.meta.name}
                        </label>
                        <span className="tabular font-semibold">{v}%</span>
                      </div>
                      <input
                        id={`w-${k}`}
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={v}
                        className="range mt-2"
                        style={{ ["--pct" as string]: `${v}%`, ["--fill" as string]: seriesForVault(s.meta.vault) }}
                        onChange={(e) => {
                          const next = Math.min(Number(e.target.value), 100 - others);
                          setCustom({ ...weights, [k]: next });
                        }}
                      />
                    </div>
                  );
                })}
                <p className="text-sm text-silt tabular">
                  {weightSum / 100}% allocated, {100 - weightSum / 100}% stays in your wallet.
                </p>
              </div>
            )}
          </section>

          {isConnected && <Reallocate split={split} choice={choice} presetsReady={!!presets} />}
        </div>

        <aside className="xl:sticky xl:top-24">
          <section className="panel relative overflow-hidden p-6" aria-labelledby="review-title">
            <h2 id="review-title" className="text-lg font-semibold tracking-tight">
              Proposed allocation
            </h2>
            <p className="mt-1 text-sm text-silt">
              {amount ? `For ${fmtAmount(amount)} MUSD.` : "Enter an amount to see the split."} Nothing moves until you sign.
            </p>
            <div className="mt-5">
              <StackBar segments={segments} format={(v) => `${fmtAmount(v)} MUSD`} />
            </div>

            <ul className="mt-6 divide-y divide-shoal/70 border-t rule">
              {rows.map((r) =>
                r.s ? (
                  <li key={r.vault} className="py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{r.s.meta.name}</span>
                      <span className="tabular font-semibold">{fmtAmount(r.part)} MUSD</span>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-3 text-silt">
                      <span>{r.s.meta.kind === KIND.STABILITY_POOL ? "BTC from liquidations" : `${fmtPct(r.s.stats.rateBps)} APR, ≈ ${aprToApy(r.s.stats.rateBps).toFixed(2)}% APY`}</span>
                      <span className="tabular">{r.weight / 100}%</span>
                    </div>
                    <p className="mt-1 text-xs text-silt">{r.s.meta.liquidityTerms}</p>
                  </li>
                ) : null,
              )}
            </ul>

            <dl className="mt-2 grid gap-2 rounded-lg bg-trench/60 p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-silt">Expected from savings rates</dt>
                <dd className="tabular font-medium">≈ {fmtAmount(yearly)} MUSD a year</dd>
              </div>
              {btcShare > 0 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-silt">Earning BTC instead</dt>
                  <dd className="tabular font-medium text-ember">{btcShare}% of the deposit</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-silt">Blended risk</dt>
                <dd>{blendedRisk > 0 ? <RiskMeter score={blendedRisk} size="sm" /> : "—"}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-silt">
              Earnings use today&apos;s on-chain rates, which can change, and only last while each reward reserve has MUSD.
              Stability Pool returns depend on liquidations and the BTC price. None of this is guaranteed.
            </p>

            {!isConnected ? (
              <button className="btn btn-primary btn-lg mt-5 w-full" onClick={open}>
                Connect wallet
              </button>
            ) : (
              <button className="btn btn-primary btn-lg mt-5 w-full" disabled={!ok || !!busy} onClick={allocate}>
                {busy ? <span className="spinner" /> : null}
                {busy ?? "Allocate"}
              </button>
            )}
            {isConnected && (account?.allocatorAllowance ?? 0n) < (amount ?? 0n) && !busy && (
              <p className="mt-2 text-center text-xs text-silt">One transaction. You sign a permit for this exact amount first; it costs no gas.</p>
            )}
            {planName && plan && (
              <p className="mt-4 text-sm text-silt">
                Your last plan: <span className="text-mist">{planName}</span> with {fmtAmount(plan[2])} MUSD on {fmtDate(plan[0])}.
              </p>
            )}
            <p className="mt-2 text-xs text-silt">
              Prefer one strategy? <Link className="link" href="/app/strategies">Deposit directly</Link>.
            </p>
          </section>
          <p className="mt-3 px-1 text-xs text-silt">
            Risk levels: {Object.entries(RISK_LABEL).map(([k, v]) => `${k} ${v.toLowerCase()}`).join(", ")}.
          </p>
        </aside>
      </div>
    </>
  );
}

function Reallocate({
  split,
  choice,
  presetsReady,
}: {
  split: { vaults: Address[]; weights: number[] };
  choice: Choice;
  presetsReady: boolean;
}) {
  const { address } = useAccount();
  const { strategies } = useMezoFlow();
  const { run, busy } = useTx();
  const now = useNow(30_000);
  const held = strategies.filter((s) => s.user.shares > 0n);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const from = held.filter((s) => picked[s.meta.vault.toLowerCase()]);
  const total = from.reduce((a, s) => a + toNum(s.user.assets), 0);
  const lockedTerm = from.find((s) => s.meta.kind === KIND.TERM && Number(s.user.unlockAt) * 1000 > now);
  const weightSum = split.weights.reduce((a, b) => a + b, 0);

  if (held.length === 0) return null;

  async function go() {
    if (!address || from.length === 0) return;
    const vaults = from.map((s) => s.meta.vault);
    const shares = from.map((s) => s.user.shares);
    const presetId = choice.kind === "preset" ? choice.id : CUSTOM;
    const title = `Moving ${fmtAmount(total)} MUSD to the new split`;
    const done = `Moved ${fmtAmount(total)} MUSD to the new split`;
    const plain = {
      address: ADDR.allocator,
      abi: allocatorAbi,
      functionName: "reallocate",
      args: [vaults, shares, split.vaults, split.weights, presetId],
    };
    const needs = from.filter((s) => s.shareAllowanceToAllocator < s.user.shares);
    const step: TxStep = needs.length
      ? {
          title,
          done,
          // One signature per position, then a single transaction.
          permits: from.map((s) => ({ token: s.meta.vault, spender: ADDR.allocator, value: s.user.shares, label: `your ${s.meta.name} shares` })),
          withPermits: (sigs) => ({
            address: ADDR.allocator,
            abi: allocatorAbi,
            functionName: "reallocateWithPermit",
            args: [vaults, shares, sigs, split.vaults, split.weights, presetId],
          }),
          fallback: [
            ...needs.map((s) => ({
              title: `Approving ${s.meta.name} shares`,
              done: `Approved ${s.meta.name} shares for the allocator`,
              request: { address: s.meta.vault, abi: erc20Abi, functionName: "approve", args: [ADDR.allocator, s.user.shares] },
            })),
            { title, done, request: plain },
          ],
        }
      : { title, done, request: plain };
    const res = await run([step]);
    if (res) setPicked({});
  }

  return (
    <section className="panel p-6" aria-labelledby="realloc-title">
      <h2 id="realloc-title" className="text-lg font-semibold tracking-tight">
        Move an existing position
      </h2>
      <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-silt">
        Rebalance what you already hold into the plan selected above. The allocator withdraws the positions you tick and
        re-deposits them in one transaction. Anything the plan leaves unallocated comes back to your wallet.
      </p>
      <ul className="mt-4 grid gap-2">
        {held.map((s) => {
          const k = s.meta.vault.toLowerCase();
          return (
            <li key={k}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-shoal px-4 py-3 hover:border-reef">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-tide)]"
                  checked={!!picked[k]}
                  onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))}
                />
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: seriesForVault(s.meta.vault) }} aria-hidden />
                <span className="flex-1 font-medium">{s.meta.name}</span>
                <span className="tabular text-mist">{fmtAmount(s.user.assets)} MUSD</span>
              </label>
            </li>
          );
        })}
      </ul>
      {lockedTerm && (
        <p className="mt-3 text-sm text-sun">
          Your Term Savings position is still locked, so moving it costs the {fmtPct(Number(lockedTerm.user.exitFeeBps))} early-exit penalty.
        </p>
      )}
      <button
        className="btn btn-ghost mt-4"
        disabled={from.length === 0 || !!busy || weightSum === 0 || !presetsReady}
        onClick={go}
      >
        {busy ? <span className="spinner" /> : null}
        {busy ?? (from.length ? `Move ${fmtAmount(total)} MUSD to this plan` : "Tick a position to move")}
      </button>
    </section>
  );
}
