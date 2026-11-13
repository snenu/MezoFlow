"use client";

import { useCallback, useState } from "react";
import { useAccount, useConfig, useSwitchChain } from "wagmi";
import { getPublicClient, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError, parseSignature, UserRejectedRequestError, type Abi, type Address, type TransactionReceipt } from "viem";
import { mezoTestnet } from "@/lib/chain";
import { explainError, withErrors } from "@/lib/errors";
import { knownPermitName, nonceAbi, PERMIT_TYPES, type PermitSig } from "@/lib/permit";
import { useToast } from "@/components/toast";

export type TxRequest = {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

export type PermitSpec = { token: Address; spender: Address; value: bigint; label: string };

export type TxStep = {
  /** Shown in the pending toast, e.g. "Depositing 100 MUSD". */
  title: string;
  /** Shown in the success toast, e.g. "Deposited 100 MUSD". */
  done: string;
  /** A plain call. */
  request?: TxRequest;
  /** One-transaction path: sign an EIP-2612 permit, then send `withPermit(sig)`. */
  permit?: PermitSpec;
  withPermit?: (sig: PermitSig) => TxRequest;
  /** Used instead when the wallet can't sign typed data (e.g. approve + plain call). */
  fallback?: TxStep[];
  gasFloor?: bigint;
};

/**
 * Mezo's eth_estimateGas can come in too low for calls that reach into other contracts
 * (vault -> Stability Pool, zap -> Pools router -> vault). Every action gets a floor; at
 * ~150 wei gas price the padding costs nothing.
 */
const GAS_FLOORS: Record<string, bigint> = {
  approve: 90_000n,
  claim: 260_000n,
  setPreferences: 160_000n,
  deposit: 900_000n,
  depositWithPermit: 950_000n,
  fundReserveWithPermit: 400_000n,
  withdraw: 1_000_000n,
  redeem: 1_000_000n,
  claimBtc: 600_000n,
  allocate: 1_800_000n,
  allocatePreset: 1_800_000n,
  allocateWithPermit: 1_900_000n,
  allocatePresetWithPermit: 1_900_000n,
  reallocate: 2_400_000n,
  reallocateWithPermit: 2_500_000n,
  swap: 900_000n,
  swapWithPermit: 950_000n,
  swapAndDeposit: 1_600_000n,
  swapAndDepositWithPermit: 1_700_000n,
  swapAndAllocate: 2_400_000n,
  swapAndAllocateWithPermit: 2_500_000n,
  poke: 300_000n,
  rebalance: 1_000_000n,
  skim: 250_000n,
};

function isRejection(e: unknown) {
  return e instanceof BaseError && !!e.walk((x) => x instanceof UserRejectedRequestError);
}

/**
 * Sends one or more steps in order with:
 *  - EIP-2612 permits: sign first, then a single transaction (no separate approve),
 *  - a pre-flight gas estimate that surfaces revert reasons before the wallet opens,
 *  - per-action gas floors,
 *  - toasts with explorer links, and a full data refresh after confirmation.
 */
export function useTx() {
  const config = useConfig();
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const signPermit = useCallback(
    async (p: PermitSpec, owner: Address): Promise<PermitSig> => {
      const client = getPublicClient(config, { chainId: mezoTestnet.id });
      const [nonce, name] = await Promise.all([
        client.readContract({ address: p.token, abi: nonceAbi, functionName: "nonces", args: [owner] }),
        knownPermitName(p.token) ?? client.readContract({ address: p.token, abi: nonceAbi, functionName: "name" }),
      ]);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
      const signature = await signTypedData(config, {
        account: owner,
        domain: { name, version: "1", chainId: mezoTestnet.id, verifyingContract: p.token },
        types: PERMIT_TYPES,
        primaryType: "Permit",
        message: { owner, spender: p.spender, value: p.value, nonce, deadline },
      });
      const { v, r, s, yParity } = parseSignature(signature);
      return { deadline, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };
    },
    [config],
  );

  const send = useCallback(
    async (step: TxStep, request: TxRequest): Promise<TransactionReceipt | null> => {
      const client = getPublicClient(config, { chainId: mezoTestnet.id });
      setBusy(step.title);
      const abi = withErrors(request.abi as Abi);
      const params = {
        address: request.address,
        abi,
        functionName: request.functionName,
        args: request.args ?? [],
        value: request.value,
        account: address!,
      } as const;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const estimate = await client.estimateContractGas(params as any);
      const floor = step.gasFloor ?? GAS_FLOORS[request.functionName] ?? 200_000n;
      const padded = (estimate * 3n) / 2n + 60_000n;
      const gas = padded > floor ? padded : floor;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hash = await writeContract(config, { ...(params as any), gas, chainId: mezoTestnet.id });
      const id = toast.push({ status: "pending", title: step.title, body: "Waiting for Mezo Testnet to confirm.", hash });
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: mezoTestnet.id });
      if (receipt.status !== "success") {
        toast.update(id, { status: "error", title: `${step.title} failed`, body: "The transaction reverted on-chain. Nothing was moved." });
        await qc.invalidateQueries();
        return null;
      }
      toast.update(id, { status: "success", title: step.done, body: undefined });
      await qc.invalidateQueries();
      return receipt;
    },
    [address, config, qc, toast],
  );

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
        const queue = [...steps];
        while (queue.length) {
          const step = queue.shift()!;
          let request = step.request;
          if (step.permit && step.withPermit) {
            setBusy(`Sign to allow ${step.permit.label}`);
            try {
              request = step.withPermit(await signPermit(step.permit, address));
            } catch (e) {
              if (isRejection(e) || !step.fallback) throw e;
              // Wallet can't sign EIP-712 data: fall back to approve + plain call.
              toast.push({ status: "pending", title: "Using approve instead", body: "Your wallet couldn't sign a permit, so this takes two transactions." });
              queue.unshift(...step.fallback);
              continue;
            }
          }
          if (!request) continue;
          const rc = await send(step, request);
          if (!rc) return null;
          receipts.push(rc);
        }
        return receipts;
      } catch (e) {
        toast.push({ status: "error", title: "Transaction not sent", body: explainError(e) });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [address, chainId, send, signPermit, switchChainAsync, toast],
  );

  return { run, busy };
}

/** Convenience: a permit step with an approve + plain-call fallback. */
export function permitStep(opts: {
  title: string;
  done: string;
  token: Address;
  tokenLabel: string;
  spender: Address;
  value: bigint;
  withPermit: (sig: PermitSig) => TxRequest;
  plain: TxRequest;
}): TxStep {
  const { title, done, token, tokenLabel, spender, value, withPermit, plain } = opts;
  return {
    title,
    done,
    permit: { token, spender, value, label: tokenLabel },
    withPermit,
    fallback: [
      {
        title: `Approving ${tokenLabel}`,
        done: `Approved ${tokenLabel}`,
        request: {
          address: token,
          abi: [
            {
              type: "function",
              name: "approve",
              stateMutability: "nonpayable",
              inputs: [
                { name: "spender", type: "address" },
                { name: "value", type: "uint256" },
              ],
              outputs: [{ type: "bool" }],
            },
          ],
          functionName: "approve",
          args: [spender, value],
        },
      },
      { title, done, request: plain },
    ],
  };
}
