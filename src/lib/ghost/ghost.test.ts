import { describe, it, expect } from "vitest";
import { computeGhost } from "./ghost";
import type { WatcherReport, Episode, Finding, GoldenObjective } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...o });
const rep = (episodes: Episode[], findings: Finding[], golden: GoldenObjective[]): WatcherReport => ({
  schema_version: "1.4", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:30:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: golden, findings,
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeGhost", () => {
  it("returns null when there is no golden tree", () => {
    expect(computeGhost(rep([ep({ seq: 0 })], [], []))).toBeNull();
  });

  it("flags a late pivot: SMB was unlocked early but acted on much later", () => {
    // seq0 nmap finds 445; seqs 1-4 rabbit-hole on web; seq5 finally does SMB.
    const episodes = [
      ep({ seq: 0, binary: "nmap", tactic: "TA0007" }),
      ep({ seq: 1, binary: "gobuster", tactic: "TA0007", alignment: "detour" }),
      ep({ seq: 2, binary: "gobuster", tactic: "TA0007", alignment: "detour" }),
      ep({ seq: 3, binary: "gobuster", tactic: "TA0007", alignment: "detour" }),
      ep({ seq: 4, binary: "gobuster", tactic: "TA0007", alignment: "detour" }),
      ep({ seq: 5, binary: "enum4linux", tactic: "TA0007", alignment: "match" }),
    ];
    const findings: Finding[] = [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }];
    const golden: GoldenObjective[] = [{ objective: "enumerate_smb", tactic: "TA0007", satisfied_by: ["enum4linux"], user_satisfied_by_seq: 5 }];
    const g = computeGhost(rep(episodes, findings, golden))!;
    const item = g.items.find((i) => i.objective === "enumerate_smb")!;
    expect(item.verdict).toBe("late_pivot");
    expect(item.unlock_seq).toBe(0);
    expect(item.actual_seq).toBe(5);
    expect(item.lag_ms).toBeGreaterThan(0);
    expect(g.time_lost_ms).toBe(item.lag_ms);
  });

  it("counts a skipped objective (unlocked, never done)", () => {
    const g = computeGhost(rep(
      [ep({ seq: 0, binary: "nmap" })],
      [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }],
      [{ objective: "enumerate_smb", tactic: "TA0007", satisfied_by: ["enum4linux"], user_satisfied_by_seq: null }],
    ))!;
    expect(g.items[0].verdict).toBe("skipped");
  });

  it("credits an off-path win: satisfied via an alternative method", () => {
    const g = computeGhost(rep(
      [ep({ seq: 0, binary: "nmap" }), ep({ seq: 1, binary: "custom", tactic: "TA0001", alignment: "alternative" })],
      [{ id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 0 }],
      [{ objective: "exploit_web", tactic: "TA0001", satisfied_by: ["sqlmap"], user_satisfied_by_seq: 1 }],
    ))!;
    expect(g.items.find((i) => i.objective === "exploit_web")!.verdict).toBe("off_path_win");
    expect(g.human_wins).toBeGreaterThanOrEqual(1);
  });

  it("flags a real ahead win: satisfied at or before its finding-based unlock", () => {
    // The web objective's unlock comes from a port finding surfacing at seq 2, but the human
    // already satisfied it at seq 1 — ahead of when the finding-based unlock appeared.
    const g = computeGhost(rep(
      [ep({ seq: 0, binary: "recon" }), ep({ seq: 1, binary: "curl", tactic: "TA0001" }), ep({ seq: 2, binary: "nmap" })],
      [{ id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 2 }],
      [{ objective: "exploit_web", tactic: "TA0001", satisfied_by: ["curl"], user_satisfied_by_seq: 1 }],
    ))!;
    const item = g.items.find((i) => i.objective === "exploit_web")!;
    expect(item.unlock_seq).toBe(2);
    expect(item.verdict).toBe("ahead");
    expect(g.human_wins).toBeGreaterThanOrEqual(1);
  });

  it("does not fabricate a win for a satisfied objective with no finding-based unlock (unmapped tactic, e.g. privesc)", () => {
    const g = computeGhost(rep(
      [ep({ seq: 0, binary: "sudo", tactic: "TA0004" })],
      [],
      [{ objective: "find_sudo_misconfig", tactic: "TA0004", depends_on: [], satisfied_by: ["sudo -l"], user_satisfied_by_seq: 0 }],
    ))!;
    const item = g.items.find((i) => i.objective === "find_sudo_misconfig")!;
    expect(item.unlock_seq).toBeNull();
    expect(item.verdict).toBe("on_time");
    expect(g.human_wins).toBe(0);
  });

  it("is deterministic (model-free)", () => {
    const r = rep([ep({ seq: 0, binary: "nmap" })], [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }], [{ objective: "enumerate_smb", tactic: "TA0007", satisfied_by: ["enum4linux"], user_satisfied_by_seq: null }]);
    expect(computeGhost(r)).toEqual(computeGhost(r));
  });
});

function gEp(seq: number, binary: string, cmd: string, extra: Partial<Episode> = {}): Episode {
  return { seq, binary, cmd, duration_ms: 0, gap_before_ms: 0, actor: "human_active", tactic: "TA0007", ...extra };
}

describe("computeGhost with write-up-free signals", () => {
  it("returns a non-null Ghost from signals alone when there is no golden path", () => {
    const r = { golden_dag: [], episodes: [gEp(4, "smbclient", "smbclient -L //h/ -N", { exit_code: 0 })], findings: [] } as unknown as WatcherReport;
    const g = computeGhost(r);
    expect(g).not.toBeNull();
    expect(g!.items.map((i) => i.objective)).toContain("audit_smb_shares");
  });

  it("suppresses a signal that a golden objective already covers", () => {
    const golden: GoldenObjective[] = [{ objective: "audit_share_permissions", tactic: "TA0007", satisfied_by: [], user_satisfied_by_seq: 5 }];
    const r = { golden_dag: golden, episodes: [gEp(4, "smbclient", "smbclient -L //h/ -N", { exit_code: 0 }), gEp(5, "x", "x")], findings: [] } as unknown as WatcherReport;
    const g = computeGhost(r);
    expect(g!.items.map((i) => i.objective)).not.toContain("audit_smb_shares");
  });

  it("returns null when neither golden nor signals produce items", () => {
    const r = { golden_dag: [], episodes: [gEp(1, "nmap", "nmap host")], findings: [] } as unknown as WatcherReport;
    expect(computeGhost(r)).toBeNull();
  });
});
