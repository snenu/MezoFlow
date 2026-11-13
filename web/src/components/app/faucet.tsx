"use client";

import { useAccount } from "@/hooks/useAccount";
import { useMezoFlow } from "@/hooks/useMezoFlow";
import { useTx } from "@/hooks/useTx";
import { ADDR, faucetAbi } from "@/lib/contracts";
import { fmtAmount, fmtDuration } from "@/lib/format";
import { useWalletModal } from "@/components/wallet";
import { useNow } from "@/components/ui";

/** Claim real testnet MUSD from the MezoFlow faucet contract. */
export function FaucetButton({ className = "btn btn-ghost" }: { className?: string }) {
  const { isConnected } = useAccount();
  const { protocol, account } = useMezoFlow();
  const { run, busy } = useTx();
  const { open } = useWalletModal();
  const now = useNow(30_000);

  const amount = protocol?.faucetAmount ?? 25n * 10n ** 18n;
  const next = Number(account?.faucetNextClaimAt ?? 0n);
  const waiting = now > 0 && next * 1000 > now;
  const empty = protocol ? protocol.faucetBalance < amount : false;

  if (!isConnected) {
    return (
      <button className={className} onClick={open}>
        Get test MUSD
      </button>
    );
  }

  return (
    <button
      className={className}
      disabled={!!busy || waiting || empty}
      title={waiting ? `Next claim in ${fmtDuration(next - now / 1000)}` : empty ? "The faucet is empty" : undefined}
      onClick={() =>
        run([
          {
            title: `Claiming ${fmtAmount(amount)} test MUSD`,
            done: `Claimed ${fmtAmount(amount)} test MUSD`,
            request: { address: ADDR.faucet, abi: faucetAbi, functionName: "claim" },
          },
        ])
      }
    >
      {busy ? <span className="spinner" /> : null}
      {waiting ? `Next claim in ${fmtDuration(next - now / 1000)}` : empty ? "Faucet empty" : `Get ${fmtAmount(amount, { max: 0 })} test MUSD`}
    </button>
  );
}
