import { Suspense } from "react";
import { createPublicClient, http } from "viem";
import { mezoTestnet, RPC_URL } from "@/lib/chain";
import { ADDR, registryAbi } from "@/lib/contracts";

const KNOWN = ["flexible-savings", "term-savings", "stability-pool"];

/** Pre-render a page for every strategy in the on-chain registry. New strategies added
 * later still render on demand. */
export async function generateStaticParams() {
  try {
    const client = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL, { timeout: 8_000 }) });
    const list = await client.readContract({ address: ADDR.registry, abi: registryAbi, functionName: "getStrategies" });
    const slugs = list.map((s) => s.slug).filter(Boolean);
    return (slugs.length ? slugs : KNOWN).map((slug) => ({ slug }));
  } catch {
    return KNOWN.map((slug) => ({ slug }));
  }
}

export default function StrategyLayout({ children }: LayoutProps<"/app/strategies/[slug]">) {
  return (
    <Suspense
      fallback={
        <div className="grid gap-4" aria-busy="true">
          <span className="skeleton h-8 w-1/3" />
          <span className="skeleton h-4 w-2/3" />
          <span className="skeleton h-72 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
