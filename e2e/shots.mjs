// Screenshots of every route at phone, tablet and desktop widths, and a horizontal-
// scroll check. Optionally connects a wallet so app pages show real data.
//   BASE=https://mezoflow.vercel.app OUT=../docs/screenshots node shots.mjs
//   BASE=http://localhost:3005 RPC=http://127.0.0.1:8545 KEY=0x... node shots.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { attachWallet } from "./wallet.mjs";

const BASE = process.env.BASE || "http://localhost:3005";
const OUT = process.env.OUT || "./out";
const RPC = process.env.RPC || "https://rpc.test.mezo.org";
const KEY = process.env.KEY;
const ROUTES = (process.env.ROUTES || "/,/app,/app/strategies,/app/strategies/stability-pool,/app/swap,/app/allocate,/app/risk,/app/activity,/app/alerts,/app/assistant").split(",");
const SIZES = (process.env.SIZES || "desktop:1440x900,tablet:820x1180,phone:390x844").split(",").map((s) => {
  const [name, wh] = s.split(":");
  const [w, h] = wh.split("x").map(Number);
  return { name, w, h };
});
const FULL = process.env.FULL !== "0";

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];
for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.name === "phone" ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`${size.name} pageerror: ${e.message}`));
  if (KEY) await attachWallet(page, { key: KEY, rpc: RPC });
  for (const route of ROUTES) {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => {});
    if (KEY && route.startsWith("/app")) {
      const btn = page.getByRole("button", { name: /connect wallet/i }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        await page.getByText("MezoFlow E2E Wallet").first().click().catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
    await page.waitForTimeout(Number(process.env.WAIT || 2500));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`${size.name} ${route}: horizontal overflow ${overflow}px`);
    const name = `${size.name}${route === "/" ? "-home" : route.replaceAll("/", "-")}.png`;
    await page.screenshot({ path: path.join(OUT, name), fullPage: FULL });
    console.log("shot", name);
  }
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join("\n") : "no overflow or page errors");
