import { describe, it, expect } from "vitest";
import { assembleDefenseReport } from "./assemble";
import type { WatcherReport } from "../../types/report";

const attacker = {
  session: { target_scope: "HTB :: Abducted", target: { name: "Abducted" }, source: "plugin", shell: "sysmon" },
  episodes: [
    { seq: 7, cmd: "smbclient print '|bash' override.conf", binary: "smbclient", tactic: "TA0002", technique: "T1059", output_digest: "CVE-2026-4480", frameworks: { ukc: "execution" }, started_at_ms: 1000 },
  ],
  findings: [{ id: "vuln:CVE-2026-4480", kind: "vuln", value: "CVE-2026-4480", source_seq: 7 }],
  phases: [], golden_dag: [],
} as unknown as WatcherReport;

const run = {
  session: { target_scope: "Investigation", source: "plugin", shell: "claude-code", started_at: "2026-09-28T00:00:00Z", uuid: "r" },
  episodes: [{ seq: 1, cmd: "grep CVE-2026-4480 /var/log/samba", binary: "grep", started_at_ms: 0, output_digest: "found CVE-2026-4480" }],
  findings: [], phases: [], golden_dag: [],
} as unknown as WatcherReport;

describe("assembleDefenseReport", () => {
  it("produces a defense report the debrief can read", () => {
    const rep = assembleDefenseReport(attacker, run);
    expect(rep.mode).toBe("defense");
    expect(rep.incident.artifacts.length).toBeGreaterThan(0);
    expect(rep.grade.letter).toMatch(/[A-F]/);
    expect(rep.ghost.items.length).toBe(rep.incident.artifacts.length);
    expect(rep.session.shell).toBe("claude-code"); // the analyst run's session drives the badge
  });
});
