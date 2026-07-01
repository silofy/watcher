/**
 * Capture → report CLI. Reads a newline-delimited telemetry stream (from
 * `watcher-capture`, or any §3.3 producer), runs it through the Phase 3 pipeline,
 * assembles a full v1.0 report, validates it against the schema, and writes it out.
 *
 *   vite-node scripts/ingest-capture.tsx [--ndjson <path>] [--golden <path>] [--out <path>]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-report.schema.json";
import { parseEnvelopes, envelopesToRawCommands, assembleReport } from "../src/lib/pipeline/ingest";
import { sshSessionsFromDir } from "../src/lib/ssh/ingest";
import type { GoldenObjective, Session } from "../src/types/report";

/** Read the tap's captured SSH sessions from ~/.watcher/ssh (or --ssh-dir), if any. */
function loadSshSessions(): ReturnType<typeof sshSessionsFromDir> {
  const dir = arg("ssh-dir", join(homedir(), ".watcher", "ssh"));
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((n) => n.endsWith(".in") || n.endsWith(".out") || n.endsWith(".tm") || n.endsWith(".meta"))
    .map((n) => ({ name: n, content: readFileSync(join(dir, n), "utf8") }));
  return sshSessionsFromDir(files);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const ndjsonPath = resolve(arg("ndjson", "crates/capture/events.ndjson"));
const goldenPath = arg("golden", "");
const outPath = resolve(arg("out", "dist/report-from-capture.json"));

// Default golden DAG for the bundled demo capture (whoami / nmap / gobuster / sudo -l).
const DEFAULT_GOLDEN: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap", "rustscan"], depends_on: [] },
  { objective: "enumerate_web_content", tactic: "TA0007", satisfied_by: ["gobuster", "ffuf"], depends_on: ["enumerate_services"] },
  { objective: "find_sudo_misconfig", tactic: "TA0004", satisfied_by: ["sudo -l"], depends_on: [] },
  { objective: "test_credential_reuse", tactic: "TA0001", satisfied_by: ["ssh"], depends_on: [] },
];

const golden: GoldenObjective[] = goldenPath
  ? (JSON.parse(readFileSync(resolve(goldenPath), "utf8")) as GoldenObjective[])
  : DEFAULT_GOLDEN;

const events = parseEnvelopes(readFileSync(ndjsonPath, "utf8"));
const raw = envelopesToRawCommands(events);
if (raw.length === 0) throw new Error(`no command envelopes in ${ndjsonPath}`);

// Machine identity: capture names the box via --machine on an HTB spawn. Here we pick it up from
// the capture's --label (the session_start marker), with a --machine override:
//   --machine "name=Lame,os=Linux,difficulty=Easy,avatar=https://…"
const label = events.find((e) => e.kind === "session_start")?.payload?.text;
const machineArg = arg("machine", "");
let machine: Session["machine"];
if (machineArg) {
  const kv = Object.fromEntries(machineArg.split(",").map((p) => p.split("=").map((s) => s.trim())));
  machine = { name: kv.name ?? "Capture", os: kv.os, difficulty: kv.difficulty, avatar: kv.avatar ?? null };
} else if (label && label.includes("::")) {
  const name = label.split("::")[1].split("(")[0].split("—")[0].trim();
  machine = name ? { name, avatar: null } : undefined;
}

const startMs = raw[0].started_at_ms;
const endMs = raw[raw.length - 1].ended_at_ms;
const session: Session = {
  uuid: events[0]?.session_uuid ?? "00000000-0000-4000-8000-000000000000",
  started_at: new Date(startMs).toISOString(),
  ended_at: new Date(endMs).toISOString(),
  target_scope: label ?? "Live capture (ConPTY/openpty)",
  context_path: "host",
  shell: "powershell.exe",
  source: "local_pty",
  ...(machine ? { machine } : {}),
};

const ssh = loadSshSessions();
if (ssh.length) console.error(`[ingest] folding in ${ssh.length} captured SSH session(s)`);
const report = assembleReport(raw, { golden, session, redaction_profile: "full", ssh });

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(report)) {
  console.error(validate.errors);
  throw new Error("assembled report failed schema validation");
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

// Also drop it where the dev app's session glob picks it up (selectable in the UI).
const fixtureOut = resolve("fixtures/session-live-capture.json");
writeFileSync(fixtureOut, JSON.stringify(report, null, 2), "utf8");

/* eslint-disable no-console */
console.log(`✓ ${ndjsonPath} → ${outPath}`);
console.log(`  also → ${fixtureOut} (selectable in \`npm run dev\`)`);
console.log(
  `  ${report.episodes.length} episodes · ${report.phases.length} phases · ` +
    `${report.metrics.objective_coverage_pct}% coverage · ${report.metrics.efficiency_pct}% efficient · ` +
    `stealth ${report.metrics.stealth_score}`,
);
console.log(`  phases: ${report.phases.map((p) => `${p.label} ${p.efficiency_pct}%`).join(" · ")}`);
