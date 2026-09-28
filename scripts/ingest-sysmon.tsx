/**
 * Sysmon / Windows Event Log → report CLI. Reads a Sysmon export (JSON array or
 * NDJSON of events), turns its ProcessCreate (Event ID 1) records into the
 * RawCommand stream via the Sysmon adapter, runs the Phase 3 pipeline, assembles
 * a v1.0 report, validates it, and writes it out. This is the defense-side path:
 * grade a run reconstructed from the host's own telemetry.
 *
 *   vite-node scripts/ingest-sysmon.tsx --events <sysmon.json> \
 *     [--golden <path>] [--scope "<label>"] [--out <path>]
 *
 * Command lines are credential-scrubbed by the adapter (src/lib/ingest/sysmon.ts).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-report.schema.json";
import { sysmonToRawCommands } from "../src/lib/ingest/sysmon";
import { assembleReport } from "../src/lib/pipeline/ingest";
import type { GoldenObjective, Session } from "../src/types/report";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const eventsPath = arg("events", "");
if (!eventsPath) {
  console.error(
    "usage: vite-node scripts/ingest-sysmon.tsx --events <sysmon.json> [--golden <path>] [--scope <label>] [--out <path>]",
  );
  process.exit(1);
}

const outPath = resolve(arg("out", "dist/report-from-sysmon.json"));
const goldenPath = arg("golden", "");
const golden: GoldenObjective[] = goldenPath
  ? (JSON.parse(readFileSync(resolve(goldenPath), "utf8")) as GoldenObjective[])
  : [];

const raw = sysmonToRawCommands(readFileSync(resolve(eventsPath), "utf8"));
if (raw.length === 0) throw new Error(`no ProcessCreate (Event ID 1) events found in ${eventsPath}`);

const session: Session = {
  uuid: "00000000-0000-4000-8000-000000000000",
  started_at: new Date(raw[0].started_at_ms).toISOString(),
  ended_at: new Date(raw[raw.length - 1].ended_at_ms).toISOString(),
  target_scope: arg("scope", "Sysmon capture"),
  context_path: "host",
  shell: "sysmon",
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
const fixtureOut = resolve("fixtures/session-sysmon.json");
writeFileSync(fixtureOut, JSON.stringify(report, null, 2), "utf8");

/* eslint-disable no-console */
console.log(`✓ ${eventsPath} → ${outPath}`);
console.log(`  also → ${fixtureOut} (selectable in \`npm run dev\`)`);
console.log(
  `  ${raw.length} ProcessCreate events → ${report.episodes.length} episodes · ${report.phases.length} phases · ` +
    `${report.metrics.objective_coverage_pct}% coverage`,
);
