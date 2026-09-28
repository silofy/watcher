/**
 * Claude Code session → report CLI. Reads a Claude Code transcript (JSONL), turns
 * its Bash tool calls into the RawCommand stream via the ingest adapter, runs the
 * Phase 3 pipeline, assembles a v1.0 report, validates it, and writes it out.
 *
 *   vite-node scripts/ingest-claude-code.tsx --transcript <session.jsonl> \
 *     [--golden <path>] [--scope "<label>"] [--out <path>]
 *
 * Non-Bash tool calls are ignored; wall-clock timing includes the agent's
 * think-time. Output digests are credential-scrubbed and AI-tell-normalized by
 * the adapter (src/lib/ingest/claude-code.ts).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-report.schema.json";
import { claudeCodeToRawCommands } from "../src/lib/ingest/claude-code";
import { assembleReport } from "../src/lib/pipeline/ingest";
import type { GoldenObjective, Session } from "../src/types/report";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const transcriptPath = arg("transcript", "");
if (!transcriptPath) {
  console.error(
    "usage: vite-node scripts/ingest-claude-code.tsx --transcript <session.jsonl> [--golden <path>] [--scope <label>] [--out <path>]",
  );
  process.exit(1);
}

const outPath = resolve(arg("out", "dist/report-from-claude-code.json"));
const goldenPath = arg("golden", "");
const golden: GoldenObjective[] = goldenPath
  ? (JSON.parse(readFileSync(resolve(goldenPath), "utf8")) as GoldenObjective[])
  : [];

const jsonl = readFileSync(resolve(transcriptPath), "utf8");
const raw = claudeCodeToRawCommands(jsonl);
if (raw.length === 0) throw new Error(`no Bash tool calls found in ${transcriptPath}`);

const session: Session = {
  uuid: "00000000-0000-4000-8000-000000000000",
  started_at: new Date(raw[0].started_at_ms).toISOString(),
  ended_at: new Date(raw[raw.length - 1].ended_at_ms).toISOString(),
  target_scope: arg("scope", "Claude Code session"),
  context_path: "host",
  shell: "claude-code",
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
const fixtureOut = resolve("fixtures/session-claude-code.json");
writeFileSync(fixtureOut, JSON.stringify(report, null, 2), "utf8");

/* eslint-disable no-console */
console.log(`✓ ${transcriptPath} → ${outPath}`);
console.log(`  also → ${fixtureOut} (selectable in \`npm run dev\`)`);
console.log(
  `  ${raw.length} Bash commands → ${report.episodes.length} episodes · ${report.phases.length} phases · ` +
    `${report.metrics.objective_coverage_pct}% coverage · stealth ${report.metrics.stealth_score}`,
);
