import { describe, it, expect } from "vitest";
import { computeFocus } from "./focus";
import type { WatcherReport, Episode } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "sqlmap", duration_ms: 60000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0001", ...o });
const rep = (episodes: Episode[], tActive = 300000): WatcherReport => ({
  schema_version: "1.3", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:20:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: [], findings: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: tActive }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeFocus", () => {
  it("detects a run of >=3 consecutive low-yield same-binary episodes as one rabbit hole", () => {
    const eps = [0, 1, 2, 3].map((seq) => ep({ seq, binary: "sqlmap", alignment: "detour", output_digest: "no results found" }));
    const res = computeFocus(rep(eps));
    expect(res.rabbit_holes.length).toBe(1);
    expect(res.rabbit_holes[0]).toMatchObject({ start_seq: 0, end_seq: 3, binary: "sqlmap" });
    expect(res.discipline_pct).toBeLessThan(100);
  });
  it("does not flag a single failure that is then pivoted away from", () => {
    const eps = [ep({ seq: 0, binary: "sqlmap", alignment: "detour", output_digest: "no results" }), ep({ seq: 1, binary: "gobuster", alignment: "match" })];
    const res = computeFocus(rep(eps));
    expect(res.rabbit_holes).toEqual([]);
    expect(res.discipline_pct).toBe(100);
  });
  it("is deterministic", () => { const r = rep([0,1,2].map((seq)=>ep({seq,alignment:"detour",output_digest:"fail"}))); expect(computeFocus(r)).toEqual(computeFocus(r)); });
});
