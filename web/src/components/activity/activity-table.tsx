"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import type { Hash } from "viem";
import { useTxHashes, type LedgerEntry } from "@/hooks/useMezoFlow";
import { LEDGER_KIND, slugForVault, vaultName } from "@/lib/contracts";
import { addressUrl, txUrl } from "@/lib/chain";
import { fmtAmount, fmtBtc, fmtDate, shortAddr, shortHash, timeAgo } from "@/lib/format";
import { Badge, Empty, Skel, useNow } from "@/components/ui";
import { useToast } from "@/components/toast";
import { FILTERABLE_VAULTS, downloadCsv, entriesToCsv, resolveTxHashes } from "./export";

const PAGE = 25;
const selectCls =
  "h-10 rounded-[10px] border border-shoal bg-trench px-3 text-sm text-foam transition-colors hover:border-reef focus-visible:border-tide";

function Amount({ e }: { e: LedgerEntry }) {
  if (e.kind === 3) return <>{fmtBtc(e.assets)} BTC</>;
  return <>{fmtAmount(e.assets)} MUSD</>;
}

function Strategy({ vault }: { vault: string }) {
  const slug = slugForVault(vault);
  const name = vaultName(vault);
  return slug ? (
    <Link href={`/app/strategies/${slug}`} className="hover:text-tide">
      {name}
    </Link>
  ) : (
    <span className="text-mist">{name}</span>
  );
}

function TxCell({ hash, loading }: { hash?: Hash; loading: boolean }) {
  if (hash)
    return (
      <a className="link tabular text-sm" href={txUrl(hash)} target="_blank" rel="noreferrer" title={hash}>
        {shortHash(hash)}
      </a>
    );
  if (loading) return <Skel w="6.5rem" />;
  return <span className="text-sm text-silt">Not found</span>;
}

export function ActivityTable({
  entries,
  loading,
  showAccount,
  csvName,
  emptyTitle,
  emptyBody,
  emptyAction,
}: {
  entries: LedgerEntry[];
  loading: boolean;
  showAccount: boolean;
  csvName: string;
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: React.ReactNode;
}) {
  const [kind, setKind] = useState<string>("all");
  const [vault, setVault] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const client = usePublicClient();
  const toast = useToast();
  const now = useNow(30_000);

  const kindsPresent = useMemo(() => [...new Set(entries.map((e) => e.kind))].sort((a, b) => a - b), [entries]);

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (kind === "all" || e.kind === Number(kind)) &&
          (vault === "all" || e.vault.toLowerCase() === vault.toLowerCase()),
      ),
    [entries, kind, vault],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const visible = useMemo(() => filtered.slice(current * PAGE, current * PAGE + PAGE), [filtered, current]);
  const { data: hashes, isLoading: hashesLoading } = useTxHashes(visible);

  async function exportCsv() {
    if (!client || filtered.length === 0) return;
    setExporting(true);
    try {
      const all = await resolveTxHashes(client, filtered);
      downloadCsv(csvName, entriesToCsv(filtered, all));
    } catch {
      toast.push({
        status: "error",
        title: "Export failed",
        body: "Mezo Testnet didn't return the transaction hashes. Try again in a moment.",
      });
    } finally {
      setExporting(false);
    }
  }

  const reset = () => setPage(0);

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b rule px-4 py-3 sm:px-5">
        <label className="sr-only" htmlFor="filter-kind">
          Filter by type
        </label>
        <select
          id="filter-kind"
          className={selectCls}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            reset();
          }}
        >
          <option value="all">All types</option>
          {kindsPresent.map((k) => (
            <option key={k} value={k}>
              {LEDGER_KIND[k]?.label ?? `Kind ${k}`}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-vault">
          Filter by strategy
        </label>
        <select
          id="filter-vault"
          className={selectCls}
          value={vault}
          onChange={(e) => {
            setVault(e.target.value);
            reset();
          }}
        >
          <option value="all">All strategies</option>
          {FILTERABLE_VAULTS.map((v) => (
            <option key={v} value={v}>
              {vaultName(v)}
            </option>
          ))}
        </select>
        <span className="text-sm text-silt tabular">
          {loading ? "Loading…" : `${filtered.length} ${filtered.length === 1 ? "action" : "actions"}`}
        </span>
        <button
          className="btn btn-ghost ml-auto"
          onClick={exportCsv}
          disabled={exporting || loading || filtered.length === 0}
        >
          {exporting ? <span className="spinner" /> : null}
          {exporting ? "Preparing CSV…" : "Export CSV"}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 p-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skel key={i} w="100%" h="2.25rem" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        entries.length === 0 ? (
          <Empty title={emptyTitle} body={emptyBody} action={emptyAction} />
        ) : (
          <Empty
            title="Nothing matches these filters"
            body="Try a different type or strategy."
            action={
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setKind("all");
                  setVault("all");
                  reset();
                }}
              >
                Clear filters
              </button>
            }
          />
        )
      ) : (
        <>
          {/* desktop / tablet */}
          <div className="hidden overflow-x-auto md:block">
            <table className="table min-w-[880px]">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Strategy</th>
                  {showAccount && <th scope="col">Account</th>}
                  <th scope="col" className="text-right">
                    Amount
                  </th>
                  <th scope="col" className="text-right">
                    Fee
                  </th>
                  <th scope="col" className="text-right">
                    Shares
                  </th>
                  <th scope="col">Time</th>
                  <th scope="col">Status</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id.toString()}>
                    <td className="font-medium">{LEDGER_KIND[e.kind]?.label ?? "Action"}</td>
                    <td>
                      <Strategy vault={e.vault} />
                    </td>
                    {showAccount && (
                      <td>
                        <a
                          className="tabular text-sm text-silt hover:text-foam"
                          href={addressUrl(e.user)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortAddr(e.user)}
                        </a>
                      </td>
                    )}
                    <td className="text-right font-semibold tabular whitespace-nowrap">
                      <Amount e={e} />
                    </td>
                    <td className="text-right tabular text-mist whitespace-nowrap">
                      {e.fee > 0n && e.kind !== 3 ? `${fmtAmount(e.fee)} MUSD` : "None"}
                    </td>
                    <td className="text-right tabular text-mist">{e.shares > 0n ? fmtAmount(e.shares) : "None"}</td>
                    <td className="whitespace-nowrap">
                      <span className="block text-sm">{fmtDate(e.timestamp)}</span>
                      <span className="block text-xs text-silt">{now ? timeAgo(e.timestamp, now) : ""}</span>
                    </td>
                    <td>
                      <Badge tone="tide">Confirmed</Badge>
                    </td>
                    <td>
                      <TxCell hash={hashes?.[e.id.toString()]} loading={hashesLoading || !hashes} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* phone */}
          <ul className="divide-y divide-shoal/70 md:hidden">
            {visible.map((e) => (
              <li key={e.id.toString()} className="grid gap-1.5 px-4 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{LEDGER_KIND[e.kind]?.label ?? "Action"}</span>
                  <span className="font-semibold tabular">
                    <Amount e={e} />
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <Strategy vault={e.vault} />
                  <span className="text-silt">{now ? timeAgo(e.timestamp, now) : fmtDate(e.timestamp)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="text-silt">
                    {e.fee > 0n && e.kind !== 3 ? `Fee ${fmtAmount(e.fee)} MUSD` : "No fee"}
                    {showAccount ? ` by ${shortAddr(e.user)}` : ""}
                  </span>
                  <TxCell hash={hashes?.[e.id.toString()]} loading={hashesLoading || !hashes} />
                </div>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav className="flex items-center justify-between gap-3 border-t rule px-4 py-3 sm:px-5" aria-label="Pagination">
              <span className="text-sm text-silt tabular">
                {current * PAGE + 1}–{Math.min((current + 1) * PAGE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={() => setPage(current - 1)} disabled={current === 0}>
                  Newer
                </button>
                <button className="btn btn-ghost" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
                  Older
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
