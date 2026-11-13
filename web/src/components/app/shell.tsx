"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useLayoutEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useBlockNumber } from "wagmi";
import { Logo } from "@/components/brand";
import { ConnectButton } from "@/components/wallet";
import { useMezoFlow } from "@/hooks/useMezoFlow";
import { useAlerts } from "@/hooks/useAlerts";
import { useHydrated } from "@/hooks/useAccount";
import { fmtAmount } from "@/lib/format";
import { FaucetButton } from "./faucet";
import {
  IconActivity,
  IconAllocate,
  IconBell,
  IconChat,
  IconMenu,
  IconOverview,
  IconRisk,
  IconStrategies,
  IconSwap,
} from "./icons";

const NAV = [
  { href: "/app", label: "Overview", icon: IconOverview },
  { href: "/app/strategies", label: "Strategies", icon: IconStrategies },
  { href: "/app/swap", label: "Get MUSD", icon: IconSwap },
  { href: "/app/allocate", label: "Auto allocator", icon: IconAllocate },
  { href: "/app/risk", label: "Risk", icon: IconRisk },
  { href: "/app/activity", label: "Activity", icon: IconActivity },
  { href: "/app/alerts", label: "Alerts", icon: IconBell },
  { href: "/app/assistant", label: "Ask Flow", icon: IconChat },
] as const;

function isActive(path: string, href: string) {
  return href === "/app" ? path === "/app" : path === href || path.startsWith(href + "/");
}

function useUnread() {
  const { unread } = useAlerts();
  // Read state lives in the browser, so the badge only appears after hydration.
  return useHydrated() ? unread : 0;
}

function NavList({ onNavigate, path }: { onNavigate?: () => void; path: string | null }) {
  const unread = useUnread();
  return (
    <ul className="grid gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = path !== null && isActive(path, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onNavigate={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[0.95rem] font-medium transition-colors ${
                active ? "bg-black text-white" : "text-mist hover:bg-trench hover:text-black"
              }`}
            >
              <Icon />
              <span className="flex-1">{label}</span>
              {href === "/app/alerts" && unread > 0 && (
                <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[0.7rem] font-bold ${active ? "bg-white text-black" : "bg-blue text-white"}`}>
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function LiveNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return <NavList path={path} onNavigate={onNavigate} />;
}

/** The pathname is only known at request time, so the active-state highlight streams in
 * behind a Suspense boundary and the rest of the shell can be prerendered. */
function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList path={null} onNavigate={onNavigate} />}>
      <LiveNav onNavigate={onNavigate} />
    </Suspense>
  );
}

function NetworkStatus() {
  const { data: block, isError } = useBlockNumber({ watch: { pollingInterval: 6_000 } });
  return (
    <div className="flex items-center gap-2 text-xs text-silt">
      <span className={`h-1.5 w-1.5 rounded-full ${isError ? "bg-black" : "live-dot bg-blue"}`} aria-hidden />
      <span>
        Mezo Testnet{block ? <span className="tabular">, block {block.toLocaleString("en-US")}</span> : null}
      </span>
    </div>
  );
}

function WalletBalance() {
  const { account } = useMezoFlow();
  if (!account) return null;
  return (
    <Link
      href="/app"
      className="hidden items-center gap-2 rounded-md border border-shoal px-3 py-2 text-sm hover:border-black sm:flex"
      title="MUSD in your wallet"
    >
      <span className="h-2 w-2 rounded-full bg-blue" aria-hidden />
      <span className="tabular font-semibold">{fmtAmount(account.musdBalance)}</span>
      <span className="text-silt">MUSD</span>
    </Link>
  );
}

function AlertBell() {
  const unread = useUnread();
  return (
    <Link href="/app/alerts" className="icon-btn relative h-10 w-10" aria-label={`Alerts, ${unread} unread`}>
      <IconBell />
      {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-blue ring-2 ring-white" />}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  useLayoutEffect(() => () => setDrawer(false), []);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r rule bg-white px-4 py-5 lg:flex">
        <div className="px-2">
          <Logo href="/" />
        </div>
        <nav className="mt-8" aria-label="App">
          <Nav />
        </nav>
        <div className="mt-auto grid gap-4 px-2">
          <FaucetButton className="btn btn-ghost w-full" />
          <NetworkStatus />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b rule bg-white">
          <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-2 px-4 sm:gap-3 sm:px-8">
            <button className="icon-btn h-10 w-10 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <IconMenu />
            </button>
            <div className="lg:hidden">
              <Logo href="/" compact />
            </div>
            <div className="ml-auto flex items-center gap-2 sm:gap-3">
              <WalletBalance />
              <AlertBell />
              <ConnectButton />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1240px] px-4 pb-24 pt-8 sm:px-8">{children}</main>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}
          >
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="flex h-full w-[280px] flex-col border-r rule bg-abyss px-4 py-5"
            >
              <div className="px-2">
                <Logo href="/" />
              </div>
              <nav className="mt-8" aria-label="App">
                <Nav onNavigate={() => setDrawer(false)} />
              </nav>
              <div className="mt-auto grid gap-4 px-2">
                <FaucetButton className="btn btn-ghost w-full" />
                <NetworkStatus />
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <title>{`${title} · MezoFlow`}</title>
      <div className="min-w-0">
        <h1 className="wide text-[clamp(1.6rem,1.2rem+1.6vw,2.3rem)] font-bold tracking-[-0.035em] leading-tight">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-silt leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Shown on pages that need a wallet. */
export function ConnectPrompt({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel flex flex-col items-start gap-3 p-8">
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-[52ch] text-silt">{body}</p>
      <div className="mt-2">
        <ConnectButton />
      </div>
    </div>
  );
}
