/**
 * HTTP proxy (HAR) → report CLI. Reads a HAR 1.2 export from any proxy (Burp,
 * ZAP, mitmproxy, browser DevTools), turns its entries into the RawCommand stream
 * via the HAR adapter, runs the Phase 3 pipeline, assembles a v1.0 report,
 * validates it, and writes it out.
 *
 *   vite-node scripts/ingest-http-proxy.tsx --har <capture.har> \
 *     [--golden <path>] [--scope "<label>"] [--out <path>]
 *
 * Request/response bodies are credential-scrubbed by the adapter
 * (src/lib/ingest/http-proxy.ts); response bodies are truncated to a digest.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-report.schema.json";
import { harToRawCommands } from "../src/lib/ingest/http-proxy";
import { assembleReport } from "../src/lib/pipeline/ingest";
import { WEB_METHODOLOGY } from "../src/lib/golden/methodology";
import type { GoldenObjective, Session } from "../src/types/report";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const harPath = arg("har", "");
if (!harPath) {
  console.error(
    "usage: vite-node scripts/ingest-http-proxy.tsx --har <capture.har> [--golden <path>] [--scope <label>] [--out <path>]",
  );
  process.exit(1);
}

const outPath = resolve(arg("out", "dist/report-from-http-proxy.json"));
const goldenPath = arg("golden", "");
const golden: GoldenObjective[] = goldenPath
  ? (JSON.parse(readFileSync(resolve(goldenPath), "utf8")) as GoldenObjective[])
  : WEB_METHODOLOGY.map((o) => ({ ...o }));

const raw = harToRawCommands(readFileSync(resolve(harPath), "utf8"));
if (raw.length === 0) throw new Error(`no HTTP entries found in ${harPath}`);

// Default the scope label to the first request's host when the caller gives none.
const firstHost = (() => {
  try {
    return new URL(raw[0].web?.url ?? "").host;
  } catch {
    return "";
  }
})();

const session: Session = {
  uuid: "00000000-0000-4000-8000-000000000000",
  started_at: new Date(raw[0].started_at_ms).toISOString(),
  ended_at: new Date(raw[raw.length - 1].ended_at_ms).toISOString(),
  target_scope: arg("scope", firstHost ? `HTTP proxy :: ${firstHost}` : "HTTP proxy capture"),
  context_path: "web",
  shell: "http-proxy",
  source: "plugin",
};

const report = assembleReport(raw, { golden, session, redaction_profile: "full" });

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(report)) {
  console.error(validate.errors);
  throw new Error("assembled report failed schema validation");
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
const fixtureOut = resolve("fixtures/session-http-proxy.json");
writeFileSync(fixtureOut, JSON.stringify(report, null, 2), "utf8");

/* eslint-disable no-console */
console.log(`✓ ${harPath} → ${outPath}`);
console.log(`  also → ${fixtureOut} (selectable in \`npm run dev\`)`);
console.log(
  `  ${raw.length} HTTP exchanges → ${report.episodes.length} episodes · ${report.phases.length} phases · ` +
    `${report.metrics.objective_coverage_pct}% coverage`,
);
