"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { motion, useReducedMotion } from "motion/react";
import { useAccount } from "@/hooks/useAccount";
import { Mark } from "@/components/brand";
import { useWalletModal } from "@/components/wallet";
import { shortAddr } from "@/lib/format";
import { Markdown } from "./markdown";

const STARTERS = [
  "What can I do with my MUSD?",
  "Explain the Stability Pool strategy",
  "What are the risks of Term Savings?",
  "Why did my portfolio value change?",
  "What is APY?",
  "How does Mezo's Stability Pool work?",
];

const TOOL_LABEL: Record<string, string> = {
  getStrategies: "strategies",
  getPortfolio: "your portfolio",
  getStabilityPoolHealth: "Stability Pool health",
  getRecentActivity: "recent activity",
};

const FALLBACK_ERROR = "Flow can't reach its model right now. Everything else in MezoFlow still works.";

function friendlyError(err: Error | undefined): string {
  if (!err) return FALLBACK_ERROR;
  const msg = err.message ?? "";
  try {
    const parsed = JSON.parse(msg) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {}
  if (msg.startsWith("Flow ")) return msg;
  return FALLBACK_ERROR;
}

type AnyPart = { type: string; text?: string; state?: string; toolCallId?: string; errorText?: string };

function ToolChip({ part }: { part: AnyPart }) {
  const name = part.type.startsWith("tool-") ? part.type.slice(5) : "data";
  const label = TOOL_LABEL[name] ?? name;
  const done = part.state === "output-available";
  const failed = part.state === "output-error";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
        failed ? "border-coral/40 text-coral" : "border-shoal text-silt"
      }`}
    >
      {done ? (
        <span className="h-1.5 w-1.5 rounded-full bg-tide" aria-hidden />
      ) : failed ? (
        <span aria-hidden>!</span>
      ) : (
        <span className="spinner !h-3 !w-3" aria-hidden />
      )}
      {failed ? `Couldn't read ${label}` : done ? `Read ${label} from Mezo Testnet` : `Reading ${label} from Mezo Testnet`}
    </span>
  );
}

function Message({ m }: { m: UIMessage }) {
  const parts = m.parts as unknown as AnyPart[];
  if (m.role === "user") {
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-shoal px-4 py-2.5 leading-relaxed">{text}</p>
      </div>
    );
  }
  const tools = parts.filter((p) => p.type.startsWith("tool-") || p.type === "dynamic-tool");
  const texts = parts.filter((p) => p.type === "text" && p.text);
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex-none">
        <Mark size={26} />
      </div>
      <div className="min-w-0 flex-1">
        {tools.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {tools.map((p, i) => (
              <ToolChip key={p.toolCallId ?? i} part={p} />
            ))}
          </div>
        )}
        <div className="grid gap-3 text-mist">
          {texts.map((p, i) => (
            <Markdown key={i} text={p.text ?? ""} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AssistantChat() {
  const { address, isConnected } = useAccount();
  const { open } = useWalletModal();
  const reduce = useReducedMotion();
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/assistant" }), []);
  const { messages, sendMessage, status, stop, setMessages, error, clearError } = useChat({ transport });
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const busy = status === "submitted" || status === "streaming";

  // Keep the newest content in view unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages, status, reduce]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (error) clearError();
    stick.current = true;
    sendMessage({ text: q }, { body: { address: isConnected ? address : undefined } });
    setInput("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    ask(input);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(input);
    }
  }

  const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === "user";

  return (
    <div className="panel flex h-[calc(100svh-15rem)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b rule px-4 py-3 sm:px-5">
        <p className="text-sm text-silt">
          {isConnected && address ? (
            <>Flow can read the positions of {shortAddr(address)}.</>
          ) : (
            <>
              <button className="link" onClick={open}>
                Connect a wallet
              </button>{" "}
              so Flow can read your positions.
            </>
          )}
        </p>
        <button
          className="btn btn-ghost h-9 text-sm"
          onClick={() => {
            stop();
            setMessages([]);
            clearError();
          }}
          disabled={messages.length === 0 && !error}
        >
          Clear chat
        </button>
      </div>

      <div
        ref={scroller}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col justify-center">
            <Mark size={40} />
            <h2 className="mt-5 text-2xl font-bold tracking-tight">What would you like to know?</h2>
            <p className="mt-2 max-w-[54ch] text-silt leading-relaxed">
              Flow answers with live numbers from MezoFlow&apos;s contracts on Mezo Testnet. It explains and suggests, but it
              can never move your funds.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {STARTERS.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="rounded-xl border border-shoal bg-abyss/60 px-4 py-3 text-left text-[0.95rem] transition-colors hover:border-tide"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto grid max-w-3xl gap-7">
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Message m={m} />
              </motion.div>
            ))}
            {status === "submitted" && lastIsUser && (
              <div className="flex items-center gap-3 text-sm text-silt">
                <Mark size={26} />
                <span className="inline-flex items-center gap-2">
                  <span className="spinner" aria-hidden /> Thinking
                </span>
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-xl border border-coral/40 bg-coral/10 px-4 py-3 text-sm">
                <p className="text-coral">{friendlyError(error)}</p>
                <button
                  className="link mt-1"
                  onClick={() => {
                    const lastUser = [...messages].reverse().find((m) => m.role === "user");
                    const text = (lastUser?.parts as unknown as AnyPart[] | undefined)
                      ?.filter((p) => p.type === "text")
                      .map((p) => p.text)
                      .join("");
                    if (lastUser) setMessages(messages.filter((m) => m.id !== lastUser.id));
                    if (text) ask(text);
                  }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t rule p-3 sm:p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-shoal bg-trench px-3 py-2 focus-within:border-tide">
          <label htmlFor="ask-flow" className="sr-only">
            Ask Flow a question
          </label>
          <textarea
            id="ask-flow"
            ref={textarea}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Ask about strategies, risks or your portfolio"
            className="max-h-[180px] min-h-[2.5rem] flex-1 resize-none bg-transparent py-2 leading-relaxed outline-none placeholder:text-silt"
          />
          {busy ? (
            <button type="button" className="btn btn-ghost" onClick={() => stop()}>
              Stop
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
              Ask
            </button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-xs text-silt">
          Flow can be wrong. Check the numbers on the strategy pages before you act. This is not financial advice.
        </p>
      </form>
    </div>
  );
}
