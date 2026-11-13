"use client";

import { useMemo } from "react";
import { useAccount, useBalance, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address, type Hash } from "viem";
import { ADDR, lensAbi, ledgerAbi, registryAbi, spVaultAbi, vaultAbi, alertCenterAbi, allocatorAbi, START_BLOCK } from "@/lib/contracts";
import { LOG_RANGE } from "@/lib/chain";

const REFRESH = 15_000;

/** Protocol + every strategy + the connected account, from one MezoFlowLens call. */
export function useMezoFlow() {
  const { address } = useAccount();
  const q = useReadContract({
    address: ADDR.lens,
    abi: lensAbi,
    functionName: "getAll",
    args: [address ?? zeroAddress],
    query: { refetchInterval: REFRESH },
  });
  const [protocol, strategies, account] = q.data ?? [];
  return {
    address,
    protocol,
    strategies: strategies ?? [],
    account: address ? account : undefined,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    refetch: q.refetch,
  };
}

export type StrategyView = NonNullable<ReturnType<typeof useMezoFlow>["strategies"]>[number];
export type ProtocolView = NonNullable<ReturnType<typeof useMezoFlow>["protocol"]>;
export type AccountView = NonNullable<ReturnType<typeof useMezoFlow>["account"]>;

export function useBtcBalance() {
  const { address } = useAccount();
  return useBalance({ address, query: { enabled: !!address, refetchInterval: REFRESH } });
}

/** Live telemetry from Mezo's Stability Pool, TroveManager and price oracle. */
export function useSpHealth() {
  const q = useReadContracts({
    contracts: [
      { address: ADDR.sp, abi: spVaultAbi, functionName: "spHealth" },
      { address: ADDR.sp, abi: spVaultAbi, functionName: "btcStats" },
    ],
    query: { refetchInterval: REFRESH },
  });
  return {
    health: q.data?.[0]?.result,
    btc: q.data?.[1]?.result,
    isLoading: q.isLoading,
  };
}

export function useAnnouncements(limit = 20) {
  return useReadContract({
    address: ADDR.registry,
    abi: registryAbi,
    functionName: "getAnnouncements",
    args: [0n, BigInt(limit)],
    query: { refetchInterval: 60_000 },
  });
}

export function usePresets() {
  return useReadContract({ address: ADDR.allocator, abi: allocatorAbi, functionName: "getPresets" });
}

export function usePlan() {
  const { address } = useAccount();
  return useReadContract({
    address: ADDR.allocator,
    abi: allocatorAbi,
    functionName: "plans",
    args: [address ?? zeroAddress],
    query: { enabled: !!address },
  });
}

export function useAlertPrefs() {
  const { address } = useAccount();
  return useReadContract({
    address: ADDR.alerts,
    abi: alertCenterAbi,
    functionName: "getPreferences",
    args: [address ?? zeroAddress],
    query: { enabled: !!address },
  });
}

const VAULTS = [ADDR.flex, ADDR.term, ADDR.sp] as const;

/** Share-price checkpoints and rate history for every vault. */
export function useVaultHistory() {
  const q = useReadContracts({
    contracts: VAULTS.flatMap((v) => [
      { address: v, abi: vaultAbi, functionName: "getCheckpoints", args: [0n, 2000n] } as const,
      { address: v, abi: vaultAbi, functionName: "getRateHistory" } as const,
    ]),
    query: { refetchInterval: 60_000 },
  });
  return useMemo(() => {
    const out: Record<string, { checkpoints: { t: number; price: bigint }[]; rates: { t: number; bps: number }[] }> = {};
    VAULTS.forEach((v, i) => {
      const cps = (q.data?.[i * 2]?.result as readonly { timestamp: bigint; sharePrice: bigint }[] | undefined) ?? [];
      const rates = (q.data?.[i * 2 + 1]?.result as readonly { timestamp: bigint; rateBps: number }[] | undefined) ?? [];
      out[v.toLowerCase()] = {
        checkpoints: cps.map((c) => ({ t: Number(c.timestamp), price: c.sharePrice })),
        rates: rates.map((r) => ({ t: Number(r.timestamp), bps: Number(r.rateBps) })),
      };
    });
    return { byVault: out, isLoading: q.isLoading };
  }, [q.data, q.isLoading]);
}

export type LedgerEntry = {
  id: bigint;
  timestamp: number;
  blockNumber: bigint;
  kind: number;
  vault: Address;
  user: Address;
  assets: bigint;
  shares: bigint;
  fee: bigint;
};

type RawEntry = {
  timestamp: bigint;
  blockNumber: bigint;
  kind: number;
  vault: Address;
  user: Address;
  assets: bigint;
  shares: bigint;
  fee: bigint;
};

function zip(entries: readonly RawEntry[] | undefined, ids: readonly bigint[] | undefined): LedgerEntry[] {
  if (!entries || !ids) return [];
  return entries.map((e, i) => ({
    id: ids[i],
    timestamp: Number(e.timestamp),
    blockNumber: e.blockNumber,
    kind: Number(e.kind),
    vault: e.vault,
    user: e.user,
    assets: e.assets,
    shares: e.shares,
    fee: e.fee,
  }));
}

/** The connected user's on-chain activity, newest first. */
export function useUserEntries(limit = 500) {
  const { address } = useAccount();
  const q = useReadContract({
    address: ADDR.ledger,
    abi: ledgerAbi,
    functionName: "getUserEntries",
    args: [address ?? zeroAddress, 0n, BigInt(limit)],
    query: { enabled: !!address, refetchInterval: REFRESH },
  });
  const entries = useMemo(() => zip(q.data?.[0] as readonly RawEntry[] | undefined, q.data?.[1]), [q.data]);
  return { entries, isLoading: q.isLoading && !!address, refetch: q.refetch };
}

/** Protocol-wide activity feed, newest first. */
export function useRecentActivity(limit = 12) {
  const q = useReadContract({
    address: ADDR.ledger,
    abi: ledgerAbi,
    functionName: "getRecent",
    args: [0n, BigInt(limit)],
    query: { refetchInterval: REFRESH },
  });
  const entries = useMemo(() => zip(q.data?.[0] as readonly RawEntry[] | undefined, q.data?.[1]), [q.data]);
  return { entries, isLoading: q.isLoading };
}

/**
 * Resolve transaction hashes for ledger entries. The ledger stores the block number of
 * every entry, so we only query the exact block windows that contain entries (Mezo's
 * RPC limits eth_getLogs to 10k blocks).
 */
export function useTxHashes(entries: LedgerEntry[]) {
  const client = usePublicClient();
  const key = entries.map((e) => e.id.toString()).join(",");
  return useQuery({
    queryKey: ["ledger-tx", key],
    enabled: !!client && entries.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const map: Record<string, Hash> = {};
      if (!client) return map;
      const blocks = [...new Set(entries.map((e) => e.blockNumber))].sort((a, b) => (a < b ? -1 : 1));
      const windows: [bigint, bigint][] = [];
      for (const b of blocks) {
        const last = windows[windows.length - 1];
        if (last && b - last[0] <= LOG_RANGE) last[1] = b;
        else windows.push([b, b]);
      }
      const ids = entries.map((e) => e.id);
      await Promise.all(
        windows.map(async ([from, to]) => {
          const logs = await client.getContractEvents({
            address: ADDR.ledger,
            abi: ledgerAbi,
            eventName: "Recorded",
            args: { id: ids },
            fromBlock: from < START_BLOCK ? START_BLOCK : from,
            toBlock: to,
          });
          for (const l of logs) {
            const id = (l.args as { id?: bigint }).id;
            if (id !== undefined && l.transactionHash) map[id.toString()] = l.transactionHash;
          }
        }),
      );
      return map;
    },
  });
}
