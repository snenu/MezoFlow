"use client";

import { useMemo } from "react";
import { useMezoFlow, useSpHealth, useUserEntries, useVaultHistory, type StrategyView } from "./useMezoFlow";
import { toNum } from "@/lib/format";
import { useNow } from "@/components/ui";

export type HistoryPoint = { t: number; value: number; net: number };

/**
 * Portfolio value over time, rebuilt purely from chain data:
 *  - share movements per vault from the ActivityLedger (deposits, withdrawals, transfers)
 *  - each vault's share-price checkpoints
 * value(t) = Σ shares_v(t) × sharePrice_v(t);  net(t) = deposits − withdrawals up to t.
 */
export function usePortfolio() {
  const { strategies, account, protocol, isLoading } = useMezoFlow();
  const { entries, isLoading: entriesLoading } = useUserEntries(500);
  const { byVault } = useVaultHistory();
  const { health, btc } = useSpHealth();
  const now = useNow(60_000);

  const positions = useMemo(
    () =>
      strategies.map((s: StrategyView) => ({
        strategy: s,
        value: toNum(s.user.assets),
        shares: s.user.shares,
      })),
    [strategies],
  );

  const totalValue = positions.reduce((a, p) => a + p.value, 0);
  const wallet = toNum(account?.musdBalance);
  const deposited = toNum(account?.deposited);
  const withdrawn = toNum(account?.withdrawn);
  const fees = toNum(account?.fees);
  const pnl = totalValue + withdrawn - deposited;
  const btcPrice = toNum(health?.btcPrice);
  const sp = strategies.find((s) => s.meta.kind === 3);
  const pendingBtc = toNum(sp?.user.pendingBtc);
  const claimedBtc = toNum(sp?.user.claimedBtc);

  const history: HistoryPoint[] = useMemo(() => {
    if (!entries.length) return [];
    const ordered = [...entries].sort((a, b) => (a.id < b.id ? -1 : 1));
    const shareEvents: Record<string, { t: number; d: bigint }[]> = {};
    const netEvents: { t: number; d: number }[] = [];
    for (const e of ordered) {
      const v = e.vault.toLowerCase();
      const sign = e.kind === 0 || e.kind === 5 ? 1n : e.kind === 1 || e.kind === 4 || e.kind === 6 ? -1n : 0n;
      if (sign !== 0n) (shareEvents[v] ??= []).push({ t: e.timestamp, d: sign * e.shares });
      if (e.kind === 0) netEvents.push({ t: e.timestamp, d: toNum(e.assets) });
      if (e.kind === 1 || e.kind === 4) netEvents.push({ t: e.timestamp, d: -toNum(e.assets) });
    }
    const start = ordered[0].timestamp;
    const times = new Set<number>(ordered.map((e) => e.timestamp));
    for (const h of Object.values(byVault)) for (const c of h.checkpoints) if (c.t >= start) times.add(c.t);
    if (now > 0) times.add(Math.floor(now / 1000));
    const grid = [...times].sort((a, b) => a - b);

    const priceAt = (vault: string, t: number): bigint => {
      const cps = byVault[vault]?.checkpoints ?? [];
      let p = 10n ** 18n;
      for (const c of cps) {
        if (c.t <= t) p = c.price;
        else break;
      }
      return p;
    };
    const live: Record<string, bigint> = {};
    for (const s of strategies) live[s.meta.vault.toLowerCase()] = s.stats.sharePrice;
    const lastT = grid[grid.length - 1];

    return grid.map((t) => {
      let value = 0;
      for (const [vault, evs] of Object.entries(shareEvents)) {
        let shares = 0n;
        for (const ev of evs) if (ev.t <= t) shares += ev.d;
        if (shares <= 0n) continue;
        const price = t === lastT && live[vault] ? live[vault] : priceAt(vault, t);
        value += toNum((shares * price) / 10n ** 18n);
      }
      let net = 0;
      for (const ev of netEvents) if (ev.t <= t) net += ev.d;
      return { t, value, net };
    });
  }, [entries, byVault, strategies, now]);

  return {
    loading: isLoading || entriesLoading,
    positions,
    totalValue,
    wallet,
    btcBalance: toNum(account?.btcBalance),
    deposited,
    withdrawn,
    fees,
    pnl,
    btcPrice,
    pendingBtc,
    claimedBtc,
    btcEarnedUsd: (pendingBtc + claimedBtc) * btcPrice,
    history,
    protocol,
    account,
    strategies,
    btcStats: btc,
    actions: Number(account?.actions ?? 0),
    firstActivity: Number(account?.firstActivity ?? 0),
  };
}
