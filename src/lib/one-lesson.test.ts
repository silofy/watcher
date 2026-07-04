import { describe, it, expect } from "vitest";
import { pickOneLesson } from "./one-lesson";
import type { WatcherReport, Episode, Finding, GhostItem, CoachingStep } from "../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({
  cmd: "",
  binary: "",
  duration_ms: 0,
  gap_before_ms: 0,
  actor: "machine_bound",
  tactic: "TA0007",
  ...o,
});

function rep(o: {
  episodes?: Episode[];
  findings?: Finding[];
  golden_dag?: WatcherReport["golden_dag"];
  ghost?: WatcherReport["ghost"];
  next_steps?: CoachingStep[];
}): WatcherReport {
  return {
    schema_version: "1.4",
    session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:20:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
    episodes: o.episodes ?? [],
    phases: [],
    golden_dag: o.golden_dag ?? [],
    findings: o.findings,
    metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
    coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: o.next_steps ?? [] },
    redaction_profile: "full",
    ghost: o.ghost,
  };
}

describe("pickOneLesson priority", () => {
  it("picks the biggest Ghost late-pivot first, even when a methodology miss also exists", () => {
    const ghostItems: GhostItem[] = [
      { objective: "get_foothold", verdict: "late_pivot", unlock_seq: 2, actual_seq: 8, lag_ms: 60_000, note: "Unlocked at step 2 but you acted at step 8 — the optimal line pivots here sooner." },
      { objective: "escalate", verdict: "late_pivot", unlock_seq: 3, actual_seq: 5, lag_ms: 10_000 },
    ];
    const r = rep({
      episodes: [ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" })],
      findings: [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }], // smb_enum: applicable + not done
      ghost: { time_lost_ms: 70_000, human_wins: 0, items: ghostItems },
    });
    const lesson = pickOneLesson(r);
    expect(lesson).not.toBeNull();
    expect(lesson!.text).toBe("Unlocked at step 2 but you acted at step 8 — the optimal line pivots here sooner.");
    expect(lesson!.evidence_seq).toBe(8);
  });

  it("falls back to a constructed sentence when the worst late-pivot has no note", () => {
    const r = rep({
      ghost: {
        time_lost_ms: 10_000,
        human_wins: 0,
        items: [{ objective: "smb_enum", verdict: "late_pivot", unlock_seq: 4, actual_seq: 9, lag_ms: 10_000 }],
      },
    });
    const lesson = pickOneLesson(r)!;
    expect(lesson.text).toContain("step 4");
    expect(lesson.text).toContain("step 9");
    expect(lesson.evidence_seq).toBe(9);
  });

  it("falls back to unlock_seq when the worst late-pivot has no actual_seq", () => {
    const r = rep({
      ghost: {
        time_lost_ms: 5000,
        human_wins: 0,
        items: [{ objective: "smb_enum", verdict: "late_pivot", unlock_seq: 4, actual_seq: null, lag_ms: 5000, note: "note" }],
      },
    });
    expect(pickOneLesson(r)!.evidence_seq).toBe(4);
  });

  it("picks the top unmet methodology check when there is no ghost late-pivot", () => {
    const r = rep({
      episodes: [ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" })],
      findings: [
        { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 },
        { id: "version:445-tcp", kind: "version", value: "smb 3.1.1", source_seq: 0 }, // clears service_version_enum so smb_enum surfaces
      ],
    });
    const lesson = pickOneLesson(r)!;
    expect(lesson.text).toBe("SMB enumeration — SMB is open — enumerate it (`enum4linux-ng`, `smbclient -L`).");
    expect(lesson.evidence_seq).toBe(0);
  });

  it("ignores a ghost with no late-pivot items and falls through to methodology", () => {
    const r = rep({
      episodes: [ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" })],
      findings: [
        { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 },
        { id: "version:445-tcp", kind: "version", value: "smb 3.1.1", source_seq: 0 },
      ],
      ghost: { time_lost_ms: 0, human_wins: 1, items: [{ objective: "get_foothold", verdict: "ahead", unlock_seq: 1, actual_seq: 0, lag_ms: 0 }] },
    });
    expect(pickOneLesson(r)!.text).toContain("SMB enumeration");
  });

  it("picks the worst rabbit hole when there's no ghost and no methodology miss", () => {
    // one nmap episode satisfies the only applicable methodology check (port_scan); no web/smb/foothold
    // context exists, so nothing else is applicable — the sqlmap run below is a pure rabbit hole.
    const r = rep({
      episodes: [
        ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" }),
        ep({ seq: 1, binary: "sqlmap", alignment: "detour", output_digest: "no results found" }),
        ep({ seq: 2, binary: "sqlmap", alignment: "detour", output_digest: "no results found" }),
        ep({ seq: 3, binary: "sqlmap", alignment: "detour", output_digest: "no results found" }),
        ep({ seq: 4, binary: "sqlmap", alignment: "detour", output_digest: "no results found" }),
      ],
    });
    const lesson = pickOneLesson(r)!;
    expect(lesson.text).toContain("sqlmap");
    expect(lesson.evidence_seq).toBe(1);
  });

  it("picks the first actionable (non-Recap) coaching step when nothing else applies", () => {
    const r = rep({
      next_steps: [
        { action: "Recap", why: "18 commands captured across 10 ATT&CK techniques.", category: "Recap", evidence_seq: null },
        { action: "Enumerate SMB shares.", why: "Port 445 was open and unexplored.", category: "Access", evidence_seq: 12 },
      ],
    });
    const lesson = pickOneLesson(r)!;
    expect(lesson.text).toBe("Enumerate SMB shares. Port 445 was open and unexplored.");
    expect(lesson.evidence_seq).toBe(12);
  });

  it("returns null when only Recap coaching exists and nothing else applies", () => {
    const r = rep({
      next_steps: [{ action: "Recap", why: "18 commands captured across 10 ATT&CK techniques.", category: "Recap", evidence_seq: null }],
    });
    expect(pickOneLesson(r)).toBeNull();
  });

  it("returns null for a genuinely empty report", () => {
    expect(pickOneLesson(rep({}))).toBeNull();
  });

  it("is deterministic", () => {
    const r = rep({
      episodes: [ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" })],
      findings: [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }],
    });
    expect(pickOneLesson(r)).toEqual(pickOneLesson(r));
  });
});
