"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { mezoTestnet, addressUrl } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { explainError } from "@/lib/errors";

type Ctx = { open: () => void };
const WalletCtx = createContext<Ctx>({ open: () => {} });
export const useWalletModal = () => useContext(WalletCtx);

export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <WalletCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <WalletModal open={isOpen} onClose={() => setOpen(false)} />
    </WalletCtx.Provider>
  );
}

function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { isConnected } = useAccount();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);

  // EIP-6963 wallets announce themselves with a name and icon; the generic "Injected"
  // connector is only useful when nothing announced itself.
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const list: readonly Connector[] = announced.length ? announced : connectors;

  useEffect(() => {
    if (isConnected && open) onClose();
  }, [isConnected, open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLButtonElement>("button[data-wallet]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useLayoutEffect(() => () => setError(null), []);

  async function connect(c: Connector) {
    setError(null);
    setPending(c.uid);
    try {
      await connectAsync({ connector: c, chainId: mezoTestnet.id });
    } catch (e) {
      setError(explainError(e));
    } finally {
      setPending(null);
    }
  }

  const hasWallet = list.some((c) => c.id !== "injected") || (typeof window !== "undefined" && "ethereum" in window);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-title"
            className="modal-panel w-[min(420px,100%)]"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="wallet-title" className="text-xl font-semibold tracking-tight">
                  Connect a wallet
                </h2>
                <p className="mt-1 text-sm text-silt">
                  MezoFlow runs on Mezo Testnet. Your wallet will be asked to add the network if it doesn&apos;t have it.
                </p>
              </div>
              <button onClick={onClose} className="icon-btn" aria-label="Close">
                ×
              </button>
            </div>

            <div className="mt-5 grid gap-2">
              {hasWallet ? (
                list.map((c) => (
                  <button
                    key={c.uid}
                    data-wallet
                    onClick={() => connect(c)}
                    disabled={!!pending}
                    className="wallet-option"
                  >
                    {c.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.icon} alt="" width={28} height={28} className="rounded-md" />
                    ) : (
                      <span className="wallet-fallback-icon" aria-hidden />
                    )}
                    <span className="flex-1 text-left font-medium">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                    {pending === c.uid ? <span className="spinner" /> : <span className="text-silt text-sm">Connect</span>}
                  </button>
                ))
              ) : (
                <a className="wallet-option" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  <span className="wallet-fallback-icon" aria-hidden />
                  <span className="flex-1 text-left font-medium">Install MetaMask</span>
                  <span className="text-silt text-sm">metamask.io</span>
                </a>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
                {error}
              </p>
            )}

            <p className="mt-5 text-xs leading-relaxed text-silt">
              Need gas? Testnet BTC is free from the{" "}
              <a className="link" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer">
                Mezo faucet
              </a>
              . MezoFlow never asks for your seed phrase and every action needs your signature.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, chainId, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { open } = useWalletModal();
  const [menu, setMenu] = useState(false);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => () => setMenu(false), []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  // Auto-reconnect waits on the wallet. A locked or unresponsive extension can leave it
  // pending forever, so after a short grace period we offer the connect button again.
  const [reconnectStalled, setReconnectStalled] = useState(false);
  useEffect(() => {
    if (status !== "reconnecting") return;
    const t = setTimeout(() => setReconnectStalled(true), 2500);
    return () => {
      clearTimeout(t);
      setTimeout(() => setReconnectStalled(false), 0);
    };
  }, [status]);

  if (!mounted || status === "connecting" || (status === "reconnecting" && !reconnectStalled)) {
    return <span className="btn btn-ghost opacity-60" aria-busy="true">{compact ? "…" : "Connecting…"}</span>;
  }

  if (!isConnected || !address) {
    return (
      <button className="btn btn-primary" onClick={open}>
        Connect wallet
      </button>
    );
  }

  if (chainId !== mezoTestnet.id) {
    return (
      <button className="btn btn-warn" onClick={() => switchChain({ chainId: mezoTestnet.id })} disabled={switching}>
        {switching ? "Switching…" : "Switch to Mezo Testnet"}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost gap-2" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
        <span className="h-2 w-2 rounded-full bg-tide shadow-[0_0_0_3px_var(--color-sky-soft)]" aria-hidden />
        <span className="tabular-nums">{shortAddr(address)}</span>
      </button>
      {menu && (
        <div role="menu" className="popover right-0 mt-2 w-56">
          <a role="menuitem" className="menu-item" href={addressUrl(address)} target="_blank" rel="noreferrer">
            View on explorer
          </a>
          <button
            role="menuitem"
            className="menu-item"
            onClick={() => {
              navigator.clipboard?.writeText(address);
              setMenu(false);
            }}
          >
            Copy address
          </button>
          <button
            role="menuitem"
            className="menu-item text-coral"
            onClick={() => {
              disconnect();
              setMenu(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
