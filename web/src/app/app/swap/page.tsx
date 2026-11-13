"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { useAccount } from "@/hooks/useAccount";
import { erc20Abi, type Address } from "viem";
import { PageHeader } from "@/components/app/shell";
import { FaucetButton } from "@/components/app/faucet";
import { AmountInput, Skel } from "@/components/ui";
import { useWalletModal } from "@/components/wallet";
import { useMezoFlow, usePresets, useSpHealth } from "@/hooks/useMezoFlow";
import { permitStep, useTx, type TxRequest } from "@/hooks/useTx";
import { ADDR, zapAbi } from "@/lib/contracts";
import { fmtAmount, fmtBtc, fmtUsd, parseAmount, toNum } from "@/lib/format";
import type { PermitSig } from "@/lib/permit";

type Token = "BTC" | "MEZO";
type Dest = { kind: "wallet" } | { kind: "vault"; vault: Address; name: string } | { kind: "preset"; id: number; name: string };

const SLIPPAGE_BPS = 100n; // 1%
const BTC_GAS_RESERVE = 2n * 10n ** 13n; // 0.00002 BTC stays for gas
const MEZO_FAUCET = "https://faucet.test.mezo.org";

function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function SwapPage() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const { strategies, account, protocol } = useMezoFlow();
  const { data: presets } = usePresets();
  const { health } = useSpHealth();
  const { run, busy } = useTx();

  const [token, setToken] = useState<Token>("BTC");
  const [value, setValue] = useState("");
  const [dest, setDest] = useState<Dest>({ kind: "wallet" });

  const tokenAddr = token === "BTC" ? ADDR.btc : ADDR.mezo;
  const routes = useMemo(
    () => [{ from: tokenAddr, to: ADDR.musd, stable: false, factory: ADDR.poolFactory }] as const,
    [tokenAddr],
  );

  const { data: balances, refetch: refetchBalances } = useReadContracts({
    contracts: [
      { address: ADDR.btc, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ADDR.zap] },
      { address: ADDR.mezo, abi: erc20Abi, functionName: "balanceOf", args: [address ?? ADDR.zap] },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const btcBal = (balances?.[0]?.result as bigint | undefined) ?? 0n;
  const mezoBal = (balances?.[1]?.result as bigint | undefined) ?? 0n;
  const bal = token === "BTC" ? btcBal : mezoBal;
  const spendable = token === "BTC" ? (bal > BTC_GAS_RESERVE ? bal - BTC_GAS_RESERVE : 0n) : bal;

  const amount = parseAmount(value);
  const debounced = useDebounced(amount ?? 0n);
  const quote = useReadContract({
    address: ADDR.zap,
    abi: zapAbi,
    functionName: "quote",
    args: [routes, debounced],
    query: { enabled: debounced > 0n, refetchInterval: 12_000 },
  });
  // A fixed-size reference quote for the price line.
  const unit = token === "BTC" ? 10n ** 15n : 10n ** 19n; // 0.001 BTC or 10 MEZO
  const ref = useReadContract({
    address: ADDR.zap,
    abi: zapAbi,
    functionName: "quote",
    args: [routes, unit],
    query: { refetchInterval: 30_000 },
  });

  const out = (quote.data as bigint | undefined) ?? 0n;
  const minOut = (out * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const poolPrice = ref.data ? toNum(ref.data as bigint) / toNum(unit) : null; // MUSD per token
  const oracle = token === "BTC" && health?.btcPrice ? toNum(health.btcPrice) : null;
  const vsOracle = poolPrice && oracle ? ((poolPrice - oracle) / oracle) * 100 : null;

  const err =
    value === ""
      ? null
      : amount === null || amount === 0n
        ? "Enter an amount"
        : amount > spendable
          ? token === "BTC"
            ? `You can swap up to ${fmtBtc(spendable)} BTC. A little stays behind to pay for gas.`
            : `Your wallet holds ${fmtAmount(bal)} MEZO`
          : quote.isError
            ? "Mezo Pools couldn't quote this amount. Try a smaller one."
            : null;

  const destVault = dest.kind === "vault" ? strategies.find((s) => s.meta.vault === dest.vault) : undefined;
  const belowMin = destVault && out > 0n && out < destVault.stats.minDeposit;
  const ready = !!amount && amount > 0n && !err && out > 0n && !quote.isFetching && !belowMin;
  const allowance = token === "BTC" ? (account?.btcAllowanceToZap ?? 0n) : (account?.mezoAllowanceToZap ?? 0n);

  async function submit() {
    if (!ready || !amount || !address) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const what = `${token === "BTC" ? fmtBtc(amount) : fmtAmount(amount)} ${token}`;
    let fn: string;
    let plainArgs: readonly unknown[];
    let title: string;
    let done: string;
    if (dest.kind === "wallet") {
      fn = "swap";
      plainArgs = [routes, amount, minOut, deadline];
      title = `Swapping ${what} for MUSD`;
      done = `Swapped ${what} for about ${fmtAmount(out)} MUSD`;
    } else if (dest.kind === "vault") {
      fn = "swapAndDeposit";
      plainArgs = [routes, amount, minOut, dest.vault, deadline];
      title = `Swapping ${what} into ${dest.name}`;
      done = `Deposited about ${fmtAmount(out)} MUSD into ${dest.name}`;
    } else {
      fn = "swapAndAllocate";
      plainArgs = [routes, amount, minOut, BigInt(dest.id), deadline];
      title = `Swapping ${what} into the ${dest.name} plan`;
      done = `Allocated about ${fmtAmount(out)} MUSD with the ${dest.name} plan`;
    }
    const plain: TxRequest = { address: ADDR.zap, abi: zapAbi, functionName: fn, args: plainArgs };
    const step =
      allowance >= amount
        ? { title, done, request: plain }
        : permitStep({
            title,
            done,
            token: tokenAddr,
            tokenLabel: what,
            spender: ADDR.zap,
            value: amount,
            withPermit: (sig: PermitSig) => ({ address: ADDR.zap, abi: zapAbi, functionName: `${fn}WithPermit`, args: [...plainArgs, sig] }),
            plain,
          });
    const res = await run([step]);
    if (res) {
      setValue("");
      refetchBalances();
    }
  }

  const destinations: Dest[] = [
    { kind: "wallet" },
    ...strategies.filter((s) => s.meta.active).map((s) => ({ kind: "vault" as const, vault: s.meta.vault, name: s.meta.name })),
    ...(presets ?? []).map((p, i) => ({ kind: "preset" as const, id: i, name: p.name })).filter((p) => presets?.[p.id]?.active),
  ];
  const destKey = (d: Dest) => (d.kind === "wallet" ? "wallet" : d.kind === "vault" ? d.vault : `preset-${d.id}`);
  const destLabel = (d: Dest) => (d.kind === "wallet" ? "My wallet" : d.kind === "vault" ? d.name : `${d.name} plan`);
  const cta =
    dest.kind === "wallet" ? `Swap ${token} for MUSD` : dest.kind === "vault" ? `Swap and deposit` : `Swap and allocate`;

  return (
    <div>
      <PageHeader
        title="Get MUSD"
        description="Swap testnet BTC or MEZO for MUSD through Mezo Pools. Send it to your wallet, or straight into a strategy, in one transaction."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel p-5 sm:p-6" aria-label="Swap">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="seg" role="tablist" aria-label="Pay with">
              {(["BTC", "MEZO"] as Token[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={token === t}
                  onClick={() => {
                    setToken(t);
                    setValue("");
                  }}
                >
                  Pay with {t}
                </button>
              ))}
            </div>
            {isConnected && (
              <p className="text-sm text-silt tabular">
                Wallet: {token === "BTC" ? `${fmtBtc(btcBal)} BTC` : `${fmtAmount(mezoBal)} MEZO`}
              </p>
            )}
          </div>

          <div className="mt-5">
            <label htmlFor="swap-amount" className="mb-2 block text-sm text-silt">
              You pay
            </label>
            <AmountInput
              id="swap-amount"
              value={value}
              onChange={setValue}
              unit={token}
              max={isConnected ? spendable : undefined}
              invalid={!!err}
              disabled={!!busy}
            />
            {err && (
              <p className="mt-2 text-sm" role="alert">
                {err}
              </p>
            )}
            {token === "BTC" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {["0.0005", "0.001", "0.002"].map((v) => (
                  <button key={v} type="button" className="chip chip-btn tabular" onClick={() => setValue(v)}>
                    {v} BTC
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6">
            <p className="mb-2 text-sm text-silt">Send the MUSD to</p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Destination">
              {destinations.map((d) => {
                const on = destKey(d) === destKey(dest);
                return (
                  <button
                    key={destKey(d)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDest(d)}
                    className={`flex items-center justify-between gap-3 rounded-md border px-3.5 py-3 text-left text-[0.95rem] font-medium ${
                      on ? "border-blue bg-blue text-white" : "border-shoal hover:border-black"
                    }`}
                  >
                    <span>{destLabel(d)}</span>
                    <span className={`text-xs ${on ? "text-white" : "text-silt"}`}>
                      {d.kind === "wallet" ? "MUSD" : d.kind === "vault" ? "Strategy" : "Preset"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <dl className="mt-6 grid gap-2 rounded-lg bg-trench p-4 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-silt">You get</dt>
              <dd className="text-right text-lg font-semibold tabular semi-wide">
                {amount && amount > 0n && !err ? quote.isFetching && !out ? <Skel w="6rem" /> : `≈ ${fmtAmount(out)} MUSD` : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-silt">Minimum after 1% slippage</dt>
              <dd className="text-right font-medium tabular">{out > 0n ? `${fmtAmount(minOut)} MUSD` : "—"}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-silt">Route</dt>
              <dd className="text-right font-medium">{token} to MUSD, Mezo Pools volatile pool</dd>
            </div>
            {belowMin && (
              <p className="mt-1" role="alert">
                {destVault?.meta.name} takes at least {fmtAmount(destVault?.stats.minDeposit)} MUSD. Swap a little more.
              </p>
            )}
          </dl>

          <div className="mt-6">
            {!isConnected ? (
              <button className="btn btn-primary btn-lg w-full" onClick={open}>
                Connect wallet
              </button>
            ) : (
              <button className="btn btn-primary btn-lg w-full" disabled={!ready || !!busy} onClick={submit}>
                {busy ? <span className="spinner" /> : null}
                {busy ?? cta}
              </button>
            )}
            <p className="mt-2 text-center text-xs text-silt">
              {allowance >= (amount ?? 1n)
                ? "One transaction."
                : `One transaction. You sign a ${token} permit for this exact amount first; it costs no gas.`}
            </p>
          </div>
        </section>

        <aside className="grid content-start gap-6">
          <section className="slab rounded-lg p-5" aria-label="Pool price">
            <p className="text-sm slab-muted">Mezo Pools price</p>
            <p className="mt-1 text-3xl font-bold tabular wide tracking-tight">
              {poolPrice ? (token === "BTC" ? fmtUsd(poolPrice).replace("$", "") : poolPrice.toFixed(4)) : <Skel w="8rem" h="1.8rem" />}
            </p>
            <p className="text-sm slab-muted">MUSD per {token}</p>
            {oracle && (
              <div className="mt-4 border-t slab-rule pt-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="slab-muted">Mezo oracle BTC price</span>
                  <span className="tabular font-semibold">{fmtUsd(oracle)}</span>
                </div>
                {vsOracle !== null && (
                  <p className="mt-2 slab-muted">
                    The pool is {Math.abs(vsOracle).toFixed(1)}% {vsOracle >= 0 ? "above" : "below"} the oracle. Testnet pools
                    are thin, so prices drift.
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="panel p-5" aria-label="Faucet to funded">
            <h2 className="font-semibold">From the Mezo faucet to a funded position</h2>
            <ol className="mt-3 grid gap-3 text-sm leading-relaxed text-mist">
              <li>
                <span className="font-semibold text-black">1. Get testnet BTC.</span> Paste your address at{" "}
                <a className="link" href={MEZO_FAUCET} target="_blank" rel="noreferrer">
                  faucet.test.mezo.org
                </a>
                .
              </li>
              <li>
                <span className="font-semibold text-black">2. Pick where the MUSD goes.</span> Your wallet, a strategy or a
                preset plan.
              </li>
              <li>
                <span className="font-semibold text-black">3. Sign and send.</span> The swap and the deposit happen in the same
                transaction.
              </li>
            </ol>
            {address && (
              <button
                type="button"
                className="btn btn-ghost mt-4 w-full"
                onClick={() => navigator.clipboard?.writeText(address)}
              >
                Copy my address
              </button>
            )}
          </section>

          <section className="panel p-5" aria-label="Test MUSD">
            <h2 className="font-semibold">Just want to look around?</h2>
            <p className="mt-1 text-sm text-silt">
              The MezoFlow test faucet hands out {protocol ? fmtAmount(protocol.faucetAmount, { max: 0 }) : "a few"} MUSD a day
              per address, no swap needed.
            </p>
            <FaucetButton className="btn btn-ghost mt-3 w-full" />
            <Link href="/app/strategies" className="link mt-3 inline-block text-sm">
              Compare strategies
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
