import { describe, it, expect } from "vitest";
import { alignEpisodes, objectiveCoverage, equivalenceIndex } from "./align";
import type { Episode, GoldenObjective } from "../../types/report";

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
