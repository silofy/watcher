import { describe, it, expect } from "vitest";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../schema/watcher-report.schema.json";
import { parseEnvelopes, envelopesToRawCommands, assembleReport, reportFromNdjson } from "./ingest";
import type { GoldenObjective, Session } from "../../types/report";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// A tiny §3.3 capture stream: nmap then sudo -l, each a command+output pair.
const ndjson = [
  { source: "local_pty", session_uuid: "u", seq: 1, ts_utc_us: 1_000_000_000, kind: "command", payload: { cmd: "nmap -sV 10.0.0.1" }, provenance: { context_path: "host", platform: "conpty" } },
  { source: "local_pty", session_uuid: "u", seq: 1, ts_utc_us: 1_060_000_000, kind: "output", payload: { stream: "stdout", text: "22,80 open", line_count: 2 }, provenance: { context_path: "host" } },
  { source: "local_pty", session_uuid: "u", seq: 2, ts_utc_us: 1_090_000_000, kind: "command", payload: { cmd: "sudo -l" }, provenance: { context_path: "host", platform: "conpty" } },
  { source: "local_pty", session_uuid: "u", seq: 2, ts_utc_us: 1_090_500_000, kind: "output", payload: { stream: "stdout", text: "(ALL) NOPASSWD: /usr/bin/find", line_count: 1 }, provenance: { context_path: "host" } },
]
  .map((e) => JSON.stringify(e))
  .join("\n");

const golden: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"], depends_on: [] },
  { objective: "find_sudo_misconfig", tactic: "TA0004", satisfied_by: ["sudo -l"], depends_on: [] },
  { objective: "credential_reuse", tactic: "TA0001", satisfied_by: ["ssh"], depends_on: [] },
];

const session: Session = {
  uuid: "3de5c2f2-38c5-4014-ac11-e87935b2641e",
  started_at: "2026-06-18T10:00:00Z",
  ended_at: "2026-06-18T10:05:00Z",
  target_scope: "live capture",
  shell: "powershell.exe",
  source: "local_pty",
};

describe("envelope → RawCommand join (§3.3)", () => {
  const events = parseEnvelopes(ndjson);
  const raw = envelopesToRawCommands(events);

  it("pairs command + output by seq, re-redacting on the way in", () => {
    expect(raw).toHaveLength(2);
    // re-redaction is mandatory on this capture→report→disk path: the live IP is masked, never
    // persisted verbatim (see redactText / watcher_core::redact).
    expect(raw[0].cmd).toBe("nmap -sV x.x.x.x");
    expect(raw[0].output_digest).toBe("22,80 open");
  });
  it("derives duration from command/output timestamps (µs → ms)", () => {
    // 1_060_000_000µs - 1_000_000_000µs = 60_000_000µs = 60_000ms
    expect(raw[0].ended_at_ms - raw[0].started_at_ms).toBe(60_000);
  });
});

describe("assembleReport — full capture → report", () => {
  const report = assembleReport(envelopesToRawCommands(parseEnvelopes(ndjson)), { golden, session });

  it("produces a schema-valid v1.0 report", () => {
    const ok = validate(report);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });
  it("classifies and aligns the captured commands", () => {
    const nmap = report.episodes.find((e) => e.binary === "nmap")!;
    const sudo = report.episodes.find((e) => e.binary === "sudo")!;
    expect(nmap.tactic).toBe("TA0007");
    expect(nmap.alignment).toBe("match");
    expect(sudo.tactic).toBe("TA0004");
    expect(sudo.alignment).toBe("match");
  });
  it("computes coverage and coaching from the golden DAG", () => {
    expect(report.metrics.objective_coverage_pct).toBe(67); // 2 of 3
    expect(report.coaching.next_steps.map((s) => `${s.action} ${s.why}`).join(" ")).toContain("credential reuse");
  });

  it("reportFromNdjson is equivalent", () => {
    expect(reportFromNdjson(ndjson, { golden, session })).toEqual(report);
  });
});
