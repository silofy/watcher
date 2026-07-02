// Record a GIF of the live Forge demo (kill-chain climbing, stealth burning, commands streaming).
// Pure JS (no ffmpeg): capture element PNG frames with Playwright, decode with pngjs, encode with gifenc.
// Run: node scripts/gif.mjs
import { chromium } from "playwright";
import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:5173";
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const FRAMES = 26;
const EVERY_MS = 650; // ~17s of the run, sped up on playback
const DELAY = 220; // per-frame playback delay

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`${BASE}/?demo=live`, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "[data-demo-pill]{display:none!important} #summary{padding:22px!important}" });
await page.waitForTimeout(2500); // let the first couple of commands land so the chart isn't empty

const summary = page.locator("#summary");
const gif = GIFEncoder();
let W = 0;
let H = 0;
console.log("→ recording frames…");
for (let i = 0; i < FRAMES; i++) {
  const buf = await summary.screenshot();
  const png = PNG.sync.read(buf);
  W = png.width;
  H = png.height;
  const data = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
  const palette = quantize(data, 256);
  const index = applyPalette(data, palette);
  gif.writeFrame(index, W, H, { palette, delay: DELAY });
  process.stdout.write(`\r  ${i + 1}/${FRAMES}`);
  await page.waitForTimeout(EVERY_MS);
}
gif.finish();
writeFileSync(`${OUT}/live-ops.gif`, Buffer.from(gif.bytes()));
console.log(`\n✓ live-ops.gif  ${W}x${H}  ${(gif.bytes().length / 1e6).toFixed(1)}MB`);
await browser.close();
