import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Deliberately small markdown renderer for Flow's answers: paragraphs, line breaks,
 * bullet and numbered lists, **bold**, *italic*, `code` and [links](...). It builds React
 * nodes directly (no innerHTML), so model output can never inject markup. Links to /app
 * paths become client-side Next links; http(s) links open in a new tab; anything else is
 * rendered as plain text.
 */

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*[^*\s][^*]*\*)/g;

function renderLink(label: string, href: string, key: string): ReactNode {
  if (href.startsWith("/app") || href === "/") {
    return (
      <Link key={key} href={href} className="link">
        {label}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(href)) {
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer noopener" className="link">
        {label}
      </a>
    );
  }
  return <span key={key}>{label}</span>;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-foam">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      out.push(lm ? renderLink(lm[1], lm[2], key) : tok);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-trench px-1.5 py-0.5 text-[0.9em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { type: "p"; lines: string[] } | { type: "ul" | "ol"; items: string[] };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  let cur: Block | null = null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
    } else if (bullet) {
      if (cur?.type !== "ul") {
        flush();
        cur = { type: "ul", items: [] };
      }
      (cur as { items: string[] }).items.push(bullet[1]);
    } else if (numbered) {
      if (cur?.type !== "ol") {
        flush();
        cur = { type: "ol", items: [] };
      }
      (cur as { items: string[] }).items.push(numbered[1]);
    } else {
      // Strip heading markers if the model uses them anyway.
      const text = line.replace(/^#{1,6}\s+/, "");
      if (cur?.type !== "p") {
        flush();
        cur = { type: "p", lines: [] };
      }
      (cur as { lines: string[] }).lines.push(text);
    }
  }
  flush();
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="grid gap-3 leading-relaxed">
      {blocks.map((b, bi) => {
        if (b.type === "p") {
          return (
            <p key={bi}>
              {b.lines.map((l, li) => (
                <span key={li}>
                  {li > 0 && <br />}
                  {inline(l, `${bi}-${li}`)}
                </span>
              ))}
            </p>
          );
        }
        const Tag = b.type;
        return (
          <Tag key={bi} className={`grid gap-1.5 pl-5 ${b.type === "ul" ? "list-disc" : "list-decimal"} marker:text-silt`}>
            {b.items.map((it, ii) => (
              <li key={ii}>{inline(it, `${bi}-${ii}`)}</li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}
