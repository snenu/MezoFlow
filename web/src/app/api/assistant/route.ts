import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { z } from "zod";
import type { Address } from "viem";
import { getPortfolio, getRecentActivity, getStabilityPoolHealth, getStrategies } from "@/lib/assistant/chain-data";
import { buildInstructions } from "@/lib/assistant/instructions";
import { answerOffline } from "@/lib/assistant/fallback";

const MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-sonnet-5.5";
const MAX_HISTORY = 20;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

function hasGatewayCredentials() {
  // On Vercel the gateway authenticates with the deployment's OIDC token automatically.
  return Boolean(process.env.VERCEL || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

// Cached result of a tiny probe, so a missing card / empty credit balance switches Flow to
// its built-in guide without paying for a failed model call on every message.
let gateway: { ok: boolean; checkedAt: number } | null = null;
const PROBE_TTL = 5 * 60_000;

async function gatewayAvailable(): Promise<boolean> {
  if (!hasGatewayCredentials()) return false;
  if (gateway && Date.now() - gateway.checkedAt < PROBE_TTL) return gateway.ok;
  try {
    await generateText({ model: "anthropic/claude-haiku-5.5", prompt: "ok", maxOutputTokens: 1 });
    gateway = { ok: true, checkedAt: Date.now() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Only treat account-level problems as "unavailable"; transient errors retry next time.
    const hard = /credit card|customer_verification|credit|budget|insufficient|payment|402|auth|oidc|unauthori[sz]ed|forbidden|401|403/i.test(msg);
    gateway = { ok: !hard, checkedAt: hard ? Date.now() : 0 };
  }
  return gateway.ok;
}

function lastUserText(history: UIMessage[]): string {
  const last = [...history].reverse().find((m) => m.role === "user");
  if (!last) return "";
  return last.parts
    .map((p) => (p.type === "text" ? (p as { text: string }).text : ""))
    .join(" ")
    .slice(0, 500);
}

/** Stream Flow's built-in, chain-grounded answer in the same UI message format. */
function offlineResponse(question: string, user: Address | undefined) {
  const stream = createUIMessageStream({
    async execute({ writer }) {
      writer.write({ type: "start" });
      const { text, tools } = await answerOffline(question, user);
      tools.forEach((t, i) => {
        const toolCallId = `guide-${i}`;
        writer.write({ type: "tool-input-available", toolCallId, toolName: t.name, input: t.input });
        writer.write({ type: "tool-output-available", toolCallId, output: t.output });
      });
      const id = "guide-text";
      writer.write({ type: "text-start", id });
      for (const piece of text.match(/\S+\s*/g) ?? [text]) {
        writer.write({ type: "text-delta", id, delta: piece });
        await new Promise((r) => setTimeout(r, 8));
      }
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onError: () => "Flow couldn't read Mezo Testnet just now. Try again in a moment.",
  });
  return createUIMessageStreamResponse({ stream });
}

function isUIMessage(m: unknown): m is UIMessage {
  if (!m || typeof m !== "object") return false;
  const x = m as { role?: unknown; parts?: unknown };
  return (x.role === "user" || x.role === "assistant" || x.role === "system") && Array.isArray(x.parts);
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Request body must be JSON.");
  }
  if (!body || typeof body !== "object") return jsonError(400, "Request body must be an object.");
  const { messages, address } = body as { messages?: unknown; address?: unknown };

  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isUIMessage)) {
    return jsonError(400, "`messages` must be a non-empty array of chat messages.");
  }
  if (address !== undefined && address !== null && (typeof address !== "string" || !ADDRESS_RE.test(address))) {
    return jsonError(400, "`address` must be a 0x-prefixed 20-byte hex address.");
  }
  const user = (typeof address === "string" ? address : undefined) as Address | undefined;

  const history = (messages as UIMessage[]).filter((m) => m.role !== "system").slice(-MAX_HISTORY);

  if (!(await gatewayAvailable())) {
    return offlineResponse(lastUserText(history), user);
  }

  const safe = async <T,>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      return { error: `Could not read Mezo Testnet right now: ${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}` };
    }
  };

  const result = streamText({
    model: MODEL,
    instructions: buildInstructions(user),
    messages: await convertToModelMessages(history),
    stopWhen: isStepCount(5),
    tools: {
      getStrategies: tool({
        description:
          "List every MezoFlow strategy with live on-chain numbers: return model and rate, total deposited, depositors, exit fee, withdrawal rules, reserve runway, risk score and plain-language risk factors.",
        inputSchema: z.object({}),
        execute: async () => safe(() => getStrategies(user)),
      }),
      getPortfolio: tool({
        description:
          "Read the connected user's wallet balances, positions in each strategy, BTC waiting to be claimed, unlock dates and lifetime deposits, withdrawals, fees and profit or loss.",
        inputSchema: z.object({}),
        execute: async () =>
          user
            ? safe(() => getPortfolio(user))
            : { error: "No wallet is connected. Ask the user to connect a wallet to see their portfolio." },
      }),
      getStabilityPoolHealth: tool({
        description:
          "Live health of Mezo's MUSD Stability Pool: BTC price from Mezo's oracle, weakest trove collateral ratio, whether withdrawals are open, pool size, the MezoFlow vault's deposit and idle buffer, and BTC gains distributed.",
        inputSchema: z.object({}),
        execute: async () => safe(() => getStabilityPoolHealth()),
      }),
      getRecentActivity: tool({
        description: "Recent entries from MezoFlow's on-chain activity ledger, either the connected user's or everyone's.",
        inputSchema: z.object({
          scope: z.enum(["mine", "everyone"]).describe("Whose activity to read."),
          limit: z.number().int().min(1).max(25).default(10),
        }),
        execute: async ({ scope, limit }) => {
          if (scope === "mine" && !user) return { error: "No wallet is connected." };
          return safe(() => getRecentActivity(scope === "mine" ? user : undefined, limit));
        },
      }),
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
        if (/auth|api key|oidc|credential|unauthori[sz]ed|forbidden|401|403/i.test(msg)) {
          return "Flow can't reach its model right now. Everything else in MezoFlow still works.";
        }
        if (/credit|quota|budget|insufficient|payment|402/i.test(msg)) {
          return "Flow's model budget is used up for now. Everything else in MezoFlow still works.";
        }
        if (/rate.?limit|429|too many/i.test(msg)) {
          return "Flow is getting a lot of questions right now. Try again in a moment.";
        }
        return "Flow ran into a problem answering that. Try asking again.";
      },
    }),
  });
}
