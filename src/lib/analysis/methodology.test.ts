import { describe, it, expect } from "vitest";
import { computeMethodology, topUnmetCheck } from "./methodology";
import type { WatcherReport, Episode, Finding } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "", duration_ms: 0, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...o });
const rep = (episodes: Episode[], findings: Finding[], golden: WatcherReport["golden_dag"] = []): WatcherReport => ({
  schema_version: "1.3", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:10:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: golden, findings,
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeMethodology", () => {
  it("flags smb_enum applicable-but-not-done when 445 is found and no SMB tool used", () => {
    const r = rep([ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap", tactic: "TA0007" })],
      [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }]);
    const res = computeMethodology(r);
    const smb = res.checks.find((c) => c.id === "smb_enum")!;
    expect(smb.applicable).toBe(true);
    expect(smb.done).toBe(false);
    expect(smb.evidence_seq).toBe(0);
  });
  it("marks smb_enum done when enum4linux was used", () => {
    const r = rep([ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" }), ep({ seq: 1, cmd: "enum4linux-ng 10.10.1.5", binary: "enum4linux-ng", tactic: "TA0007" })],
      [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }]);
    expect(computeMethodology(r).checks.find((c) => c.id === "smb_enum")!.done).toBe(true);
  });
  it("excludes non-applicable checks from coverage (no NaN when nothing applies)", () => {
    const res = computeMethodology(rep([], []));
    expect(Number.isFinite(res.coverage_pct)).toBe(true);
    expect(res.coverage_pct).toBe(0);
  });
  it("is deterministic", () => {
    const r = rep([ep({ seq: 0, binary: "nmap" })], [{ id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 0 }]);
    expect(computeMethodology(r)).toEqual(computeMethodology(r));
  });

  it("priv_enum reports the real foothold seq, not a fabricated one, and is done once linpeas runs", () => {
    const golden: WatcherReport["golden_dag"] = [
      { objective: "Get a foothold", tactic: "TA0002", satisfied_by: [], user_satisfied_by_seq: 5 },
    ];
    const r = rep([ep({ seq: 5, cmd: "id", binary: "id", tactic: "TA0002" })], [], golden);
    const noTooling = computeMethodology(r).checks.find((c) => c.id === "priv_enum")!;
    expect(noTooling.applicable).toBe(true);
    expect(noTooling.done).toBe(false);
    expect(noTooling.evidence_seq).toBe(5);

    const rWithLinpeas = rep(
      [ep({ seq: 5, cmd: "id", binary: "id", tactic: "TA0002" }), ep({ seq: 6, cmd: "./linpeas.sh", binary: "linpeas.sh", tactic: "TA0004" })],
      [],
      golden,
    );
    const withTooling = computeMethodology(rWithLinpeas).checks.find((c) => c.id === "priv_enum")!;
    expect(withTooling.done).toBe(true);
    expect(withTooling.evidence_seq).toBe(5);
  });

  it("reports zero coverage and zero applicable checks for a genuinely empty report", () => {
    const res = computeMethodology(rep([], []));
    expect(res.coverage_pct).toBe(0);
    expect(res.checks.filter((c) => c.applicable)).toHaveLength(0);
  });

  it("is order-independent: same findings in different array order yield equal coverage and applicable/done per check", () => {
    const findingsA: Finding[] = [
      { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 },
      { id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 1 },
    ];
    const findingsB: Finding[] = [findingsA[1], findingsA[0]];
    const episodes = [
      ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap", tactic: "TA0007" }),
      ep({ seq: 1, cmd: "gobuster dir -u http://10.10.1.5", binary: "gobuster", tactic: "TA0007" }),
    ];
    const resA = computeMethodology(rep(episodes, findingsA));
    const resB = computeMethodology(rep(episodes, findingsB));
    expect(resA.coverage_pct).toBe(resB.coverage_pct);
    expect(resA.checks.map((c) => ({ id: c.id, applicable: c.applicable, done: c.done }))).toEqual(
      resB.checks.map((c) => ({ id: c.id, applicable: c.applicable, done: c.done })),
    );
    // evidence_seq depends on first-occurrence-in-array for port-derived checks, so it may legitimately
    // differ between orderings; only applicable/done/coverage are asserted equal above.
  });
});

describe("topUnmetCheck", () => {
  it("returns the smb_enum check when 445 is found and no SMB tool was used", () => {
    const r = rep([ep({ seq: 0, cmd: "nmap -sV -sC 10.10.1.5", binary: "nmap", tactic: "TA0007" })],
      [
        { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 },
        { id: "version:1", kind: "version", value: "smb 3.1", source_seq: 0 },
      ]);
    const top = topUnmetCheck(r);
    expect(top).not.toBeNull();
    expect(top!.id).toBe("smb_enum");
    expect(top!.applicable).toBe(true);
    expect(top!.done).toBe(false);
    expect(top!.evidence_seq).toBe(0);
  });

  it("returns null when every applicable check is done", () => {
    const golden: WatcherReport["golden_dag"] = [
      { objective: "Get a foothold", tactic: "TA0002", satisfied_by: [], user_satisfied_by_seq: 5 },
    ];
    const r = rep(
      [
        ep({ seq: 0, cmd: "nmap -sV -sC 10.10.1.5", binary: "nmap", tactic: "TA0007" }),
        ep({ seq: 1, cmd: "gobuster dir -u http://10.10.1.5", binary: "gobuster", tactic: "TA0007" }),
        ep({ seq: 2, cmd: "enum4linux-ng 10.10.1.5", binary: "enum4linux-ng", tactic: "TA0007" }),
        ep({ seq: 5, cmd: "id", binary: "id", tactic: "TA0002" }),
        ep({ seq: 6, cmd: "./linpeas.sh", binary: "linpeas.sh", tactic: "TA0004" }),
      ],
      [
        { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 },
        { id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 0 },
        { id: "version:1", kind: "version", value: "nginx 1.18", source_seq: 0 },
      ],
      golden,
    );
    expect(topUnmetCheck(r)).toBeNull();
  });
});
