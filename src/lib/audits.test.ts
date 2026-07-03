import { describe, it, expect } from "vitest";
import { buildPhaseAudits, humanizeObjective } from "./audits";
import fixture from "../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../types/report";

const report = fixture as unknown as WatcherReport;

describe("humanizeObjective", () => {
  it("maps known slugs to clean names, title-cases the rest", () => {
    expect(humanizeObjective("find_sudo_misconfig")).toBe("Find the sudo misconfiguration");
    expect(humanizeObjective("some_custom_objective")).toBe("Some custom objective");
    expect(humanizeObjective("")).toBe("");
  });
});

describe("buildPhaseAudits", () => {
  const { phases } = buildPhaseAudits(report);

  it("produces one audit per report phase, in kill-chain order", () => {
    expect(phases.map((p) => p.tactic)).toEqual(report.phases.map((p) => p.mitre_tactic));
  });

  it("warns when a long SSH session left post-exploitation uncaptured", () => {
    const withSsh = structuredClone(report);
    // an interactive ssh block, and no on-target commands captured after it
    withSsh.episodes.push({
      seq: 999,
      cmd: "ssh user@10.10.10.5",
      binary: "ssh",
      duration_ms: 600_000,
      gap_before_ms: 0,
      actor: "human_active",
      tactic: "TA0008",
      context_path: "host",
    });
    const warn = buildPhaseAudits(withSsh).general.find((g) => g.id === "ssh-opaque-block");
    expect(warn).toBeDefined();
    expect(warn!.evidence_seq).toBe(999);

    // ...but not when the session was actually tapped (on-target commands present)
    const tapped = structuredClone(withSsh);
    tapped.episodes.push({ seq: 1000, cmd: "id", binary: "id", duration_ms: 0, gap_before_ms: 0, actor: "human_active", tactic: "TA0007", context_path: "host->ssh:10.10.10.5" });
    expect(buildPhaseAudits(tapped).general.find((g) => g.id === "ssh-opaque-block")).toBeUndefined();
  });

  it("scopes CWE weakness classes to the phase that exploited them", () => {
    const access = phases.find((p) => p.tactic === "TA0001")!; // hydra runs here
    expect(access.cwe).toEqual(["CWE-307"]);
    // recon phase exploits no weakness — stays empty, not a guess
    expect(phases.find((p) => p.tactic === "TA0007")!.cwe).toEqual([]);
  });

  it("scopes objective coverage to each phase's tactic", () => {
    const discovery = phases.find((p) => p.tactic === "TA0007")!;
    // 3 discovery objectives in the fixture, all satisfied
    expect(discovery.coverage.total).toBe(3);
    expect(discovery.coverage.satisfied).toBe(3);
    expect(discovery.objectives).toHaveLength(3);
    expect(discovery.objectives.every((o) => o.reached)).toBe(true);
    expect(discovery.manual).toHaveLength(0); // no noref note when a golden DAG is present
  });

  it("marks an unsatisfied objective as not-reached in the objectives checklist", () => {
    // test_credential_reuse_ssh (TA0001) is unsatisfied in the fixture
    const access = phases.find((p) => p.tactic === "TA0001")!;
    const obj = access.objectives.find((o) => o.slug === "test_credential_reuse_ssh");
    expect(obj).toBeDefined();
    expect(obj!.reached).toBe(false);
    expect(obj!.label).toBe("Test credential reuse over SSH");
    // not duplicated into the manual-check group anymore
    expect(access.manual.some((m) => /credential reuse/i.test(m.title))).toBe(false);
  });

  it("places coaching onto the phase of its evidence episode", () => {
    // 'Run sudo -l first' has evidence_seq 28, a TA0004 (PrivEsc) episode
    const privesc = phases.find((p) => p.tactic === "TA0004")!;
    expect(privesc.insights.some((i) => /sudo -l/.test(i.title))).toBe(true);
  });

  it("aggregates dead-ends into an insight with a real time cost", () => {
    // seq 8 (nmap UDP) is a detour in TA0007
    const discovery = phases.find((p) => p.tactic === "TA0007")!;
    const detour = discovery.insights.find((i) => i.id.endsWith("-detour"));
    expect(detour).toBeDefined();
    expect(detour!.savings_ms!).toBeGreaterThan(0);
    expect(detour!.evidence_seq).toBe(8);
  });

  it("marks a proven objective as proven, distinct from merely reached", () => {
    const withProven = structuredClone(report);
    // capture_root_flag (TA0004) is reached in the fixture but carries no status — not proven
    const rootFlag = withProven.golden_dag.find((o) => o.objective === "capture_root_flag")!;
    expect(rootFlag.user_satisfied_by_seq).not.toBeNull();
    delete rootFlag.status;

    // escalate_to_root (TA0004), reached at seq 29 — mark it proven
    const escalate = withProven.golden_dag.find((o) => o.objective === "escalate_to_root")!;
    escalate.status = "proven";

    const privesc = buildPhaseAudits(withProven).phases.find((p) => p.tactic === "TA0004")!;
    const proven = privesc.objectives.find((o) => o.slug === "escalate_to_root")!;
    const merelyReached = privesc.objectives.find((o) => o.slug === "capture_root_flag")!;

    expect(proven.reached).toBe(true);
    expect(proven.proven).toBe(true);
    expect(merelyReached.reached).toBe(true);
    expect(merelyReached.proven).toBe(false);
  });

  it("links a reached objective to the satisfying step", () => {
    const discovery = phases.find((p) => p.tactic === "TA0007")!;
    const obj = discovery.objectives.find((o) => o.slug === "enumerate_services");
    expect(obj?.reached).toBe(true);
    expect(obj?.seq).toBe(1);
  });

  it("treats coverage as unverifiable (manual) when there is no golden DAG", () => {
    const { phases: noRef } = buildPhaseAudits({ ...report, golden_dag: [] });
    for (const p of noRef) {
      if (p.commands > 0) {
        expect(p.manual.some((m) => m.id.endsWith("-noref"))).toBe(true);
        expect(p.coverage.total).toBe(0);
        expect(p.objectives).toHaveLength(0);
      }
    }
  });

  it("routes an unplaceable coaching step (Tactics, no evidence) to the General bucket", () => {
    const orphan = { action: "Trim ~5 min of detours", why: "low-yield paths", category: "Tactics" as const, evidence_seq: null };
    const withOrphan = { ...report, coaching: { ...report.coaching, next_steps: [...report.coaching.next_steps, orphan] } };
    const { phases: ph, general } = buildPhaseAudits(withOrphan);
    expect(general.some((g) => /Trim ~5 min/.test(g.title))).toBe(true);
    // and it isn't silently dropped into a phase
    expect(ph.flatMap((p) => p.insights).some((i) => /Trim ~5 min/.test(i.title))).toBe(false);
  });
});
