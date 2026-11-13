"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { AmountInput, useNow } from "@/components/ui";
import { FlowBurst } from "@/components/flow-burst";
import { useWalletModal } from "@/components/wallet";
import { FaucetButton } from "@/components/app/faucet";
import { useTx, type TxStep } from "@/hooks/useTx";
import { useSpHealth, type StrategyView } from "@/hooks/useMezoFlow";
import { erc20Abi, KIND, spVaultAbi, termVaultAbi, vaultAbi, ADDR } from "@/lib/contracts";
import { fmtAmount, fmtBtc, fmtDate, fmtDuration, fmtPct, fmtUsd, parseAmount, toInputValue, toNum, WAD } from "@/lib/format";

type Tab = "deposit" | "withdraw" | "claim";

export function ActionPanel({ s }: { s: StrategyView }) {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const isSp = s.meta.kind === KIND.STABILITY_POOL;
  const isTerm = s.meta.kind === KIND.TERM;
  const [tab, setTab] = useState<Tab>("deposit");
  const [burst, setBurst] = useState(0);
  const [burstColor, setBurstColor] = useState("#0EA5E9");
  useLayoutEffect(() => () => setTab("deposit"), []);

  const tabs: [Tab, string][] = [
    ["deposit", "Deposit"],
    ["withdraw", "Withdraw"],
    ...(isSp ? ([["claim", "Claim BTC"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="panel relative overflow-hidden p-5">
      <FlowBurst trigger={burst} color={burstColor} />
      <div className="seg w-full" role="tablist" aria-label="Action">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className="flex-1" onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {!isConnected || !address ? (
          <div className="grid gap-3">
            <p className="text-sm text-silt">Connect a wallet on Mezo Testnet to deposit into {s.meta.name}.</p>
            <button className="btn btn-primary btn-lg w-full" onClick={open}>
              Connect wallet
            </button>
          </div>
        ) : tab === "deposit" ? (
          <DepositForm
            s={s}
            address={address}
            isTerm={isTerm}
            isSp={isSp}
            onDone={() => {
              setBurstColor("#0EA5E9");
              setBurst((b) => b + 1);
            }}
          />
        ) : tab === "withdraw" ? (
          <WithdrawForm s={s} address={address} isTerm={isTerm} isSp={isSp} />
        ) : (
          <ClaimForm
            s={s}
            onDone={() => {
              setBurstColor("#1E40AF");
              setBurst((b) => b + 1);
            }}
          />
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-silt">{label}</dt>
      <dd className="text-right font-medium tabular">{children}</dd>
    </div>
  );
}

function DepositForm({
  s,
  address,
  isTerm,
  isSp,
  onDone,
}: {
  s: StrategyView;
  address: Address;
  isTerm: boolean;
  isSp: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const { run, busy } = useTx();
  const now = useNow(30_000);
  const { data: wallet } = useReadContract({
    address: ADDR.musd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    query: { refetchInterval: 15_000 },
  });
  const { data: term } = useReadContracts({
    contracts: [
      { address: ADDR.term, abi: termVaultAbi, functionName: "lockDuration" },
      { address: ADDR.term, abi: termVaultAbi, functionName: "earlyExitPenaltyBps" },
    ],
    query: { enabled: isTerm },
  });

  const amount = parseAmount(value);
  const bal = wallet ?? 0n;
  const min = s.stats.minDeposit;
  const err =
    value === ""
      ? null
      : amount === null || amount === 0n
        ? "Enter an amount"
        : amount > bal
          ? "That's more MUSD than your wallet holds"
          : amount < min
            ? `The minimum deposit is ${fmtAmount(min)} MUSD`
            : s.stats.paused
              ? "Deposits are paused for this strategy"
              : null;
  const ok = amount !== null && amount > 0n && !err;
  const shares = ok && s.stats.sharePrice > 0n ? (amount! * WAD) / s.stats.sharePrice : 0n;
  const needsApproval = ok && s.musdAllowance < amount!;

  const projectedUnlock = useMemo(() => {
    if (!isTerm || !term || !ok || now === 0) return null;
    const lock = Number(term[0]?.result ?? 0n);
    const nowS = now / 1000;
    const balShares = toNum(s.user.shares);
    const newShares = toNum(shares);
    const remaining = Math.max(Number(s.user.unlockAt) - nowS, 0);
    const weighted = (balShares * remaining + newShares * lock) / (balShares + newShares || 1);
    return nowS + weighted;
  }, [isTerm, term, ok, now, s.user.shares, s.user.unlockAt, shares]);

  const yearly = ok && s.stats.rateBps > 0 ? toNum(amount!) * (Number(s.stats.rateBps) / 10_000) : 0;

  async function submit() {
    if (!ok || !amount) return;
    const steps: TxStep[] = [];
    if (needsApproval) {
      steps.push({
        title: `Approving ${fmtAmount(amount)} MUSD`,
        done: `Approved ${fmtAmount(amount)} MUSD for ${s.meta.name}`,
        request: { address: ADDR.musd, abi: erc20Abi, functionName: "approve", args: [s.meta.vault, amount] },
      });
    }
    steps.push({
      title: `Depositing ${fmtAmount(amount)} MUSD`,
      done: `Deposited ${fmtAmount(amount)} MUSD into ${s.meta.name}`,
      request: { address: s.meta.vault, abi: vaultAbi, functionName: "deposit", args: [amount, address] },
    });
    const res = await run(steps);
    if (res) {
      setValue("");
      onDone();
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <label htmlFor="dep-amount" className="text-silt">
            Amount to deposit
          </label>
          <span className="text-silt tabular">Wallet: {fmtAmount(bal)} MUSD</span>
        </div>
        <AmountInput id="dep-amount" value={value} onChange={setValue} max={bal} invalid={!!err} disabled={!!busy} />
        {err && (
          <p className="mt-2 text-sm text-coral" role="alert">
            {err}
          </p>
        )}
      </div>

      <dl className="grid gap-2 rounded-xl bg-trench/60 p-4">
        <Row label="You receive">{ok ? `${fmtAmount(shares)} ${isSp ? "mfSP" : isTerm ? "mfTERM" : "mfSAVE"}` : "—"}</Row>
        {s.stats.rateBps > 0 && (
          <Row label="Earns at today's rate">{ok ? `≈ ${fmtAmount(yearly)} MUSD a year` : `${fmtPct(s.stats.rateBps)} APR`}</Row>
        )}
        {isSp && <Row label="Earns">BTC from liquidations, variable</Row>}
        {isTerm && <Row label="Unlocks">{projectedUnlock ? fmtDate(projectedUnlock) : "7 days after deposit"}</Row>}
        <Row label="Exit fee">{s.stats.exitFeeBps > 0 ? fmtPct(s.stats.exitFeeBps) : "None"}</Row>
        {isSp && <Row label="Goes into">90% to Mezo Stability Pool, 10% idle buffer</Row>}
      </dl>

      {isTerm && ok && term?.[1]?.result !== undefined && (
        <p className="text-sm leading-relaxed text-silt">
          Leaving before the unlock date costs {fmtPct(Number(term[1].result))} of what you withdraw. That penalty goes to the
          reward reserve.
        </p>
      )}

      <button className="btn btn-primary btn-lg w-full" disabled={!ok || !!busy} onClick={submit}>
        {busy ? <span className="spinner" /> : null}
        {busy ?? (needsApproval ? "Approve and deposit" : "Deposit")}
      </button>
      {needsApproval && !busy && (
        <p className="-mt-2 text-center text-xs text-silt">Two transactions: approve this exact amount, then deposit.</p>
      )}
      {bal === 0n && (
        <div className="border-t rule pt-4">
          <p className="mb-3 text-sm text-silt">No MUSD in this wallet yet.</p>
          <FaucetButton className="btn btn-ghost w-full" />
        </div>
      )}
    </div>
  );
}

function WithdrawForm({ s, address, isTerm, isSp }: { s: StrategyView; address: Address; isTerm: boolean; isSp: boolean }) {
  const [value, setValue] = useState("");
  const [useMax, setUseMax] = useState(false);
  const { run, busy } = useTx();
  const now = useNow(30_000);
  const { health } = useSpHealth();

  const { data: maxRedeem } = useReadContract({
    address: s.meta.vault,
    abi: vaultAbi,
    functionName: "maxRedeem",
    args: [address],
    query: { refetchInterval: 15_000 },
  });
  const maxW = s.user.maxWithdraw;
  const amount = parseAmount(value);

  const { data: preview } = useReadContract({
    address: s.meta.vault,
    abi: vaultAbi,
    functionName: useMax ? "previewRedeemFor" : "previewWithdrawFor",
    args: [address, useMax ? (maxRedeem ?? 0n) : (amount ?? 0n)],
    query: { enabled: useMax ? !!maxRedeem : !!amount },
  });
  const fee = preview ? preview[1] : 0n;
  const receive = useMax ? (preview ? preview[0] : maxW) : (amount ?? 0n);

  const err =
    value === ""
      ? null
      : amount === null || amount === 0n
        ? "Enter an amount"
        : !useMax && amount > maxW
          ? `You can withdraw up to ${fmtAmount(maxW)} MUSD right now`
          : null;
  const ok = !err && amount !== null && amount > 0n;
  const locked = isTerm && Number(s.user.unlockAt) * 1000 > now;
  const limitedByPool = isSp && health && !health.withdrawalsOpen;
  const notAll = maxW < s.user.assets && s.user.shares > 0n && toNum(s.user.assets) - toNum(maxW) > 0.01;

  async function submit() {
    if (!ok) return;
    const req = useMax
      ? { address: s.meta.vault, abi: vaultAbi, functionName: "redeem", args: [maxRedeem ?? 0n, address, address] }
      : { address: s.meta.vault, abi: vaultAbi, functionName: "withdraw", args: [amount!, address, address] };
    const res = await run([
      {
        title: `Withdrawing ${fmtAmount(receive)} MUSD`,
        done: `Withdrew ${fmtAmount(receive)} MUSD from ${s.meta.name}`,
        request: req,
      },
    ]);
    if (res) {
      setValue("");
      setUseMax(false);
    }
  }

  if (s.user.shares === 0n) {
    return <p className="text-sm text-silt">You have nothing in {s.meta.name} yet. Deposit first, then you can withdraw here.</p>;
  }

  return (
    <div className="grid gap-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <label htmlFor="wd-amount" className="text-silt">
            Amount to withdraw
          </label>
          <span className="text-silt tabular">Available: {fmtAmount(maxW)} MUSD</span>
        </div>
        <AmountInput
          id="wd-amount"
          value={value}
          onChange={(v) => {
            setValue(v);
            setUseMax(false);
          }}
          invalid={!!err}
          disabled={!!busy}
        />
        <div className="mt-2 flex gap-2">
          {[25, 50, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className="chip chip-btn"
              onClick={() => {
                if (pct === 100) {
                  setValue(toInputValue(maxW));
                  setUseMax(true);
                } else {
                  const v = (maxW * BigInt(pct)) / 100n;
                  setValue(toInputValue(v));
                  setUseMax(false);
                }
              }}
            >
              {pct === 100 ? "Max" : `${pct}%`}
            </button>
          ))}
        </div>
        {err && (
          <p className="mt-2 text-sm text-coral" role="alert">
            {err}
          </p>
        )}
      </div>

      {locked && (
        <div className="rounded-xl border border-sun/40 bg-sun/[0.07] p-4 text-sm leading-relaxed">
          <p className="font-semibold text-sun">Still locked for {fmtDuration(Number(s.user.unlockAt) - now / 1000)}</p>
          <p className="mt-1 text-mist">
            Withdrawing now costs a {fmtPct(Number(s.user.exitFeeBps))} early-exit penalty, which goes to the reward reserve.
            It unlocks on {fmtDate(s.user.unlockAt)}.
          </p>
        </div>
      )}
      {limitedByPool && (
        <div className="rounded-xl border border-coral/40 bg-coral/[0.07] p-4 text-sm leading-relaxed">
          <p className="font-semibold text-coral">Stability Pool withdrawals are paused</p>
          <p className="mt-1 text-mist">
            A trove is below 110% collateral, so Mezo&apos;s Stability Pool is holding funds. You can still take out up to the
            vault&apos;s idle buffer.
          </p>
        </div>
      )}
      {notAll && !limitedByPool && (
        <p className="text-sm text-silt">Part of your position can&apos;t be withdrawn right now because of available liquidity.</p>
      )}

      <dl className="grid gap-2 rounded-xl bg-trench/60 p-4">
        <Row label={locked ? "Early-exit penalty" : "Exit fee"}>{ok ? `${fmtAmount(fee)} MUSD` : fmtPct(Number(s.user.exitFeeBps))}</Row>
        <Row label="You receive">{ok ? `${fmtAmount(receive)} MUSD` : "—"}</Row>
        {isSp && s.user.pendingBtc > 0n && <Row label="BTC to claim separately">{fmtBtc(s.user.pendingBtc)} BTC</Row>}
      </dl>

      <button className={`btn btn-lg w-full ${locked ? "btn-warn" : "btn-primary"}`} disabled={!ok || !!busy} onClick={submit}>
        {busy ? <span className="spinner" /> : null}
        {busy ?? (locked ? "Withdraw early and pay penalty" : "Withdraw")}
      </button>
    </div>
  );
}

function ClaimForm({ s, onDone }: { s: StrategyView; onDone: () => void }) {
  const { run, busy } = useTx();
  const { health } = useSpHealth();
  const pending = s.user.pendingBtc;
  const usd = toNum(pending) * toNum(health?.btcPrice);
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-ember/30 bg-ember/[0.06] p-5">
        <p className="text-sm text-silt">BTC from liquidations, ready to claim</p>
        <p className="mt-1 text-3xl font-bold tracking-tight tabular text-ember">{fmtBtc(pending)}</p>
        <p className="text-sm text-silt">
          worth {fmtUsd(usd)} at the Mezo oracle price
        </p>
        {s.user.claimedBtc > 0n && <p className="mt-2 text-sm text-mist">Claimed so far: {fmtBtc(s.user.claimedBtc)} BTC</p>}
      </div>
      <p className="text-sm leading-relaxed text-silt">
        BTC builds up whenever a trove is liquidated against Mezo&apos;s Stability Pool. It arrives unevenly: there can be days
        with nothing, then a jump.
      </p>
      <button
        className="btn btn-ember btn-lg w-full"
        disabled={pending === 0n || !!busy}
        onClick={async () => {
          const res = await run([
            {
              title: "Claiming BTC",
              done: `Claimed ${fmtBtc(pending)} BTC`,
              request: { address: ADDR.sp, abi: spVaultAbi, functionName: "claimBtc" },
            },
          ]);
          if (res) onDone();
        }}
      >
        {busy ? <span className="spinner" /> : null}
        {busy ?? (pending === 0n ? "Nothing to claim yet" : "Claim BTC")}
      </button>
      <p className="text-xs text-silt">Withdrawing MUSD does not claim BTC. Claim it here any time, even after you exit.</p>
    </div>
  );
}

