// Real end-to-end test: drives the live MezoFlow site in Chromium with a real Mezo
// Testnet wallet and performs every user action through the UI. Each transaction is
// checked three ways: the wallet sent it, the receipt succeeded, and the app showed its
// success toast. Afterwards every hash is confirmed on the Blockscout explorer API.
//
//   BASE=https://mezoflow.vercel.app node e2e.mjs
//
// The wallet key comes from contracts/.env.wallets (E2E_WALLET_4, gitignored) unless KEY
// is set. It is never printed.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatEther, erc20Abi } from "viem";
import { attachWallet } from "./wallet.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE || "https://mezoflow.vercel.app").replace(/\/$/, "");
const RPC = process.env.RPC || "https://rpc.test.mezo.org";
const EXPLORER_API = process.env.EXPLORER_API || "https://api.explorer.test.mezo.org/api/v2";
const EXPLORER = "https://explorer.test.mezo.org";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
const SHOTS = path.join(here, "out", LOCAL ? "local" : "prod");
fs.mkdirSync(SHOTS, { recursive: true });

function walletKey() {
  if (process.env.KEY) return process.env.KEY;
  const f = path.join(here, "..", "contracts", ".env.wallets");
  const m = fs.readFileSync(f, "utf8").match(/^E2E_WALLET_4=(0x[0-9a-fA-F]{64})$/m);
  if (!m) throw new Error("no E2E_WALLET_4 in contracts/.env.wallets");
  return m[1];
}

const results = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.split("\n")[0]));
const w = await attachWallet(page, { key: walletKey(), rpc: RPC });
log(`E2E wallet ${w.account.address} on ${BASE}`);

async function balances() {
  const [btc, musd] = await Promise.all([
    w.pub.getBalance({ address: w.account.address }),
    w.pub.readContract({ address: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503", abi: erc20Abi, functionName: "balanceOf", args: [w.account.address] }).catch(() => 0n),
  ]);
  return { btc, musd };
}

async function go(route) {
  await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Click, then require a sent tx, a successful receipt and the app's success toast. */
async function act(label, click, doneText) {
  const before = w.sent.length;
  const t0 = Date.now();
  try {
    await click();
    const deadline = Date.now() + 150_000;
    while (w.sent.length === before) {
      const err = page.locator(".toast-error").last();
      if (await err.isVisible().catch(() => false)) throw new Error(`app error: ${(await err.innerText()).replace(/\s+/g, " ")}`);
      if (Date.now() > deadline) throw new Error("no transaction was sent");
      await page.waitForTimeout(400);
    }
    const hash = w.sent[w.sent.length - 1];
    const rc = await w.pub.waitForTransactionReceipt({ hash, timeout: 150_000 });
    if (rc.status !== "success") throw new Error(`reverted ${hash}`);
    await page.locator(".toast-success", { hasText: doneText }).first().waitFor({ timeout: 60_000 });
    results.push({ step: label, ok: true, hash, block: Number(rc.blockNumber), gasUsed: rc.gasUsed.toString(), seconds: Math.round((Date.now() - t0) / 1000) });
    log(`  ✓ ${label.padEnd(54)} ${EXPLORER}/tx/${hash}`);
    await page.waitForTimeout(1500);
    return hash;
  } catch (e) {
    results.push({ step: label, ok: false, error: e.message });
    log(`  ✗ ${label}: ${e.message}`);
    await page.screenshot({ path: path.join(SHOTS, `fail-${results.length}.png`), fullPage: true });
    return null;
  }
}

async function check(label, fn) {
  try {
    await fn();
    results.push({ step: label, ok: true });
    log(`  ✓ ${label}`);
  } catch (e) {
    results.push({ step: label, ok: false, error: e.message });
    log(`  ✗ ${label}: ${e.message}`);
  }
}

async function fillAmount(selector, value) {
  const input = page.locator(selector);
  await input.click();
  await input.fill("");
  await input.pressSequentially(value, { delay: 30 });
}

const start = await balances();
log(`start: ${formatEther(start.btc)} BTC, ${formatEther(start.musd)} MUSD`);

// 1. Connect
await go("/app");
await check("connect wallet (EIP-6963 picker)", async () => {
  await page.getByRole("button", { name: /connect wallet/i }).first().waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /connect wallet/i }).first().click();
  await page.getByText("MezoFlow E2E Wallet").first().click();
  await page.getByText(w.account.address.slice(0, 6), { exact: false }).first().waitFor({ timeout: 20_000 });
});

// 2. Swap BTC -> MUSD into the wallet (BTC permit, one tx)
await go("/app/swap");
await act(
  "swap 0.0003 BTC -> MUSD to wallet (BTC permit, Mezo Pools)",
  async () => {
    await fillAmount("#swap-amount", "0.0003");
    await page.getByText("You get").waitFor();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Swap BTC for MUSD" }).click();
  },
  /Swapped/,
);

// 3. Swap BTC straight into Flexible Savings
await act(
  "swap 0.0002 BTC and deposit into Flexible Savings (one tx)",
  async () => {
    await page.getByRole("radio", { name: /Flexible Savings/ }).click();
    await fillAmount("#swap-amount", "0.0002");
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Swap and deposit" }).click();
  },
  /Deposited about/,
);

// 4. Faucet
await act(
  "claim test MUSD from the MezoFlow faucet",
  async () => {
    await page.getByRole("button", { name: /Get \d+ test MUSD/ }).first().click();
  },
  /Claimed/,
);

// 5. Deposit into Term Savings with an MUSD permit
await go("/app/strategies/term-savings");
await act(
  "deposit 3 MUSD into Term Savings (MUSD permit, one tx)",
  async () => {
    await fillAmount("#dep-amount", "3");
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
  },
  /Deposited 3/,
);

// 6. Stability Pool deposit, then partial withdraw (0.10% fee)
await go("/app/strategies/stability-pool");
await act(
  "deposit 3 MUSD into the Stability Pool vault (permit)",
  async () => {
    await fillAmount("#dep-amount", "3");
    await page.getByRole("button", { name: "Deposit", exact: true }).click();
  },
  /Deposited 3/,
);
await act(
  "withdraw 1 MUSD from the Stability Pool vault",
  async () => {
    await page.getByRole("tab", { name: "Withdraw" }).click();
    await fillAmount("#wd-amount", "1");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  },
  /Withdrew/,
);
await check("Claim BTC tab shows pending liquidation gains", async () => {
  await page.getByRole("tab", { name: "Claim BTC" }).click();
  await page.getByText("BTC from liquidations, ready to claim").waitFor();
});

// 7. Withdraw from Flexible Savings
await go("/app/strategies/flexible-savings");
await act(
  "withdraw 1 MUSD from Flexible Savings",
  async () => {
    await page.getByRole("tab", { name: "Withdraw" }).click();
    await fillAmount("#wd-amount", "1");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  },
  /Withdrew/,
);

// 8. Auto allocator with the Growth preset (permit)
await go("/app/allocate");
await act(
  "allocate 12 MUSD with the Growth preset (permit, one tx)",
  async () => {
    await page.getByRole("radio", { name: /Growth/ }).first().click();
    await fillAmount("#alloc-amount", "12");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Allocate", exact: true }).click();
  },
  /Allocated/,
);

// 9. Reallocate an existing position with share permits
await act(
  "move the Flexible Savings position to the Balanced plan (share permit)",
  async () => {
    await page.getByRole("radio", { name: /Balanced/ }).first().click();
    await page.getByRole("checkbox").first().waitFor({ timeout: 30_000 });
    const box = page.locator("label", { hasText: "Flexible Savings" }).locator("input[type=checkbox]");
    await box.check();
    await page.getByRole("button", { name: /Move .* MUSD to this plan/ }).click();
  },
  /Moved/,
);

// 10. Leave Term Savings early (penalty)
await go("/app/strategies/term-savings");
await act(
  "leave Term Savings early (1.5% penalty to the reserve)",
  async () => {
    await page.getByRole("tab", { name: "Withdraw" }).click();
    await page.getByRole("button", { name: "Max" }).last().click();
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /Withdraw early and pay penalty|^Withdraw$/ }).click();
  },
  /Withdrew/,
);

// 11. Alerts saved on-chain
await go("/app/alerts");
await act(
  "save alert preferences on-chain",
  async () => {
    await page.getByRole("switch").nth(2).click();
    await page.getByRole("button", { name: "Save preferences" }).click();
  },
  /Alert preferences saved/,
);

// 12. Read-only pages
await go("/app/activity");
await check("activity shows swaps, deposits and withdrawals from the ledger", async () => {
  const table = page.locator("main table, main ul").first();
  await table.waitFor({ timeout: 30_000 });
  for (const label of ["Swap", "Deposit", "Withdrawal", "Early exit", "Allocation", "Reallocation", "Faucet"]) {
    await page.locator("main").locator("td, li, span, p", { hasText: new RegExp(`^${label}$`) }).first().waitFor({ timeout: 30_000 });
  }
});
await check("activity CSV export downloads", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Export CSV" }).click()]);
  const p = path.join(SHOTS, "activity.csv");
  await dl.saveAs(p);
  const rows = fs.readFileSync(p, "utf8").trim().split("\n").length;
  if (rows < 5) throw new Error(`only ${rows} CSV rows`);
});
await go("/app/risk");
await check("risk dashboard shows live Mezo telemetry", async () => {
  await page.getByText(/oracle/i).first().waitFor({ timeout: 30_000 });
});
await go("/app/assistant");
await check("Ask Flow answers from chain data", async () => {
  await page.getByPlaceholder("Ask about strategies, risks or your portfolio").fill("Can I withdraw from the Stability Pool right now?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(12_000);
  const text = await page.locator("main").innerText();
  if (!/withdraw/i.test(text)) throw new Error("no answer");
});
await go("/app");
await check("overview shows positions after the run", async () => {
  await page.getByRole("heading", { name: "Portfolio value" }).waitFor();
});

// 13. Phone and tablet widths: no horizontal scroll on any route
for (const [name, width, height] of [["phone", 375, 812], ["tablet", 820, 1180]]) {
  await page.setViewportSize({ width, height });
  for (const r of ["/", "/app", "/app/swap", "/app/strategies", "/app/strategies/stability-pool", "/app/allocate", "/app/activity", "/app/alerts", "/app/risk", "/app/assistant"]) {
    await go(r);
    await page.waitForTimeout(1200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) results.push({ step: `${name} ${r} horizontal overflow ${over}px`, ok: false });
  }
  results.push({ step: `${name} width (${width}px): no horizontal scroll on 10 routes`, ok: !results.some((x) => x.step.startsWith(name) && !x.ok) });
}

await browser.close();

// 14. Explorer confirmation for every hash
log("\nExplorer confirmation");
for (const r of results.filter((x) => x.hash)) {
  if (LOCAL) break;
  let status = "pending";
  for (let i = 0; i < 20 && status === "pending"; i++) {
    const res = await fetch(`${EXPLORER_API}/transactions/${r.hash}`).catch(() => null);
    const j = res && res.ok ? await res.json() : null;
    if (j?.status) status = j.status;
    else await new Promise((s) => setTimeout(s, 3000));
  }
  r.explorer = status;
  log(`  ${status === "ok" ? "✓" : "✗"} ${r.hash} ${status}`);
}

const end = await balances();
const summary = {
  base: BASE,
  wallet: w.account.address,
  ranAt: new Date().toISOString(),
  passed: results.filter((r) => r.ok).length,
  failed: results.filter((r) => !r.ok).length,
  transactions: results.filter((r) => r.hash).length,
  btcSpent: formatEther(start.btc - end.btc),
  pageErrors: [...new Set(errors)],
  results,
};
const outFile = path.join(here, "..", "deployments", LOCAL ? "e2e-browser-local.json" : "e2e-browser-production.json");
fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n");
log(`\n${summary.passed} passed, ${summary.failed} failed, ${summary.transactions} transactions. Page errors: ${summary.pageErrors.length}`);
log(`saved ${path.relative(path.join(here, ".."), outFile)}`);
process.exit(summary.failed ? 1 : 0);
