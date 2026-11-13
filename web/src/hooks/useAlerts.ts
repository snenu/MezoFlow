"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import {
  useAlertPrefs,
  useAnnouncements,
  useMezoFlow,
  useSpHealth,
  useUserEntries,
  useVaultHistory,
} from "./useMezoFlow";
import { useNow } from "@/components/ui";
import { KIND, slugForVault, vaultName } from "@/lib/contracts";
import { fmtAmount, fmtBtc, fmtDuration, fmtPct } from "@/lib/format";

export const ALERT_BITS = {
  DEPOSIT: 1 << 0,
  WITHDRAW: 1 << 1,
  RATE_CHANGE: 1 << 2,
  ANNOUNCEMENT: 1 << 3,
  RISK: 1 << 4,
  LIQUIDITY: 1 << 5,
  BTC_GAINS: 1 << 6,
  UNLOCK: 1 << 7,
} as const;

export type AlertSeverity = "info" | "success" | "warning" | "critical";

export type Alert = {
  id: string;
  bit: number;
  severity: AlertSeverity;
  title: string;
  body: string;
  /** unix seconds */
  timestamp: number;
  href?: string;
  /** true for conditions that are true right now (not historical events) */
  live?: boolean;
};

export type Prefs = {
  mask: number;
  rateChangeBps: number;
  maxRiskScore: number;
  minRunwayDays: number;
  minIcrBps: number;
  updatedAt: number;
};

export const DEFAULT_PREFS: Prefs = {
  mask: 255,
  rateChangeBps: 50,
  maxRiskScore: 3,
  minRunwayDays: 14,
  minIcrBps: 11500,
  updatedAt: 0,
};

// ---- read-state store (localStorage, shared by every useAlerts instance) ----
const listeners = new Set<() => void>();
const cache = new Map<string, string>();
function storageKey(addr: string) {
  return `mezoflow:alerts-read:${addr.toLowerCase()}`;
}
function readRaw(addr: string): string {
  if (cache.has(addr)) return cache.get(addr)!;
  let v = "[]";
  try {
    v = window.localStorage.getItem(storageKey(addr)) ?? "[]";
  } catch {}
  cache.set(addr, v);
  return v;
}
function writeIds(addr: string, ids: string[]) {
  const v = JSON.stringify(ids.slice(-400));
  cache.set(addr, v);
  try {
    window.localStorage.setItem(storageKey(addr), v);
  } catch {}
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAlerts() {
  const { address } = useAccount();
  const { strategies } = useMezoFlow();
  const { entries } = useUserEntries(100);
  const { data: announcements } = useAnnouncements(20);
  const { byVault } = useVaultHistory();
  const { health } = useSpHealth();
  const { data: prefsRaw } = useAlertPrefs();
  const now = useNow(30_000);

  const prefs: Prefs = useMemo(() => {
    if (!prefsRaw) return DEFAULT_PREFS;
    const [p] = prefsRaw;
    return {
      mask: Number(p.mask),
      rateChangeBps: Number(p.rateChangeBps),
      maxRiskScore: Number(p.maxRiskScore),
      minRunwayDays: Number(p.minRunwayDays),
      minIcrBps: Number(p.minIcrBps),
      updatedAt: Number(p.updatedAt),
    };
  }, [prefsRaw]);
  const isDefault = prefsRaw ? prefsRaw[1] : true;

  const raw = useSyncExternalStore(
    subscribe,
    () => (address ? readRaw(address) : "[]"),
    () => "[]",
  );
  const readIds = useMemo(() => new Set<string>(JSON.parse(raw) as string[]), [raw]);

  const all: Alert[] = useMemo(() => {
    const out: Alert[] = [];
    const nowS = Math.floor(now / 1000);

    // Historical events from the on-chain ledger
    for (const e of entries) {
      const name = vaultName(e.vault);
      const slug = slugForVault(e.vault);
      const href = slug ? `/app/strategies/${slug}` : "/app/activity";
      if (e.kind === 0 || e.kind === 2) {
        out.push({
          id: `entry-${e.id}`,
          bit: ALERT_BITS.DEPOSIT,
          severity: "success",
          title: e.kind === 2 ? "Allocation confirmed" : "Deposit confirmed",
          body:
            e.kind === 2
              ? `${fmtAmount(e.assets)} MUSD was split across your chosen strategies.`
              : `${fmtAmount(e.assets)} MUSD is now in ${name}.`,
          timestamp: e.timestamp,
          href: e.kind === 2 ? "/app" : href,
        });
      } else if (e.kind === 1 || e.kind === 4) {
        out.push({
          id: `entry-${e.id}`,
          bit: ALERT_BITS.WITHDRAW,
          severity: e.kind === 4 ? "warning" : "success",
          title: e.kind === 4 ? "Early exit completed" : "Withdrawal completed",
          body:
            e.kind === 4
              ? `You received ${fmtAmount(e.assets)} MUSD from ${name}. A ${fmtAmount(e.fee)} MUSD early-exit penalty went to the reward reserve.`
              : `${fmtAmount(e.assets)} MUSD from ${name} is back in your wallet${e.fee > 0n ? ` after a ${fmtAmount(e.fee)} MUSD fee` : ""}.`,
          timestamp: e.timestamp,
          href,
        });
      } else if (e.kind === 3) {
        out.push({
          id: `entry-${e.id}`,
          bit: ALERT_BITS.BTC_GAINS,
          severity: "success",
          title: "BTC claimed",
          body: `${fmtBtc(e.assets)} BTC from Stability Pool liquidations was sent to your wallet.`,
          timestamp: e.timestamp,
          href,
        });
      }
    }

    // Rate changes recorded on-chain by each vault
    for (const s of strategies) {
      const h = byVault[s.meta.vault.toLowerCase()];
      if (!h) continue;
      for (let i = 1; i < h.rates.length; i++) {
        const a = h.rates[i - 1];
        const b = h.rates[i];
        if (Math.abs(b.bps - a.bps) < prefs.rateChangeBps) continue;
        out.push({
          id: `rate-${s.meta.vault}-${b.t}`,
          bit: ALERT_BITS.RATE_CHANGE,
          severity: b.bps < a.bps ? "warning" : "info",
          title: `${s.meta.name} rate ${b.bps > a.bps ? "went up" : "went down"}`,
          body: `The reserve-funded rate changed from ${fmtPct(a.bps)} to ${fmtPct(b.bps)} APR.`,
          timestamp: b.t,
          href: `/app/strategies/${s.meta.slug}`,
        });
      }
    }

    // Protocol announcements from the registry
    for (const a of announcements ?? []) {
      const sev = Number(a.severity);
      out.push({
        id: `ann-${a.timestamp}-${a.title}`,
        bit: ALERT_BITS.ANNOUNCEMENT,
        severity: sev >= 3 ? "critical" : sev === 2 ? "warning" : "info",
        title: a.title,
        body: a.body,
        timestamp: Number(a.timestamp),
      });
    }

    // Live conditions on positions the user holds
    if (nowS > 0) {
      for (const s of strategies) {
        const held = s.user.shares > 0n;
        const slug = `/app/strategies/${s.meta.slug}`;
        if (held && s.meta.riskScore > prefs.maxRiskScore) {
          out.push({
            id: `risk-${s.meta.vault}-${s.meta.riskScore}-${prefs.maxRiskScore}`,
            bit: ALERT_BITS.RISK,
            severity: "warning",
            title: `${s.meta.name} is above your risk limit`,
            body: `Its risk score is ${s.meta.riskScore} of 5 and your alert threshold is ${prefs.maxRiskScore}.`,
            timestamp: nowS,
            href: "/app/risk",
            live: true,
          });
        }
        if (held && s.stats.rateBps > 0) {
          const days = Number(s.stats.runwaySeconds) / 86400;
          if (Number.isFinite(days) && days < prefs.minRunwayDays) {
            out.push({
              id: `runway-${s.meta.vault}-${Math.floor(days)}`,
              bit: ALERT_BITS.RATE_CHANGE,
              severity: days < 3 ? "critical" : "warning",
              title: `${s.meta.name} reserve is running low`,
              body: `At today's deposits the reward reserve covers about ${fmtDuration(Number(s.stats.runwaySeconds))} more. After that the rate pays nothing until it is topped up.`,
              timestamp: nowS,
              href: slug,
              live: true,
            });
          }
        }
        if (s.meta.kind === KIND.STABILITY_POOL && s.user.pendingBtc > 0n) {
          out.push({
            id: `btc-pending-${s.user.pendingBtc > 10n ** 12n ? (s.user.pendingBtc / 10n ** 12n).toString() : "dust"}`,
            bit: ALERT_BITS.BTC_GAINS,
            severity: "info",
            title: "You have BTC to claim",
            body: `${fmtBtc(s.user.pendingBtc)} BTC from liquidations is waiting in the Stability Pool vault.`,
            timestamp: nowS,
            href: slug,
            live: true,
          });
        }
        if (s.meta.kind === KIND.TERM && held && s.user.unlockAt > 0n) {
          const unlock = Number(s.user.unlockAt);
          if (unlock <= nowS) {
            out.push({
              id: `unlock-${unlock}`,
              bit: ALERT_BITS.UNLOCK,
              severity: "success",
              title: "Your Term Savings position is unlocked",
              body: "You can withdraw it with no penalty, or leave it to keep earning.",
              timestamp: unlock,
              href: slug,
            });
          } else if (unlock - nowS < 48 * 3600) {
            out.push({
              id: `unlock-soon-${unlock}`,
              bit: ALERT_BITS.UNLOCK,
              severity: "info",
              title: "Term Savings unlocks soon",
              body: `Your position unlocks in ${fmtDuration(unlock - nowS)}.`,
              timestamp: nowS,
              href: slug,
              live: true,
            });
          }
        }
      }

      if (health) {
        const sp = strategies.find((s) => s.meta.kind === KIND.STABILITY_POOL);
        const exposed = (sp?.user.shares ?? 0n) > 0n;
        if (!health.withdrawalsOpen) {
          out.push({
            id: `sp-locked-${health.lowestTrove}`,
            bit: ALERT_BITS.LIQUIDITY,
            severity: exposed ? "critical" : "warning",
            title: "Stability Pool withdrawals are paused",
            body: "A trove is below 110% collateral, so Mezo's Stability Pool is blocking withdrawals. Only the vault's idle buffer can be withdrawn until it is liquidated or topped up.",
            timestamp: nowS,
            href: "/app/risk",
            live: true,
          });
        } else if (health.lowestIcr > 0n && Number(health.lowestIcr / 10n ** 14n) < prefs.minIcrBps) {
          out.push({
            id: `icr-${health.lowestTrove}-${health.lowestIcr / 10n ** 16n}`,
            bit: ALERT_BITS.LIQUIDITY,
            severity: "warning",
            title: "A trove is close to liquidation",
            body: `The weakest trove on Mezo is at ${(Number(health.lowestIcr / 10n ** 14n) / 100).toFixed(1)}% collateral. Below 110%, Stability Pool withdrawals pause and a liquidation may follow.`,
            timestamp: nowS,
            href: "/app/risk",
            live: true,
          });
        }
      }
    }

    return out.sort((a, b) => b.timestamp - a.timestamp);
  }, [entries, strategies, byVault, announcements, health, prefs, now]);

  const alerts = useMemo(() => all.filter((a) => (prefs.mask & a.bit) !== 0), [all, prefs.mask]);
  const unread = address ? alerts.filter((a) => !readIds.has(a.id)).length : 0;

  const markAllRead = useCallback(() => {
    if (!address) return;
    const prev = JSON.parse(readRaw(address)) as string[];
    writeIds(address, [...new Set([...prev, ...alerts.map((a) => a.id)])]);
  }, [address, alerts]);

  const markRead = useCallback(
    (id: string) => {
      if (!address) return;
      const prev = JSON.parse(readRaw(address)) as string[];
      if (!prev.includes(id)) writeIds(address, [...prev, id]);
    },
    [address],
  );

  return { alerts, all, unread, readIds, markAllRead, markRead, prefs, isDefault };
}
