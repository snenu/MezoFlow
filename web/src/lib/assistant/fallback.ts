import type { Address } from "viem";
import { getPortfolio, getRecentActivity, getStabilityPoolHealth, getStrategies } from "./chain-data";
import { STRATEGY_COPY } from "@/lib/strategy-copy";
import { KIND } from "@/lib/contracts";

/**
 * Flow's built-in guide. Used when the AI Gateway is unavailable (no credits, no
 * credentials): it recognises the common questions and answers them from the same live
 * chain reads the model would use, so every number is still real.
 */
export type ToolTrace = { name: string; input: unknown; output: unknown };
type Strategies = Awaited<ReturnType<typeof getStrategies>>;

const fmt = (n: number, dp = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

type Intent =
  | "portfolio"
  | "apy"
  | "stability"
  | "term"
  | "flexible"
  | "risk"
  | "withdraw"
  | "fees"
  | "getMusd"
  | "allocator"
  | "activity"
  | "options";

function classify(q: string): Intent {
  const s = q.toLowerCase();
  if (/\b(apy|apr)\b|what is (an? )?(interest|yield)|compound/.test(s)) return "apy";
  if (/why did|portfolio|my (money|musd|position|balance|value)|how much (do i|have i)|am i (up|down)|profit|earned|my (gain|loss)/.test(s)) return "portfolio";
  if (/withdraw|take (it|my).*out|exit|redeem|get my .* back/.test(s)) return "withdraw";
  if (/\bfees?\b|cost|penalt/.test(s)) return "fees";
  if (/faucet|get (some )?musd|where .*musd|borrow|mint|buy musd|no musd/.test(s)) return "getMusd";
  if (/allocat|conservative|balanced|growth|split|rebalanc/.test(s)) return "allocator";
  if (/activity|history|transactions?|recent/.test(s)) return "activity";
  if (/stability|liquidat|\bsp\b|btc gain|trove/.test(s)) return /risk|lose|safe/.test(s) ? "stability" : "stability";
  if (/term|lock/.test(s)) return "term";
  if (/flexible|savings/.test(s)) return "flexible";
  if (/risk|safe|lose|audit|danger|scam/.test(s)) return "risk";
  return "options";
}

function strategyBlock(s: Strategies[number]) {
  return `**[${s.name}](${s.link})** — ${s.returnModel}. ${s.withdrawals} Risk ${s.riskScore}.`;
}

export async function answerOffline(question: string, user?: Address): Promise<{ text: string; tools: ToolTrace[] }> {
  const tools: ToolTrace[] = [];
  const call = async <T,>(name: string, input: unknown, fn: () => Promise<T>): Promise<T> => {
    const output = await fn();
    tools.push({ name, input, output });
    return output;
  };
  const intent = classify(question);
  const strategies = await call("getStrategies", {}, () => getStrategies(user));
  const byKind = (k: number) => strategies.find((s) => s.type === ({ 1: "flexible savings vault", 2: "fixed-term savings vault", 3: "Mezo Stability Pool strategy" } as Record<number, string>)[k]);
  const flex = byKind(KIND.FLEXIBLE);
  const term = byKind(KIND.TERM);
  const sp = byKind(KIND.STABILITY_POOL);
  const lines: string[] = [];

  switch (intent) {
    case "portfolio": {
      if (!user) {
        lines.push("Connect a wallet and I can read your positions straight from Mezo Testnet.");
        break;
      }
      const p = await call("getPortfolio", {}, () => getPortfolio(user));
      lines.push(
        `You have **${fmt(p.totalInStrategiesMusd)} MUSD** in MezoFlow strategies and **${fmt(p.walletMusd)} MUSD** in your wallet.`,
      );
      if (p.positions.length) {
        lines.push("", ...p.positions.map((x) => `- [${x.strategy}](${x.link}): ${fmt(x.valueMusd, 4)} MUSD${"btcWaitingToClaim" in x && x.btcWaitingToClaim ? `, plus ${x.btcWaitingToClaim} BTC to claim` : ""}${"locked" in x && x.locked ? `, unlocks in ${x.hoursUntilUnlock} hours` : ""}`));
      }
      const pl = p.lifetime.profitOrLossMusd;
      lines.push(
        "",
        `Lifetime: deposited ${fmt(p.lifetime.depositedMusd)} MUSD, withdrawn ${fmt(p.lifetime.withdrawnMusd)} MUSD, fees and penalties ${fmt(p.lifetime.feesPaidMusd, 4)} MUSD. That is **${pl >= 0 ? "+" : "−"}${fmt(Math.abs(pl), 4)} MUSD** overall.`,
        "",
        "Why it moves: savings vaults grow a little every time the reward reserve pays out, so share prices tick up. The Stability Pool can dip in MUSD when a liquidation swaps pool MUSD for BTC — that BTC is paid to you separately. Exit fees and early-exit penalties also show up as small losses.",
      );
      break;
    }
    case "apy": {
      lines.push(
        "**APR** is the simple yearly rate. **APY** is what you get if the interest is added to your balance and earns interest too (compounding). MezoFlow's savings vaults accrue on-chain as people use them, so their APY sits a little above the APR.",
        "",
        "Right now:",
        ...[flex, term].filter(Boolean).map((s) => `- [${s!.name}](${s!.link}): ${s!.returnModel}.`),
        sp ? `- [${sp.name}](${sp.link}): no fixed rate. It earns BTC when troves are liquidated.` : "",
        "",
        "These rates come from on-chain reserves and can change. Nothing here is guaranteed.",
      );
      break;
    }
    case "stability": {
      const h = await call("getStabilityPoolHealth", {}, () => getStabilityPoolHealth());
      lines.push(
        "Mezo's **Stability Pool** pays off the debt of borrowers (troves) whose collateral drops below 110%. In return, depositors receive those troves' BTC — usually worth about 10% more than the MUSD used.",
        "",
        `MezoFlow's vault keeps ${h.bufferTargetPercent}% of deposits idle for instant exits and puts the rest into the pool. It currently holds ${fmt(h.mezoFlowVaultInPoolMusd)} MUSD inside a ${fmt(h.stabilityPoolTotalMusd, 0)} MUSD pool.`,
        "",
        `Live now: BTC is $${fmt(h.btcPriceUsd, 0)} on Mezo's oracle, the weakest trove is at ${h.weakestTroveCollateralRatioPercent ?? "—"}% collateral, and withdrawals are **${h.withdrawalsOpen ? "open" : "paused"}**.`,
        "",
        "Risks: your MUSD balance can shrink during liquidations while BTC arrives; if BTC falls before you sell, you can end up behind. Withdrawals beyond the buffer pause while any trove is under 110%.",
        "",
        `See [the strategy](/app/strategies/stability-pool) or the [risk dashboard](/app/risk).`,
      );
      break;
    }
    case "term": {
      const c = STRATEGY_COPY[KIND.TERM];
      lines.push(
        term ? strategyBlock(term) : "",
        "",
        ...c.howItWorks.map((x) => `- ${x}`),
        "",
        "**Risks**",
        ...c.risks.map((r) => `- **${r.name}** (${r.level} of 5): ${r.plain}`),
        term && term.reserveRunwayDays !== null ? `\nThe reward reserve covers about ${term.reserveRunwayDays} days at today's deposits.` : "",
      );
      break;
    }
    case "flexible": {
      const c = STRATEGY_COPY[KIND.FLEXIBLE];
      lines.push(
        flex ? strategyBlock(flex) : "",
        "",
        ...c.howItWorks.map((x) => `- ${x}`),
        "",
        `Good for: ${c.goodFor}`,
        flex && flex.reserveRunwayDays !== null ? `\nIts reward reserve holds ${fmt(flex.rewardReserveMusd)} MUSD, about ${flex.reserveRunwayDays} days at today's deposits.` : "",
      );
      break;
    }
    case "risk": {
      lines.push("Every strategy has a different main risk:", "");
      for (const s of strategies) {
        const top = s.riskFactors?.slice().sort((a, b) => Number(b.level[0]) - Number(a.level[0]))[0];
        lines.push(`- **[${s.name}](${s.link})**, risk ${s.riskScore}: ${top ? top.explanation : s.summary}`);
      }
      lines.push("", "All MezoFlow contracts are new, tested and reviewed internally but **not audited by a third party**, and run on Mezo Testnet with test funds. The [risk dashboard](/app/risk) has live pool health and a loss calculator.");
      break;
    }
    case "withdraw": {
      const h = await call("getStabilityPoolHealth", {}, () => getStabilityPoolHealth());
      lines.push(
        ...strategies.map((s) => `- **[${s.name}](${s.link})**: ${s.withdrawals}`),
        "",
        `Right now Stability Pool withdrawals are **${h.withdrawalsOpen ? "open" : "paused"}**${h.withdrawalsOpen ? "" : `; only the ${fmt(h.mezoFlowIdleBufferMusd)} MUSD idle buffer can leave until the weak trove is fixed`}.`,
        "",
        "To withdraw, open the strategy, choose Withdraw, and use Max to take everything available.",
      );
      break;
    }
    case "fees": {
      lines.push(
        ...strategies.map((s) => `- **${s.name}**: ${s.exitFeePercent > 0 ? `${s.exitFeePercent}% exit fee, sent to the MezoFlow treasury` : "no exit fee"}${s.type.includes("term") ? "; leaving before your unlock date costs 1.5%, paid back into the reward reserve" : ""}.`),
        "",
        "Deposits are free apart from Mezo network gas, which costs a tiny amount of testnet BTC. Fees you pay are recorded on-chain and shown on your [overview](/app).",
      );
      break;
    }
    case "getMusd": {
      lines.push(
        "Three ways to get MUSD on Mezo Testnet:",
        "",
        "- **Swap BTC or MEZO:** on [Get MUSD](/app/swap), swap through Mezo Pools into your wallet, or straight into a strategy, in one transaction.",
        "- **MezoFlow faucet:** a little test MUSD per address per day. Use *Get test MUSD* in the sidebar.",
        "- **Borrow on Mezo:** lock testnet BTC as collateral and mint MUSD in the Mezo app.",
        "",
        "Testnet BTC and MEZO come from [faucet.test.mezo.org](https://faucet.test.mezo.org).",
      );
      break;
    }
    case "allocator": {
      lines.push(
        "The [auto allocator](/app/allocate) splits one deposit across strategies in a single transaction. Its plans are stored on-chain:",
        "",
        "- **Conservative**: 60% Flexible Savings, 30% Term Savings, 10% stays in your wallet.",
        "- **Balanced**: 50% Flexible Savings, 30% Stability Pool, 20% stays in your wallet.",
        "- **Growth**: 10% Flexible, 30% Term, 60% Stability Pool.",
        "",
        "You can also set a custom split, and move existing positions to a new plan. You see the amounts, expected earnings and blended risk before signing.",
      );
      break;
    }
    case "activity": {
      const a = await call("getRecentActivity", { scope: user ? "mine" : "everyone", limit: 6 }, () => getRecentActivity(user, 6));
      if (!a.entries.length) lines.push("No activity yet.");
      else
        lines.push(
          `Latest from ${a.scope}:`,
          "",
          ...a.entries.map((e) => `- ${e.type}: ${e.amount}${e.strategy && e.type !== "Faucet" ? ` (${e.strategy})` : ""}, ${new Date(e.at).toUTCString().slice(5, 22)} UTC`),
          "",
          "Full history with transaction links is on the [activity page](/app/activity).",
        );
      break;
    }
    default: {
      lines.push(
        "With MUSD in MezoFlow you can:",
        "",
        ...strategies.map((s) => `- ${strategyBlock(s)}`),
        "",
        "Not sure? The [auto allocator](/app/allocate) splits a deposit for you, and the [risk dashboard](/app/risk) explains what can go wrong. I can't give financial advice or move funds, but ask me about any of these.",
      );
    }
  }

  lines.push("", "Answered by Flow's built-in guide from live Mezo Testnet data.");
  return { text: lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim(), tools };
}
