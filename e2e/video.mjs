// Records a narrated product demo of the live site: a real wallet, real Mezo Testnet
// transactions, a visible cursor, human-paced typing and scrolling. Narration is a
// neural voice (edge-tts); ffmpeg lays it over the screen recording.
//
//   BASE=https://mezoflow.vercel.app node video.mjs        -> ../docs/demo/mezoflow-demo.mp4
//
// Wallet: KEY, or E2E_WALLET_5 from contracts/.env.wallets (gitignored, never printed).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachWallet } from "./wallet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "https://mezoflow.vercel.app").replace(/\/$/, "");
const RPC = process.env.RPC || "https://rpc.test.mezo.org";
const VOICE = process.env.VOICE || "en-US-AndrewNeural";
const W = 1440;
const H = 900;
const WORK = path.join(here, "out", "video");
const OUT = process.env.OUT || path.join(here, "..", "docs", "demo", "mezoflow-demo.mp4");
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

function walletKey() {
  if (process.env.KEY) return process.env.KEY;
  const m = fs.readFileSync(path.join(here, "..", "contracts", ".env.wallets"), "utf8").match(/^E2E_WALLET_5=(0x[0-9a-fA-F]{64})$/m);
  if (!m) throw new Error("no E2E_WALLET_5 in contracts/.env.wallets");
  return m[1];
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------
const scenes = [
  {
    id: "intro",
    say: "This is MezoFlow, a money manager for MUSD, the Bitcoin-backed dollar on Mezo. Every number on this page is read live from Mezo Testnet.",
    run: async (u) => {
      await u.go("/");
      await u.pause(1200);
      await u.hover(u.page.locator("#hero-title"));
    },
  },
  {
    id: "simulator",
    say: "Pick an amount and a plan, and the blue rate board shows exactly where your MUSD would go, at today's on-chain rates.",
    run: async (u) => {
      await u.type(u.page.locator("#sim-amount"), "2500", true);
      await u.click(u.page.getByRole("radio", { name: "Growth" }));
      await u.pause(1400);
      await u.click(u.page.getByRole("radio", { name: "Conservative" }));
      await u.pause(1200);
      await u.click(u.page.getByRole("radio", { name: "Balanced" }));
    },
  },
  {
    id: "landing",
    say: "Below that are the three strategies: flexible savings, a seven-day term vault, and Mezo's own Stability Pool. Each one shows its rate, how withdrawals work, and its risks in plain English.",
    run: async (u) => {
      await u.scrollTo("#strategies", 2600);
      await u.pause(900);
      await u.scroll(900, 2600);
    },
  },
  {
    id: "landing-2",
    say: "MezoFlow explains what can go wrong before you deposit, and every contract is public on the Mezo explorer.",
    run: async (u) => {
      await u.scroll(1500, 3000);
      await u.scrollTo("#contracts", 2600);
      await u.pause(800);
    },
  },
  {
    id: "connect",
    say: "Let's use it. I'll open the app and connect a wallet that holds a little testnet BTC from the Mezo faucet.",
    run: async (u) => {
      await u.go("/app/swap");
      await u.pause(800);
      await u.click(u.page.getByRole("button", { name: /connect wallet/i }).first());
      await u.pause(700);
      await u.click(u.page.getByText("MezoFlow E2E Wallet").first());
      await u.pause(1500);
    },
  },
  {
    id: "swap",
    say: "On Get MUSD, I swap BTC for MUSD through Mezo Pools. I sign a BTC permit instead of a separate approval, so it's a single transaction.",
    run: async (u) => {
      await u.type(u.page.locator("#swap-amount"), "0.0004");
      await u.pause(1800);
      await u.tx(() => u.click(u.page.getByRole("button", { name: "Swap BTC for MUSD" })), /Swapped/);
    },
  },
  {
    id: "swap-done",
    say: "Confirmed in a few seconds. Every confirmation links to the transaction on the Mezo explorer.",
    run: async (u) => {
      await u.hover(u.page.locator(".toast-success").first());
      await u.pause(1000);
    },
  },
  {
    id: "term",
    say: "Now I'll put five MUSD into Term Savings. It pays a higher rate for a seven-day lock. Again, one signature and one transaction.",
    run: async (u) => {
      await u.go("/app/strategies/term-savings");
      await u.pause(1500);
      await u.type(u.page.locator("#dep-amount"), "5");
      await u.pause(800);
      await u.tx(() => u.click(u.page.getByRole("button", { name: "Deposit", exact: true })), /Deposited/);
    },
  },
  {
    id: "allocate",
    say: "The auto allocator splits one deposit across strategies. I'll put twelve MUSD into the Balanced plan, review the split, and sign.",
    run: async (u) => {
      await u.go("/app/allocate");
      await u.pause(1200);
      await u.type(u.page.locator("#alloc-amount"), "12");
      await u.click(u.page.getByRole("radio", { name: /Balanced/ }).first());
      await u.pause(1500);
      await u.tx(() => u.click(u.page.getByRole("button", { name: "Allocate", exact: true })), /Allocated/);
    },
  },
  {
    id: "overview",
    say: "The overview shows the whole portfolio, rebuilt from the on-chain ledger: value over time, where every MUSD sits, and what each position earns.",
    run: async (u) => {
      await u.go("/app");
      await u.pause(2000);
      await u.scroll(700, 2500);
    },
  },
  {
    id: "withdraw",
    say: "Flexible savings can be withdrawn at any time, with no fee.",
    run: async (u) => {
      await u.go("/app/strategies/flexible-savings");
      await u.pause(1200);
      await u.click(u.page.getByRole("tab", { name: "Withdraw" }));
      await u.type(u.page.locator("#wd-amount"), "2");
      await u.pause(900);
      await u.tx(() => u.click(u.page.getByRole("button", { name: "Withdraw", exact: true })), /Withdrew/);
    },
  },
  {
    id: "risk",
    say: "The risk dashboard watches Mezo itself: the BTC oracle price, the weakest trove, and whether the Stability Pool is open for withdrawals.",
    run: async (u) => {
      await u.go("/app/risk");
      await u.pause(2000);
      await u.scroll(900, 3000);
    },
  },
  {
    id: "activity",
    say: "Every action is written to an activity ledger on-chain, so the history needs no database. You can export it as a spreadsheet.",
    run: async (u) => {
      await u.go("/app/activity");
      await u.pause(2500);
      await u.hover(u.page.getByRole("button", { name: "Export CSV" }));
    },
  },
  {
    id: "alerts",
    say: "Alert preferences are saved on-chain too, and alerts come from live chain data.",
    run: async (u) => {
      await u.go("/app/alerts");
      await u.pause(1500);
      await u.click(u.page.getByRole("switch").nth(1));
      await u.tx(() => u.click(u.page.getByRole("button", { name: "Save preferences" })), /saved/);
    },
  },
  {
    id: "assistant",
    say: "And Ask Flow answers questions from the same contracts. It can explain things, but it can never move your funds.",
    run: async (u) => {
      await u.go("/app/assistant");
      await u.pause(1200);
      await u.type(u.page.getByPlaceholder("Ask about strategies, risks or your portfolio"), "Can I withdraw from the Stability Pool right now?");
      await u.page.keyboard.press("Enter");
      await u.pause(6000);
    },
  },
  {
    id: "outro",
    say: "That's MezoFlow. One-transaction deposits with MUSD permits, BTC to MUSD through Mezo Pools, and every number read straight from the chain.",
    run: async (u) => {
      await u.go("/");
      await u.pause(2500);
    },
  },
];

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------
function duration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}
for (const s of scenes) {
  s.audio = path.join(WORK, `${s.id}.mp3`);
  if (!fs.existsSync(s.audio) || fs.statSync(s.audio).size === 0 || process.env.REVOICE) {
    // The neural voice service is occasionally flaky; retry, then fall back to Windows' voice.
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      try {
        execFileSync("python", ["-m", "edge_tts", "--voice", VOICE, "--text", s.say, "--write-media", s.audio], { stdio: "pipe" });
        ok = fs.statSync(s.audio).size > 0;
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (!ok) {
      const wav = s.audio.replace(/\.mp3$/, ".wav");
      const ps = `Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Zira Desktop'); $s.SetOutputToWaveFile('${wav}'); $s.Speak(@'
${s.say}
'@); $s.Dispose()`;
      execFileSync("powershell", ["-NoProfile", "-Command", ps]);
      execFileSync("ffmpeg", ["-y", "-i", wav, s.audio], { stdio: "pipe" });
    }
  }
  s.seconds = duration(s.audio);
}
console.log(`narration ${scenes.reduce((a, s) => a + s.seconds, 0).toFixed(1)}s over ${scenes.length} scenes`);

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: WORK, size: { width: W, height: H } } });
const page = await ctx.newPage();
const t0 = Date.now();
const w = await attachWallet(page, { key: walletKey(), rpc: RPC });

// A visible cursor, since headless recordings don't draw one.
await page.addInitScript(() => {
  const draw = () => {
    if (document.getElementById("demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 9-7 1.6L8.6 20z" fill="#000" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", transform: "translate(-3px,-2px)", transition: "transform 60ms linear" });
    document.documentElement.appendChild(c);
    const x = window.__demoX ?? 720;
    const y = window.__demoY ?? 450;
    c.style.left = x + "px";
    c.style.top = y + "px";
  };
  document.addEventListener("mousemove", (e) => {
    window.__demoX = e.clientX;
    window.__demoY = e.clientY;
    const c = document.getElementById("demo-cursor");
    if (c) {
      c.style.left = e.clientX + "px";
      c.style.top = e.clientY + "px";
    }
  });
  document.addEventListener("mousedown", () => {
    const c = document.getElementById("demo-cursor");
    if (c) c.style.transform = "translate(-3px,-2px) scale(0.85)";
  });
  document.addEventListener("mouseup", () => {
    const c = document.getElementById("demo-cursor");
    if (c) c.style.transform = "translate(-3px,-2px)";
  });
  if (document.readyState !== "loading") draw();
  else document.addEventListener("DOMContentLoaded", draw);
  new MutationObserver(draw).observe(document.documentElement, { childList: true });
});

let mx = W / 2;
let my = H / 2;
const u = {
  page,
  pause: (ms) => page.waitForTimeout(ms),
  async go(route) {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.mouse.move(mx, my);
  },
  async moveTo(x, y) {
    const steps = Math.max(12, Math.round(Math.hypot(x - mx, y - my) / 14));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease in-out
      await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e);
      await page.waitForTimeout(12);
    }
    mx = x;
    my = y;
  },
  async hover(loc) {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox();
    if (b) await u.moveTo(b.x + b.width / 2, b.y + Math.min(b.height / 2, 30));
  },
  async click(loc) {
    await loc.waitFor({ state: "visible", timeout: 30_000 });
    await u.hover(loc);
    await u.pause(250);
    await loc.click();
    await u.pause(350);
  },
  async type(loc, text, select = false) {
    await u.click(loc);
    if (select) await page.keyboard.press("Control+A");
    else await loc.fill("");
    await loc.pressSequentially(text, { delay: 110 });
  },
  async scroll(px, ms) {
    const steps = Math.max(10, Math.round(ms / 40));
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, px / steps);
      await page.waitForTimeout(ms / steps);
    }
  },
  async scrollTo(selector, ms) {
    const y = await page.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().top ?? 0, selector);
    await u.scroll(y - 80, ms);
  },
  async tx(click, done) {
    const before = w.sent.length;
    await click();
    const until = Date.now() + 150_000;
    while (w.sent.length === before && Date.now() < until) await u.pause(300);
    await page.locator(".toast-success", { hasText: done }).first().waitFor({ timeout: 150_000 });
  },
};

const timeline = [];
for (const s of scenes) {
  const start = (Date.now() - t0) / 1000;
  process.stdout.write(`scene ${s.id.padEnd(10)} @ ${start.toFixed(1)}s `);
  try {
    await s.run(u);
  } catch (e) {
    console.log(`(warning: ${e.message.split("\n")[0]})`);
  }
  const spent = (Date.now() - t0) / 1000 - start;
  const rest = s.seconds + 0.7 - spent;
  if (rest > 0) await u.pause(rest * 1000);
  timeline.push({ id: s.id, start, audio: s.audio });
  console.log(`(${((Date.now() - t0) / 1000 - start).toFixed(1)}s)`);
}
await u.pause(1200);
const videoPath = await page.video().path();
await ctx.close();
await browser.close();
console.log(`transactions sent: ${w.sent.length}`);
fs.writeFileSync(path.join(WORK, "timeline.json"), JSON.stringify({ base: BASE, txs: w.sent, timeline }, null, 2));

// ---------------------------------------------------------------------------
// Mix narration over the recording
// ---------------------------------------------------------------------------
const inputs = ["-i", videoPath];
const filters = [];
timeline.forEach((t, i) => {
  inputs.push("-i", t.audio);
  const ms = Math.round(t.start * 1000) + 250;
  filters.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
});
filters.push(`${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0[voice]`);
execFileSync(
  "ffmpeg",
  [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    "[voice]",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    OUT,
  ],
  { stdio: "inherit" },
);
console.log(`\nsaved ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${duration(OUT).toFixed(0)}s)`);
