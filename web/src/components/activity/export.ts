import { formatUnits, type Hash, type PublicClient } from "viem";
import { ADDR, LEDGER_KIND, START_BLOCK, ledgerAbi, vaultName } from "@/lib/contracts";
import { LOG_RANGE, txUrl } from "@/lib/chain";
import type { LedgerEntry } from "@/hooks/useMezoFlow";

/**
 * Resolve tx hashes for any number of ledger entries, querying only the block windows that
 * contain entries (Mezo's RPC caps eth_getLogs at 10k blocks) and chunking the id filter.
 */
export async function resolveTxHashes(client: PublicClient, entries: LedgerEntry[]): Promise<Record<string, Hash>> {
  const map: Record<string, Hash> = {};
  if (entries.length === 0) return map;
  const sorted = [...entries].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : 1));
  const windows: { from: bigint; to: bigint; ids: bigint[] }[] = [];
  for (const e of sorted) {
    const last = windows[windows.length - 1];
    if (last && e.blockNumber - last.from <= LOG_RANGE && last.ids.length < 100) {
      last.to = e.blockNumber;
      last.ids.push(e.id);
    } else {
      windows.push({ from: e.blockNumber, to: e.blockNumber, ids: [e.id] });
    }
  }
  for (let i = 0; i < windows.length; i += 4) {
    await Promise.all(
      windows.slice(i, i + 4).map(async (w) => {
        const logs = await client.getContractEvents({
          address: ADDR.ledger,
          abi: ledgerAbi,
          eventName: "Recorded",
          args: { id: w.ids },
          fromBlock: w.from < START_BLOCK ? START_BLOCK : w.from,
          toBlock: w.to,
        });
        for (const l of logs) {
          const id = (l.args as { id?: bigint }).id;
          if (id !== undefined && l.transactionHash) map[id.toString()] = l.transactionHash;
        }
      }),
    );
  }
  return map;
}

function cell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function entriesToCsv(entries: LedgerEntry[], hashes: Record<string, Hash>): string {
  const header = [
    "id",
    "time_utc",
    "type",
    "strategy",
    "amount",
    "unit",
    "fee_musd",
    "shares",
    "account",
    "block",
    "tx_hash",
    "explorer_url",
  ];
  const rows = entries.map((e) => {
    const hash = hashes[e.id.toString()] ?? "";
    return [
      e.id.toString(),
      new Date(e.timestamp * 1000).toISOString(),
      LEDGER_KIND[e.kind]?.label ?? `Kind ${e.kind}`,
      vaultName(e.vault),
      formatUnits(e.assets, 18),
      e.kind === 3 ? "BTC" : "MUSD",
      formatUnits(e.fee, 18),
      formatUnits(e.shares, 18),
      e.user,
      e.blockNumber.toString(),
      hash,
      hash ? txUrl(hash) : "",
    ]
      .map(cell)
      .join(",");
  });
  return [header.join(","), ...rows].join("\n");
}

export function downloadCsv(name: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const FILTERABLE_VAULTS = [ADDR.flex, ADDR.term, ADDR.sp, ADDR.allocator, ADDR.faucet] as const;
