import { describe, it, expect } from "vitest";
import { computeRecovery } from "./recovery";
import type { WatcherReport, Episode } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "x", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...o });
const rep = (episodes: Episode[], golden: WatcherReport["golden_dag"] = []): WatcherReport => ({
  schema_version: "1.3", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:20:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: golden, findings: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeRecovery", () => {
  it("measures latency from a stuck cluster to the next objective-advancing episode", () => {
    const eps = [
      ep({ seq: 0, alignment: "detour", duration_ms: 60000 }),
      ep({ seq: 1, alignment: "detour", duration_ms: 60000 }),
      ep({ seq: 2, alignment: "match", duration_ms: 1000 }),
    ];
    const golden = [{ objective: "o", tactic: "TA0007", satisfied_by: ["x"], user_satisfied_by_seq: 2 }];
    const res = computeRecovery(rep(eps, golden));
    expect(res.recoveries.length).toBe(1);
    expect(res.recoveries[0]).toMatchObject({ stuck_seq: 0, recovered_seq: 2 });
    expect(res.recoveries[0].latency_ms).toBe(121000); // 60000+0 + 60000+0 + 1000+0
    expect(res.median_ms).toBe(res.recoveries[0].latency_ms);
  });
  it("treats a loop_of_seq cluster (no detour alignment) as stuck and measures recovery to it", () => {
    const eps = [
      ep({ seq: 0, loop_of_seq: 0, duration_ms: 60000, gap_before_ms: 0 }),
      ep({ seq: 1, loop_of_seq: 0, duration_ms: 60000, gap_before_ms: 1000 }),
      ep({ seq: 2, alignment: "match", duration_ms: 1000, gap_before_ms: 1000 }),
    ];
    const golden = [{ objective: "o", tactic: "TA0007", satisfied_by: ["x"], user_satisfied_by_seq: 2 }];
    const res = computeRecovery(rep(eps, golden));
    expect(res.recoveries.length).toBe(1);
    expect(res.recoveries[0]).toMatchObject({ stuck_seq: 0, recovered_seq: 2 });
    expect(res.recoveries[0].latency_ms).toBe(123000); // (60000+0) + (60000+1000) + (1000+1000)
  });
  it("reports two recoveries from two separate stuck clusters, with an even-count median", () => {
    const eps = [
      ep({ seq: 0, alignment: "detour", duration_ms: 1000, gap_before_ms: 0 }),
      ep({ seq: 1, alignment: "match", duration_ms: 1000, gap_before_ms: 0 }),
      ep({ seq: 2, alignment: "detour", duration_ms: 5000, gap_before_ms: 0 }),
      ep({ seq: 3, alignment: "match", duration_ms: 2000, gap_before_ms: 0 }),
    ];
    const res = computeRecovery(rep(eps));
    expect(res.recoveries.length).toBe(2);
    expect(res.recoveries[0]).toMatchObject({ stuck_seq: 0, recovered_seq: 1, latency_ms: 2000 }); // (1000+0)+(1000+0)
    expect(res.recoveries[1]).toMatchObject({ stuck_seq: 2, recovered_seq: 3, latency_ms: 7000 }); // (5000+0)+(2000+0)
    expect(res.median_ms).toBe(Math.round((2000 + 7000) / 2)); // 4500 — even-count median branch
  });
  it("yields no recoveries when a stuck cluster runs to the end with no advancing episode", () => {
    const eps = [
      ep({ seq: 0, alignment: "detour", duration_ms: 1000, gap_before_ms: 0 }),
      ep({ seq: 1, alignment: "detour", duration_ms: 1000, gap_before_ms: 0 }),
    ];
    const res = computeRecovery(rep(eps));
    expect(res.recoveries).toEqual([]);
    expect(res.median_ms).toBeNull();
  });
  it("returns [] and null median when there are no stalls", () => {
    const res = computeRecovery(rep([ep({ seq: 0, alignment: "match" })], [{ objective: "o", tactic: "TA0007", satisfied_by: ["x"], user_satisfied_by_seq: 0 }]));
    expect(res.recoveries).toEqual([]);
    expect(res.median_ms).toBeNull();
  });
  it("is deterministic", () => { const r = rep([ep({seq:0,alignment:"detour"}),ep({seq:1,alignment:"detour"}),ep({seq:2,alignment:"match"})],[{objective:"o",tactic:"TA0007",satisfied_by:["x"],user_satisfied_by_seq:2}]); expect(computeRecovery(r)).toEqual(computeRecovery(r)); });
});
