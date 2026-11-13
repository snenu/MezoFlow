"use client";

import { useSyncExternalStore } from "react";
import { useAccount as useWagmiAccount } from "wagmi";

const subscribe = () => () => {};

/** False during server render and hydration, true afterwards. */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/**
 * wagmi's useAccount, but disconnected until hydration finishes. An injected wallet can
 * reconnect before React hydrates, which made the first client render differ from the
 * server HTML (connected vs. connect prompt).
 */
export function useAccount() {
  const account = useWagmiAccount();
  const hydrated = useHydrated();
  if (hydrated) return account;
  return { ...account, address: undefined, isConnected: false, status: "disconnected" as const, chainId: undefined };
}
