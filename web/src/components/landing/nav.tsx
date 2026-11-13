"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBlockNumber } from "wagmi";
import { Logo } from "@/components/brand";

const LINKS = [
  ["Strategies", "#strategies"],
  ["Features", "#features"],
  ["How it works", "#how"],
  ["Risks", "#risks"],
  ["FAQ", "#faq"],
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
        scrolled ? "border-b rule bg-white/85 backdrop-blur-md" : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-5 sm:px-10" aria-label="Main">
        <Logo />
        <ul className="hidden items-center gap-6 text-sm text-mist lg:flex">
          {LINKS.map(([label, href]) => (
            <li key={href}>
              <a href={href} className="transition-colors hover:text-foam">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          <LiveBlock />
          <Link href="/app" className="btn btn-primary">
            Open the app
          </Link>
        </div>
      </nav>
    </header>
  );
}

function LiveBlock() {
  const { data: block } = useBlockNumber({ watch: { pollingInterval: 6_000 } });
  return (
    <a
      href={block ? `https://explorer.test.mezo.org/block/${block}` : "https://explorer.test.mezo.org"}
      target="_blank"
      rel="noreferrer"
      className="hidden items-center gap-2 text-sm text-silt transition-colors hover:text-foam md:inline-flex"
      title="Latest Mezo Testnet block"
    >
      <span className="live-dot h-1.5 w-1.5 rounded-full bg-sky" aria-hidden />
      <span className="tabular">{block ? `Block ${block.toLocaleString("en-US")}` : "Mezo Testnet"}</span>
    </a>
  );
}

export function Footer() {
  return (
    <footer className="border-t rule">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-5 py-12 sm:px-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-[46ch] text-sm leading-relaxed text-silt">
            MezoFlow is a testnet preview built for the Mezo ecosystem. It is not audited, holds only test funds, and does not
            promise any return. Always check the contracts before you deposit.
          </p>
        </div>
        <div className="text-sm">
          <p className="font-semibold">App</p>
          <ul className="mt-3 grid gap-2 text-silt">
            <li><Link className="hover:text-foam" href="/app">Overview</Link></li>
            <li><Link className="hover:text-foam" href="/app/strategies">Strategies</Link></li>
            <li><Link className="hover:text-foam" href="/app/allocate">Auto allocator</Link></li>
            <li><Link className="hover:text-foam" href="/app/risk">Risk dashboard</Link></li>
            <li><Link className="hover:text-foam" href="/app/assistant">Ask Flow</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="font-semibold">Mezo</p>
          <ul className="mt-3 grid gap-2 text-silt">
            <li><a className="hover:text-foam" href="https://mezo.org/docs/developers/musd/" target="_blank" rel="noreferrer">MUSD docs</a></li>
            <li><a className="hover:text-foam" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer">Testnet BTC faucet</a></li>
            <li><a className="hover:text-foam" href="https://explorer.test.mezo.org" target="_blank" rel="noreferrer">Testnet explorer</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
