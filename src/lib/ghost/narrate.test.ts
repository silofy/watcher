import { describe, it, expect } from "vitest";
import { narrateGhost } from "./narrate";
import { computeGhost, type GhostResult } from "./ghost";
import { NullProvider, type GenOptions, type LlmProvider } from "../llm/provider";
import type { WatcherReport, Episode, Finding, GoldenObjective } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...o });
const rep = (episodes: Episode[], findings: Finding[], golden: GoldenObjective[]): WatcherReport => ({
  schema_version: "1.4", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:30:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: golden, findings,
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

/** Captures every prompt it's asked to complete — lets the redaction test inspect exactly what left the process. */
class CapturingProvider implements LlmProvider {
  readonly name = "capture";
  prompts: string[] = [];
  constructor(private value: unknown | null) {}
  async available() {
    return true;
  }
  async generateJson(prompt: string, _o?: GenOptions) {
    this.prompts.push(prompt);
    return this.value;
  }
}

/** A realistic session — raw commands, an output digest, and a finding value with a "secret" baked
 *  in — so the redaction test proves those never reach the narration prompt, not just that the
 *  GhostDiffItem type happens to omit them. */
function sampleGhost(): GhostResult {
  const episodes: Episode[] = [
    ep({ seq: 0, binary: "nmap", cmd: "nmap -sC -sV -p- 10.10.11.5", output_digest: "445/tcp open microsoft-ds; 5985/tcp open winrm" }),
    ep({ seq: 1, binary: "gobuster", tactic: "TA0007", alignment: "detour", cmd: "gobuster dir -u http://10.10.11.5 -w big.txt" }),
    ep({ seq: 2, binary: "gobuster", tactic: "TA0007", alignment: "detour", cmd: "gobuster dir -u http://10.10.11.5 -w bigger.txt" }),
    ep({ seq: 3, binary: "gobuster", tactic: "TA0007", alignment: "detour", cmd: "gobuster vhost -u http://10.10.11.5" }),
    ep({ seq: 4, binary: "enum4linux", tactic: "TA0007", alignment: "match", cmd: "enum4linux -a 10.10.11.5" }),
  ];
  const findings: Finding[] = [{ id: "port:445-tcp", kind: "port", value: "445/tcp open microsoft-ds — SECRET_ADMIN_PASS_HINT", source_seq: 0 }];
  const golden: GoldenObjective[] = [{ objective: "enumerate_smb", tactic: "TA0007", satisfied_by: ["enum4linux"], user_satisfied_by_seq: 4 }];
  return computeGhost(rep(episodes, findings, golden))!;
}

describe("narrateGhost", () => {
  it("returns the result unchanged (reference-equal) with NullProvider — deterministic notes stand", async () => {
    const ghost = sampleGhost();
    const out = await narrateGhost(ghost, new NullProvider());
    expect(out).toBe(ghost);
  });

  it("never sends a raw command, output_digest, or finding value to the provider (redaction)", async () => {
    const ghost = sampleGhost();
    const provider = new CapturingProvider(null);
    await narrateGhost(ghost, provider);

    expect(provider.prompts.length).toBe(1);
    const prompt = provider.prompts[0];

    // none of the raw session data crossed the boundary
    expect(prompt).not.toContain("nmap -sC");
    expect(prompt).not.toContain("gobuster");
    expect(prompt).not.toContain("enum4linux -a");
    expect(prompt).not.toContain("10.10.11.5");
    expect(prompt).not.toContain("SECRET_ADMIN_PASS_HINT");
    expect(prompt).not.toContain("microsoft-ds");
    expect(prompt).not.toContain("winrm");
    expect(prompt).not.toContain("output_digest");
    expect(prompt).not.toContain("445/tcp");

    // only the compact, non-sensitive fields are present
    expect(prompt).toContain("enumerate_smb");
    expect(prompt).toMatch(/verdict=\w+/);
    expect(prompt).toMatch(/unlock_seq=(\d+|null)/);
    expect(prompt).toMatch(/actual_seq=(\d+|null)/);
    expect(prompt).toMatch(/lag_ms=\d+/);
  });

  it("adopts a model note when the provider returns one, keyed by objective", async () => {
    const ghost = sampleGhost();
    const provider = new CapturingProvider({ notes: [{ objective: "enumerate_smb", note: "You found the door early but knocked on the wrong ones first." }] });
    const out = await narrateGhost(ghost, provider);
    expect(out.items.find((i) => i.objective === "enumerate_smb")!.note).toBe("You found the door early but knocked on the wrong ones first.");
    expect(out).not.toBe(ghost); // a new object comes back
  });

  it("keeps the deterministic note when the model returns an empty note list", async () => {
    const ghost = sampleGhost();
    const provider = new CapturingProvider({ notes: [] });
    const out = await narrateGhost(ghost, provider);
    expect(out).toBe(ghost);
    expect(out.items[0].note).toBe(ghost.items[0].note);
  });

  it("keeps the deterministic note when the model returns malformed/garbage output", async () => {
    const ghost = sampleGhost();
    for (const bad of [{ nonsense: true }, "just a string", 42, [], { notes: [{ objective: "enumerate_smb", note: "" }] }, { notes: [{ objective: 5, note: 5 }] }]) {
      const out = await narrateGhost(ghost, new CapturingProvider(bad));
      expect(out.items[0].note).toBe(ghost.items[0].note);
    }
  });

  it("does not mutate the input result", async () => {
    const ghost = sampleGhost();
    const before = JSON.stringify(ghost);
    const provider = new CapturingProvider({ notes: [{ objective: "enumerate_smb", note: "a different note entirely" }] });
    await narrateGhost(ghost, provider);
    expect(JSON.stringify(ghost)).toBe(before);
  });

  it("is a no-op on an empty item list", async () => {
    const empty: GhostResult = { time_lost_ms: 0, human_wins: 0, items: [] };
    const provider = new CapturingProvider({ notes: [] });
    const out = await narrateGhost(empty, provider);
    expect(out).toBe(empty);
    expect(provider.prompts.length).toBe(0);
  });
});
