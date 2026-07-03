import { describe, it, expect } from "vitest";
import { alignEpisodes, objectiveCoverage, equivalenceIndex, annotateObjectiveStatus } from "./align";
import type { Episode, Finding, GoldenObjective } from "../../types/report";

const ep = (over: Partial<Episode>): Episode => ({
  seq: 0,
  cmd: "",
  binary: "",
  duration_ms: 1000,
  gap_before_ms: 0,
  exit_code: 0,
  actor: "human_active",
  tactic: "TA0007",
  ...over,
});

describe("equivalenceIndex (deterministic stand-in for the LLM judgment)", () => {
  const obj: GoldenObjective = { objective: "enum", tactic: "TA0007", satisfied_by: ["nmap", "rustscan"] };
  it("matches the primary tool at index 0", () => {
    expect(equivalenceIndex(ep({ binary: "nmap", cmd: "nmap -sV x" }), obj)).toBe(0);
  });
  it("matches an alternative tool at its index", () => {
    expect(equivalenceIndex(ep({ binary: "rustscan", cmd: "rustscan -a x" }), obj)).toBe(1);
  });
  it("requires the tactic to match", () => {
    expect(equivalenceIndex(ep({ binary: "nmap", tactic: "TA0004" }), obj)).toBe(-1);
  });

  it("does not satisfy a flagged method with a different action of the same tool", () => {
    const sudoObj: GoldenObjective = { objective: "enum_sudo", tactic: "TA0004", satisfied_by: ["sudo -l"] };
    // shares the binary but not the `-l` flag → a different action, must not match
    expect(equivalenceIndex(ep({ binary: "sudo", tactic: "TA0004", cmd: "sudo cat /root/notes" }), sudoObj)).toBe(-1);
    expect(equivalenceIndex(ep({ binary: "sudo", tactic: "TA0004", cmd: "sudo -l" }), sudoObj)).toBe(0);
  });

  it("matches a tool token by equality, not as a substring inside a longer word", () => {
    const idObj: GoldenObjective = { objective: "whoami", tactic: "TA0004", satisfied_by: ["id"] };
    // "id" must not false-match inside "guid" / "printuid"
    expect(equivalenceIndex(ep({ binary: "echo", tactic: "TA0004", cmd: "echo $guid" }), idObj)).toBe(-1);
    expect(equivalenceIndex(ep({ binary: "id", tactic: "TA0004", cmd: "id" }), idObj)).toBe(0);
  });
});

describe("alignEpisodes — full diff vs the golden DAG (§4.3)", () => {
  const golden: GoldenObjective[] = [
    { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap", "rustscan"], depends_on: [] },
    { objective: "enumerate_web", tactic: "TA0007", satisfied_by: ["gobuster", "ffuf"], depends_on: ["enumerate_services"] },
    { objective: "find_sudo_misconfig", tactic: "TA0004", satisfied_by: ["sudo -l"], depends_on: [] },
    { objective: "credential_reuse", tactic: "TA0001", satisfied_by: ["ssh"], depends_on: [] },
  ];
  const episodes: Episode[] = [
    ep({ seq: 1, binary: "nmap", cmd: "nmap -sV 10.0.0.1", output_digest: "ports open" }),
    ep({ seq: 2, binary: "ffuf", cmd: "ffuf -w list", output_digest: "found /admin" }),
    ep({ seq: 3, binary: "nmap", cmd: "nmap -sU 10.0.0.1", output_digest: "no new ports" }),
    ep({ seq: 4, binary: "curl", tactic: "TA0001", cmd: "curl -F file=@shell.php up", exit_code: 0, output_digest: "rejected: blocked" }),
    ep({ seq: 5, binary: "curl", tactic: "TA0001", cmd: "curl -F file=@shell.phtml up", output_digest: "accepted" }),
    ep({ seq: 6, binary: "sudo", tactic: "TA0004", cmd: "sudo -l", output_digest: "NOPASSWD find" }),
  ];

  const { episodes: aligned, golden: g } = alignEpisodes(episodes, golden);
  const bySeq = (n: number) => aligned.find((e) => e.seq === n)!;

  it("marks the primary-tool hit a match", () => {
    expect(bySeq(1).alignment).toBe("match");
    expect(g[0].user_satisfied_by_seq).toBe(1);
  });
  it("marks a different valid tool an alternative", () => {
    expect(bySeq(2).alignment).toBe("alternative");
    expect(g[1].user_satisfied_by_seq).toBe(2);
  });
  it("marks an unmatched, low-yield action a detour", () => {
    expect(bySeq(3).alignment).toBe("detour");
  });
  it("marks a failed-then-retried action a loop of the successful retry", () => {
    expect(bySeq(4).loop_of_seq).toBe(5);
  });
  it("satisfies the sudo objective", () => {
    expect(bySeq(6).alignment).toBe("match");
    expect(g[2].user_satisfied_by_seq).toBe(6);
  });
  it("leaves an unattempted objective skipped", () => {
    expect(g[3].user_satisfied_by_seq).toBeNull();
  });
  it("reports 75% coverage (3 of 4)", () => {
    expect(objectiveCoverage(g)).toBe(75);
  });
});

describe("alignEpisodes — out_of_order", () => {
  it("flags a step that breaks a DAG prerequisite", () => {
    const golden: GoldenObjective[] = [
      { objective: "services", tactic: "TA0007", satisfied_by: ["nmap"], depends_on: [] },
      { objective: "web", tactic: "TA0007", satisfied_by: ["ffuf"], depends_on: ["services"] },
    ];
    const episodes: Episode[] = [
      ep({ seq: 1, binary: "ffuf", cmd: "ffuf -w list" }), // web BEFORE services
      ep({ seq: 2, binary: "nmap", cmd: "nmap -sV x" }),
    ];
    const { episodes: aligned } = alignEpisodes(episodes, golden);
    expect(aligned.find((e) => e.seq === 1)!.alignment).toBe("out_of_order");
  });
});

describe("annotateObjectiveStatus", () => {
  const eps: Episode[] = [
    { seq: 0, cmd: "nmap 10.129.1.1", binary: "nmap", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", alignment: "match" },
    { seq: 1, cmd: "cat root.txt", binary: "cat", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004", output_digest: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", alignment: "match" },
  ];
  const findings: Finding[] = [
    { id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 0 },
    { id: "flag:root", kind: "flag", value: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", source_seq: 1, proven: true },
  ];
  const golden: GoldenObjective[] = [
    { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"], user_satisfied_by_seq: 0 },
    { objective: "capture_root", tactic: "TA0004", satisfied_by: ["read root flag"], user_satisfied_by_seq: 1 },
  ];

  it("marks a flag-backed root objective proven and others reached", () => {
    const out = annotateObjectiveStatus(eps, golden, findings);
    expect(out[0].status).toBe("reached");
    expect(out[1].status).toBe("proven");
    expect(out[1].proven_by_seq).toBe(1);
  });
  it("marks an unsatisfied objective untouched", () => {
    const out = annotateObjectiveStatus(eps, [{ objective: "x", tactic: "TA0006", satisfied_by: ["hydra"], user_satisfied_by_seq: null }], findings);
    expect(out[0].status).toBe("untouched");
  });
});

describe("annotateObjectiveStatus — strong-only root proof", () => {
  const golden: GoldenObjective[] = [
    { objective: "capture_root", tactic: "TA0004", satisfied_by: ["cat root.txt"], user_satisfied_by_seq: 0 },
  ];
  const satisfier: Episode = { seq: 0, cmd: "cat root.txt", binary: "cat", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004" };

  it("does not mark proven from 'root' merely appearing inside a path (weak match, stays reached)", () => {
    const eps: Episode[] = [
      satisfier,
      { seq: 1, cmd: "cat /root/notes.txt", binary: "cat", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004", output_digest: "see /root/notes.txt for details" },
    ];
    const out = annotateObjectiveStatus(eps, golden, []);
    expect(out[0].status).toBe("reached");
    expect(out[0].proven_by_seq).toBeNull();
  });

  it("marks proven from a uid=0(root) marker in output", () => {
    const eps: Episode[] = [
      satisfier,
      { seq: 1, cmd: "id", binary: "id", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004", output_digest: "uid=0(root) gid=0(root) groups=0(root)" },
    ];
    const out = annotateObjectiveStatus(eps, golden, []);
    expect(out[0].status).toBe("proven");
    expect(out[0].proven_by_seq).toBe(1);
  });

  it("marks proven from a standalone 'root' whoami output line", () => {
    const eps: Episode[] = [
      satisfier,
      { seq: 1, cmd: "whoami", binary: "whoami", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004", output_digest: "root" },
    ];
    const out = annotateObjectiveStatus(eps, golden, []);
    expect(out[0].status).toBe("proven");
    expect(out[0].proven_by_seq).toBe(1);
  });
});
