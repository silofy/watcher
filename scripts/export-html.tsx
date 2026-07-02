/**
 * Portable, self-contained HTML export (brief §6.3).
 *
 * Produces a single report.html that opens at file:// with zero dependencies:
 *   - all Tailwind-compiled CSS inlined in <style>
 *   - pre-rendered static markup in #root (readable with JS disabled)
 *   - a schema-versioned, public_safe-redacted JSON blob in <script id="watcher-data">
 *   - the inlined React bundle that re-renders #root for interactivity
 *   - a free-tier watermark
 *
 * Run after `vite build`:  vite-node scripts/export-html.tsx
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import rawFixture from "../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../src/types/report";
import { redactReport, maskIps } from "../src/lib/redact";

const dist = resolve(import.meta.dirname, "../dist");
const assets = resolve(dist, "assets");

function readAsset(ext: string): string {
  const file = readdirSync(assets).find((f) => f.endsWith(ext));
  if (!file) throw new Error(`no ${ext} asset in dist/assets — run \`vite build\` first`);
  return readFileSync(resolve(assets, file), "utf8");
}

// Source the report: an external JSON (e.g. a live capture via ingest-capture) when
// WATCHER_REPORT_JSON is set, else the bundled fixture under the public_safe profile.
// Inject it BEFORE importing App so the pre-rendered markup matches the runtime.
const reportArgIdx = process.argv.indexOf("--report");
const reportPath =
  (reportArgIdx >= 0 && reportArgIdx + 1 < process.argv.length ? process.argv[reportArgIdx + 1] : undefined) ??
  process.env.WATCHER_REPORT_JSON;
// Redact BOTH sources under public_safe — the whole promise of the portable export is a file safe to
// post on Discord/GitHub, so an externally-supplied capture (which lands here with profile "full" and
// unredacted episodes) must be scrubbed exactly like the bundled fixture, never embedded verbatim.
const rawReport: WatcherReport = reportPath
  ? (JSON.parse(readFileSync(resolve(reportPath), "utf8")) as WatcherReport)
  : (rawFixture as unknown as WatcherReport);
const report: WatcherReport = redactReport(rawReport, "public_safe");
(globalThis as { __WATCHER_REPORT__?: WatcherReport }).__WATCHER_REPORT__ = report;
const { App } = await import("../src/App");

const css = readAsset(".css");
// The dev fixture is compiled into the bundle as a fallback data source; mask any
// IPs it carries so a public_safe export never ships a live address in the JS.
const js = maskIps(readAsset(".js"));
const staticMarkup = renderToStaticMarkup(<App />);
const blob = JSON.stringify(report);

const html = `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>The Watcher — Session Report</title>
<style>${css}</style>
</head>
<body>
<div id="root">${staticMarkup}</div>
<div style="position:fixed;bottom:8px;right:12px;font:11px ui-sans-serif,system-ui;color:#5a6678;opacity:.7;pointer-events:none">Generated with The Watcher · free tier</div>
<script type="application/json" id="watcher-data">${blob.replace(/</g, "\\u003c")}</script>
<script type="module">${js}</script>
</body>
</html>
`;

const out = resolve(dist, reportPath ? "report-from-capture.html" : "report.html");
writeFileSync(out, html, "utf8");
const kb = (html.length / 1024).toFixed(0);
// eslint-disable-next-line no-console
console.log(`wrote ${out} (${kb} kB, self-contained, ${report.redaction_profile})`);
