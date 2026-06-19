import { describe, it, expect } from "vitest";
import { finalizeLiveReport } from "../src/lib/finalize";
import type { Episode, WatcherReport } from "../src/types/report";

const ep = (seq: number, binary: string, tactic: string, technique: string, duration_ms: number, gap_before_ms: number): Episode =>
  ({ seq, cmd: `${binary} target`, binary, duration_ms, gap_before_ms, exit_code: 0, actor: "machine_bound", tactic, technique, confidence: 1, context_path: "host" });

function base(episodes: Episode[], recording = false): WatcherReport {
  return {
    schema_version: "1.0",
    session: { uuid: "x", started_at: "2026-06-18T10:00:00.000Z", ended_at: "2026-06-18T10:10:00.000Z", target_scope: "Box", context_path: "host", shell: "", source: "in_vm_daemon" },
    episodes,
    phases: [],
    golden_dag: [],
    metrics: { efficiency_pct: 0, objective_coverage_pct: 0, stealth_score: 100, technique_breadth: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 } },
    coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [{ action: "placeholder", why: "", category: "Recap", evidence_seq: null }] },
    redaction_profile: "full",
    recording,
  } as WatcherReport;
}

describe("finalizeLiveReport", () => {
  it("leaves a report with no episodes untouched", () => {
    const r = base([]);
    expect(finalizeLiveReport(r)).toBe(r);
  });

  it("derives phases, breadth, and a skill radar from captured episodes", () => {
    const r = base([
      ep(1, "nmap", "TA0007", "T1046", 90_000, 2_000),
      ep(2, "gobuster", "TA0007", "T1595", 30_000, 1_000),
      ep(3, "sudo", "TA0004", "T1068", 5_000, 4_000),
    ]);
    const f = finalizeLiveReport(r);
    // two distinct tactics → two phases; three distinct techniques → breadth 3
    expect(f.phases.map((p) => p.mitre_tactic)).toEqual(["TA0007", "TA0004"]);
    expect(f.phases[0].label).toBe("Discovery");
    expect(f.metrics.technique_breadth).toBe(3);
    expect(f.coaching.skill_radar.recon).toBeGreaterThan(0);
    expect(f.coaching.skill_radar.privesc).toBeGreaterThan(0);
    expect(f.coaching.next_steps[0].action).toContain("3 commands");
  });

  it("labels the lead line 'Recording' while live", () => {
    const f = finalizeLiveReport(base([ep(1, "nmap", "TA0007", "T1046", 1000, 0)], true));
    expect(f.coaching.next_steps[0].action).toMatch(/^Recording/);
  });
});
