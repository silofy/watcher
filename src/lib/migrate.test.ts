import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics";
import type { WatcherReport } from "../types/report";

const minimalV11: WatcherReport = {
  schema_version: "1.1",
  session: {
    uuid: "00000000-0000-4000-8000-000000000000",
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:10:00Z",
    target_scope: "HTB::Example (Easy)",
    shell: "bash",
    source: "local_pty",
  },
  episodes: [
    { seq: 0, cmd: "nmap 10.129.1.1", binary: "nmap", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007" },
  ],
  phases: [],
  golden_dag: [],
  metrics: {
    efficiency_pct: 0,
    time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 },
    stealth_score: 100,
    objective_coverage_pct: 0,
    technique_breadth: 1,
  },
  coaching: { skill_radar: { recon: 50, web: 50, exploit: 50, privesc: 50, opsec: 100 }, next_steps: [] },
  redaction_profile: "full",
};

describe("backward compat", () => {
  it("loads a minimal v1.1 report with no v1.2 fields through computeMetrics", () => {
    const m = computeMetrics(minimalV11);
    expect(m).toBeTruthy();
    expect(typeof m.efficiency_pct).toBe("number");
  });
});
