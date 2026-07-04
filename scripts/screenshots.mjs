#!/usr/bin/env node
/**
 * Regenerates docs/screenshots/*.png against the redesigned, lesson-first debrief.
 *
 * The bundled default export (`npm run export`) renders `fixtures/session-htb-easy.json` — schema
 * v1.0, with no ghost/findings/methodology — so it can't show off the features worth screenshotting.
 * This script instead: (1) regenerates the rich demo fixture (`fixtures/session-demo-full.json`, via
 * `npm run gen:demo`), (2) exports it to a self-contained `dist/report-from-capture.html` (zero JS
 * dependencies at file://), (3) drives that page with Playwright/Chromium and captures each debrief
 * surface by its `data-shot="…"` anchor.
 *
 * Run: `npm run screenshots` (chains gen:demo + export + this script), or directly with
 * `node scripts/screenshots.mjs` (it re-runs gen:demo + export itself first, so it's self-sufficient).
 *
 * Requires Chromium: `npx playwright install chromium` (one-time, see scripts/SCREENSHOTS.md).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const reportJson = resolve(root, "fixtures/session-demo-full.json");
// export-html.tsx writes to `dist/report-from-capture.html` (not `report.html`) whenever a
// `--report <path>` override is passed — `report.html` is reserved for the default bundled-fixture
// export, so the two never clobber each other.
const reportHtml = resolve(root, "dist/report-from-capture.html");
const outDir = resolve(root, "docs/screenshots");

const SETTLE_MS = 250;
const PAD = 28; // CSS px of page-background padding composited around each captured element
const DPR = 2; // deviceScaleFactor of the capture page — tight shots come back at this scale
const BASE_VIEWPORT = { width: 1440, height: 900 };

function step(msg) {
  console.log(`\n> ${msg}`);
}

step("gen:demo — rebuilding the rich demo fixture (fixtures/session-demo-full.json)");
execSync("npm run gen:demo", { cwd: root, stdio: "inherit" });

step("export — building dist/ and rendering the fixture into a self-contained report.html");
execSync(`npm run export -- --report ${JSON.stringify(reportJson)}`, { cwd: root, stdio: "inherit" });

if (!existsSync(reportHtml)) {
  throw new Error(`expected ${reportHtml} to exist after \`npm run export\` — check export-html.tsx's output path`);
}
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

/**
 * Screenshot one element (by its `data-shot` anchor) to `docs/screenshots/<file>`, with `PAD` px of
 * page-background padding on every side. A plain `locator.screenshot()` crops tight to the element's
 * border box, which reads as cramped in the README — but it's the only capture that can never pick up
 * a neighbouring section (a clip-based approach bleeds when a neighbour sits within `PAD` px, and a
 * spread box-shadow gets clipped by ancestor `overflow`). So we take the tight shot, then composite
 * it onto a page-background-filled canvas `PAD` px larger on each side, entirely in the browser. This
 * also inherits `locator.screenshot()`'s native handling of elements taller than the viewport.
 */
async function shoot(page, shot, file) {
  const locator = page.locator(`[data-shot="${shot}"]`);
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(SETTLE_MS); // let SVG transitions (radar, gauges, score rings) settle

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const tight = await locator.screenshot({ type: "png" }); // tight crop, at the page's deviceScaleFactor
  const src = `data:image/png;base64,${tight.toString("base64")}`;

  const paddedB64 = await page.evaluate(
    async ({ src, pad, bg, dpr }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const p = Math.round(pad * dpr); // PAD is CSS px; the tight shot is already at dpr scale
      const canvas = document.createElement("canvas");
      canvas.width = img.width + p * 2;
      canvas.height = img.height + p * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, p, p);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { src, pad: PAD, bg, dpr: DPR },
  );

  const dest = resolve(outDir, file);
  writeFileSync(dest, Buffer.from(paddedB64, "base64"));
  console.log(`  wrote docs/screenshots/${file}`);
}

step("launching Chromium and capturing the debrief");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: BASE_VIEWPORT, deviceScaleFactor: DPR });
  await page.goto(pathToFileURL(reportHtml).href);
  await page.waitForSelector('[data-shot="verdict"]', { timeout: 10_000 });
  await page.waitForTimeout(SETTLE_MS);

  // 1. top-level narrative — visible without opening anything
  await shoot(page, "verdict", "identity.png");
  await shoot(page, "path", "path-comparison.png");
  await shoot(page, "phase-audit", "phase-audit.png");
  await shoot(page, "ghost", "ghost.png");
  await shoot(page, "grade", "grade.png");

  // 2. open the Evidence & detail drawer — everything below lives inside it
  step("opening the Evidence & detail drawer");
  await page.click('[data-shot="evidence-drawer-summary"]');
  await page.waitForSelector('[data-shot="deepdive-timeline"]', { state: "visible", timeout: 10_000 });
  await page.waitForTimeout(SETTLE_MS);

  // 3. Deep dive tabs — click the tab button (stable id="deep-dive-tab-<id>"), then shoot its panel.
  // Findings has a data-shot anchor too (for future use) but no README image to regenerate here.
  const tabs = [
    { tab: "frameworks", shot: "deepdive-frameworks", file: "frameworks.png" },
    { tab: "timeline", shot: "deepdive-timeline", file: "attack-timeline.png" },
    { tab: "stealth", shot: "deepdive-stealth", file: "stealth.png" },
    { tab: "deviation", shot: "deepdive-deviation", file: "deviation-timeline.png" },
    { tab: "log", shot: "deepdive-log", file: "command-log.png" },
  ];
  for (const { tab, shot, file } of tabs) {
    await page.click(`#deep-dive-tab-${tab}`);
    await shoot(page, shot, file);
  }

  console.log("\ndone — regenerated docs/screenshots/*.png against the redesigned debrief.");
  console.log("note: docs/screenshots/live-ops.gif is NOT covered by this script (see scripts/SCREENSHOTS.md).");
} finally {
  await browser.close();
}
