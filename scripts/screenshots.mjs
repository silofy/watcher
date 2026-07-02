// Capture README screenshots from the running dev server (npm run dev on :5173).
// Drives the built-in Forge demo (a real HTB box) — live mid-run, then the resolved report and each
// section. Run: node scripts/screenshots.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5173";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

async function shoot(page, id, file) {
  const el = page.locator("#" + id);
  const det = el.locator("details").first();
  if (await det.count()) {
    const open = await det.evaluate((d) => d.open).catch(() => true);
    if (!open) await det.locator("summary").first().click().catch(() => {});
    await page.waitForTimeout(700);
  }
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(350);
  await el.screenshot({ path: `${OUT}/${file}.png` });
  console.log("✓", file);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1360, height: 940 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

console.log("→ loading demo…");
await page.goto(`${BASE}/?demo=live`, { waitUntil: "networkidle" });
// hide the demo pill; de-sticky the header so it doesn't bleed into per-section element shots; pad the
// captured containers so element screenshots have breathing room instead of hugging the content
await page.addStyleTag({
  content:
    "[data-demo-pill]{display:none!important} header.sticky{position:static!important} " +
    "#identity,#summary,#audit,#path,#bridge,#unfolded,#frameworks,#deviated,#stealth,#log{padding:26px!important}",
});

// let the run stream and finish + the writeup load (~34s run + golden); the live view is the GIF
await page.waitForTimeout(42000);

await shoot(page, "identity", "identity");
await shoot(page, "summary", "run-summary");
await shoot(page, "audit", "phase-audit");
await shoot(page, "path", "path-comparison");
await shoot(page, "bridge", "grade");
await shoot(page, "unfolded", "attack-timeline");
await shoot(page, "frameworks", "frameworks");
await shoot(page, "deviated", "deviation-timeline");
await shoot(page, "stealth", "stealth");
await shoot(page, "log", "command-log");

await browser.close();
console.log("done →", OUT);
