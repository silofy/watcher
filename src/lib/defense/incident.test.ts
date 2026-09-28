import { describe, it, expect } from "vitest";
import { deriveIncident } from "./incident";
import type { WatcherReport } from "../../types/report";

const attacker = {
  session: { target_scope: "HTB :: Abducted", target: { name: "Abducted" } },
  episodes: [
    { seq: 7, cmd: "echo 'x' > '|bash'", binary: "echo", tactic: "TA0002", technique: "T1059", output_digest: "payload written; CVE-2026-4480", frameworks: { ukc: "execution" }, started_at_ms: 1000 },
    { seq: 25, cmd: "echo -e '[Service]' > /etc/systemd/system/smbd.service.d/override.conf", binary: "echo", tactic: "TA0004", technique: "T1543", output_digest: "drop-in written", frameworks: { ukc: "privilege-escalation" }, started_at_ms: 2000 },
    { seq: 11, cmd: "whoami", binary: "whoami", tactic: "TA0004", technique: "T1033", output_digest: "nobody", frameworks: { ukc: "privilege-escalation" }, started_at_ms: 1500 },
  ],
  findings: [{ id: "vuln:CVE-2026-4480", kind: "vuln", value: "CVE-2026-4480", source_seq: 7 }],
  phases: [],
  golden_dag: [],
} as unknown as WatcherReport;

describe("deriveIncident", () => {
  it("turns malicious steps into weighted artifacts with discriminating indicators", () => {
    const inc = deriveIncident(attacker);
    // a generic-only command (whoami) is not its own artifact
    expect(inc.artifacts.some((a) => a.source_seq === 11)).toBe(false);
    const injection = inc.artifacts.find((a) => a.source_seq === 7)!;
    expect(injection.phase).toBe("execution");
    expect(injection.indicators).toContain("CVE-2026-4480");
    const persist = inc.artifacts.find((a) => a.source_seq === 25)!;
    expect(persist.indicators).toContain("override.conf");
    // higher-value phase carries more weight than a low one
    expect(persist.weight).toBeGreaterThan(0);
    // artifacts are ordered by seq and chained
    expect(inc.artifacts.map((a) => a.source_seq)).toEqual([7, 25]);
    expect(inc.artifacts[1].depends_on).toContain(inc.artifacts[0].id);
  });
});
