"use client";

import { useCallback, useState } from "react";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { getPublicClient, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import type { Abi, Address, TransactionReceipt } from "viem";
import { mezoTestnet } from "@/lib/chain";
import { explainError, withErrors } from "@/lib/errors";
import { useToast } from "@/components/toast";

export type TxRequest = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type TxStep = {
  /** Shown in the pending toast, e.g. "Depositing 100 MUSD". */
  title: string;
  /** Shown in the success toast, e.g. "Deposited 100 MUSD". */
  done: string;
  request: TxRequest;
};

/**
 * Sends one or more transactions in order with:
 *  - a pre-flight gas estimate that surfaces revert reasons before the wallet opens,
 *  - padded gas (Mezo's eth_estimateGas underestimates nested calls),
 *  - toasts with explorer links, and a full data refresh after confirmation.
 */
export function useTx() {
  const config = useConfig();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (steps: TxStep[]): Promise<TransactionReceipt[] | null> => {
      if (!address) {
        toast.push({ status: "error", title: "Connect a wallet first" });
        return null;
      }
      const receipts: TransactionReceipt[] = [];
      try {
        if (chainId !== mezoTestnet.id) {
          await switchChainAsync({ chainId: mezoTestnet.id });
        }
        const client = getPublicClient(config, { chainId: mezoTestnet.id });
        for (const step of steps) {
          setBusy(step.title);
          const abi = withErrors(step.request.abi as Abi);
          const params = {
            address: step.request.address,
            abi,
            functionName: step.request.functionName,
            args: step.request.args ?? [],
            value: step.request.value,
            account: address,
          } as const;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const estimate = await client.estimateContractGas(params as any);
          const gas = (estimate * 3n) / 2n + 60_000n;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hash = await writeContract(config, { ...(params as any), gas, chainId: mezoTestnet.id });
          const id = toast.push({ status: "pending", title: step.title, body: "Waiting for Mezo Testnet to confirm…", hash });
          const receipt = await waitForTransactionReceipt(config, { hash, chainId: mezoTestnet.id });
          if (receipt.status !== "success") {
            toast.update(id, { status: "error", title: `${step.title} failed`, body: "The transaction reverted on-chain." });
            await qc.invalidateQueries();
            return null;
          }
          toast.update(id, { status: "success", title: step.done, body: undefined });
          receipts.push(receipt);
          await qc.invalidateQueries();
        }
        return receipts;
      } catch (e) {
        toast.push({ status: "error", title: "Transaction not sent", body: explainError(e) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, config, qc, switchChainAsync, toast],
  );

  return { run, busy };
}
