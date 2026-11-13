import { createPublicClient, formatUnits, http, zeroAddress, type Address } from "viem";
import { mezoTestnet, RPC_URL, txUrl } from "@/lib/chain";
import { ADDR, KIND, LEDGER_KIND, RISK_LABEL, lensAbi, ledgerAbi, spVaultAbi, vaultName } from "@/lib/contracts";
import { STRATEGY_COPY } from "@/lib/strategy-copy";
import { aprToApy } from "@/lib/format";

/**
 * Read-only views of MezoFlow on Mezo Testnet for the Ask Flow assistant.
 * Every bigint is converted to a plain decimal number or string so it can be serialised.
 */
const client = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL, { retryCount: 2 }) });

const n = (v: bigint, decimals = 18) => Number(formatUnits(v, decimals));
const round = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;
const KIND_NAME: Record<number, string> = {
  [KIND.FLEXIBLE]: "flexible savings vault",
  [KIND.TERM]: "fixed-term savings vault",
  [KIND.STABILITY_POOL]: "Mezo Stability Pool strategy",
};
const MAX_SECONDS = 1e12; // type(uint256).max means no rate, hence no runway limit

function runwayDays(seconds: bigint): number | "unlimited" {
  const s = Number(seconds);
  return !Number.isFinite(s) || s > MAX_SECONDS ? "unlimited" : round(s / 86400, 1);
}

export async function getStrategies(user?: Address) {
  const views = await client.readContract({
    address: ADDR.lens,
    abi: lensAbi,
    functionName: "getStrategies",
    args: [user ?? zeroAddress],
  });
  return views.map((v) => {
    const kind = Number(v.meta.kind);
    const copy = STRATEGY_COPY[kind];
    const rateBps = Number(v.stats.rateBps);
    return {
      id: Number(v.id),
      name: v.meta.name,
      link: `/app/strategies/${v.meta.slug}`,
      type: KIND_NAME[kind] ?? "vault",
      protocol: v.meta.protocol,
      active: v.meta.active,
      summary: v.meta.summary,
      returnModel:
        kind === KIND.STABILITY_POOL
          ? "Variable. Paid in BTC from liquidations, not a fixed rate."
          : `${round(rateBps / 100, 2)}% APR (about ${round(aprToApy(rateBps), 2)}% APY if compounded daily), paid from an on-chain reward reserve`,
      yieldSource: copy?.yieldSource,
      reserveRunwayDays: kind === KIND.STABILITY_POOL ? null : runwayDays(v.stats.runwaySeconds),
      rewardReserveMusd: round(n(v.stats.rewardReserve), 2),
      totalDepositedMusd: round(n(v.stats.totalAssets), 2),
      depositors: Number(v.stats.depositorCount),
      sharePriceMusd: round(n(v.stats.sharePrice), 6),
      minDepositMusd: round(n(v.stats.minDeposit), 2),
      exitFeePercent: round(Number(v.stats.exitFeeBps) / 100, 2),
      withdrawals: v.meta.liquidityTerms,
      instantlyWithdrawableMusd: round(n(v.stats.availableLiquidity), 2),
      depositsPaused: v.stats.paused,
      riskScore: `${v.meta.riskScore} of 5 (${RISK_LABEL[Number(v.meta.riskScore)]})`,
      riskFactors: copy?.risks.map((r) => ({ name: r.name, level: `${r.level} of 5`, explanation: r.plain })),
      lossScenario: copy?.lossScenario,
      goodFor: copy?.goodFor,
      vaultAddress: v.meta.vault,
    };
  });
}

export async function getPortfolio(user: Address) {
  const [protocol, strategies, account] = await client.readContract({
    address: ADDR.lens,
    abi: lensAbi,
    functionName: "getAll",
    args: [user],
  });
  void protocol;
  const now = Math.floor(Date.now() / 1000);
  const positions = strategies
    .filter((s) => s.user.shares > 0n || s.user.pendingBtc > 0n)
    .map((s) => {
      const kind = Number(s.meta.kind);
      const unlockAt = Number(s.user.unlockAt);
      return {
        strategy: s.meta.name,
        link: `/app/strategies/${s.meta.slug}`,
        valueMusd: round(n(s.user.assets), 4),
        shares: round(n(s.user.shares), 4),
        withdrawableNowMusd: round(n(s.user.maxWithdraw), 4),
        exitFeePercentIfWithdrawnNow: round(Number(s.user.exitFeeBps) / 100, 2),
        ...(kind === KIND.TERM && unlockAt > 0
          ? {
              unlocksAt: new Date(unlockAt * 1000).toISOString(),
              locked: unlockAt > now,
              hoursUntilUnlock: unlockAt > now ? round((unlockAt - now) / 3600, 1) : 0,
            }
          : {}),
        ...(kind === KIND.STABILITY_POOL
          ? { btcWaitingToClaim: round(n(s.user.pendingBtc), 8), btcAlreadyClaimed: round(n(s.user.claimedBtc), 8) }
          : {}),
      };
    });
  const value = strategies.reduce((sum, s) => sum + n(s.user.assets), 0);
  const deposited = n(account.deposited);
  const withdrawn = n(account.withdrawn);
  return {
    address: user,
    walletMusd: round(n(account.musdBalance), 4),
    walletBtc: round(n(account.btcBalance), 8),
    totalInStrategiesMusd: round(value, 4),
    positions,
    lifetime: {
      depositedMusd: round(deposited, 4),
      withdrawnMusd: round(withdrawn, 4),
      feesPaidMusd: round(n(account.fees), 4),
      actions: Number(account.actions),
      profitOrLossMusd: round(value + withdrawn - deposited, 4),
      note: "Profit or loss = current value + withdrawn − deposited. It includes fees and penalties, and excludes BTC gains, which are listed per position.",
    },
    firstActivity: Number(account.firstActivity) ? new Date(Number(account.firstActivity) * 1000).toISOString() : null,
  };
}

export async function getStabilityPoolHealth() {
  const [h, b] = await Promise.all([
    client.readContract({ address: ADDR.sp, abi: spVaultAbi, functionName: "spHealth" }),
    client.readContract({ address: ADDR.sp, abi: spVaultAbi, functionName: "btcStats" }),
  ]);
  const price = n(h.btcPrice);
  return {
    btcPriceUsd: round(price, 2),
    weakestTroveCollateralRatioPercent: h.lowestIcr > 0n ? round(n(h.lowestIcr) * 100, 2) : null,
    minimumCollateralRatioPercent: round(n(h.mcr) * 100, 2),
    systemCollateralRatioPercent: h.tcr > 0n ? round(n(h.tcr) * 100, 2) : null,
    withdrawalsOpen: h.withdrawalsOpen,
    withdrawalRule:
      "Mezo's Stability Pool blocks withdrawals while any trove is below the minimum collateral ratio. The MezoFlow vault keeps an idle buffer that can always be withdrawn.",
    stabilityPoolTotalMusd: round(n(h.poolTotalDeposits), 2),
    mezoFlowVaultInPoolMusd: round(n(h.vaultDeposit), 4),
    mezoFlowIdleBufferMusd: round(n(h.idle), 4),
    bufferTargetPercent: round(Number(h.bufferBps) / 100, 2),
    btcGains: {
      distributedToHoldersBtc: round(n(b.totalDistributed), 8),
      claimedBtc: round(n(b.totalClaimed), 8),
      unclaimedBtc: round(n(b.unclaimed), 8),
      pendingInPoolBtc: round(n(b.pendingFromPool), 8),
      distributedValueUsd: round(n(b.totalDistributed) * price, 2),
    },
  };
}

export async function getRecentActivity(user: Address | undefined, limit: number) {
  const lim = BigInt(Math.max(1, Math.min(limit, 25)));
  const [entries] = user
    ? await client.readContract({
        address: ADDR.ledger,
        abi: ledgerAbi,
        functionName: "getUserEntries",
        args: [user, 0n, lim],
      })
    : await client.readContract({ address: ADDR.ledger, abi: ledgerAbi, functionName: "getRecent", args: [0n, lim] });
  return {
    scope: user ? "your activity" : "everyone",
    entries: entries.map((e) => {
      const kind = Number(e.kind);
      return {
        type: LEDGER_KIND[kind]?.label ?? "Action",
        strategy: vaultName(e.vault),
        amount: kind === 3 ? `${round(n(e.assets), 8)} BTC` : `${round(n(e.assets), 4)} MUSD`,
        feeMusd: round(n(e.fee), 4),
        at: new Date(Number(e.timestamp) * 1000).toISOString(),
        block: Number(e.blockNumber),
        ...(user ? {} : { user: e.user }),
      };
    }),
    explorerNote: `Each action is a transaction on Mezo Testnet. Explorer link format: ${txUrl("<hash>")}. Full history with links is at /app/activity.`,
  };
}
