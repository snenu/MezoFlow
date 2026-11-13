import { connection } from "next/server";
import { createPublicClient, http } from "viem";
import { mezoTestnet, RPC_URL } from "@/lib/chain";
import { ADDR, lensAbi } from "@/lib/contracts";

/**
 * Liveness + dependency check: the app is up, Mezo Testnet answers, and the deployed
 * MezoFlow contracts respond through the Lens. 200 when healthy, 503 otherwise.
 */
export async function GET() {
  await connection(); // always run at request time
  const started = Date.now();
  const client = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL, { timeout: 6_000, retryCount: 1 }) });
  const checks: Record<string, unknown> = {};
  let ok = true;
  try {
    const [chainId, block] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
    checks.rpc = { ok: chainId === mezoTestnet.id, chainId, block: Number(block) };
    if (chainId !== mezoTestnet.id) ok = false;
  } catch (e) {
    ok = false;
    checks.rpc = { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  try {
    const p = await client.readContract({ address: ADDR.lens, abi: lensAbi, functionName: "getProtocol" });
    checks.contracts = {
      ok: p.strategyCount > 0n,
      strategies: Number(p.strategyCount),
      tvlMusd: Number(p.tvl / 10n ** 16n) / 100,
      users: Number(p.uniqueUsers),
      ledgerEntries: Number(p.entryCount),
      swaps: Number(p.swapCount),
    };
    if (p.strategyCount === 0n) ok = false;
  } catch (e) {
    ok = false;
    checks.contracts = { ok: false, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      service: "mezoflow-web",
      network: "Mezo Testnet (31611)",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      lens: ADDR.lens,
      checks,
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
