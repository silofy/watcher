import { describe, it, expect } from "vitest";
import { extractFindings } from "./findings";
import { redactText } from "../redact";
import type { Episode } from "../../types/report";

const ep = (over: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "", duration_ms: 0, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...over });

describe("extractFindings", () => {
  const eps: Episode[] = [
    ep({ seq: 0, cmd: "nmap -sV 10.129.1.1", binary: "nmap", tactic: "TA0007", output_digest: "80/tcp open http Apache 2.4\n445/tcp open microsoft-ds" }),
    ep({ seq: 1, cmd: "curl http://10.129.1.1:80/admin", binary: "curl", tactic: "TA0007", output_digest: "200 OK" }),
    ep({ seq: 2, cmd: "cat root.txt", binary: "cat", tactic: "TA0004", output_digest: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" }),
  ];

  it("extracts ports with source_seq", () => {
    const f = extractFindings(eps, "full");
    const port = f.find((x) => x.id === "port:80-tcp");
    expect(port).toMatchObject({ kind: "port", value: "80/tcp", source_seq: 0 });
  });
  it("links a finding to the later episode that consumed it (used_by_seq)", () => {
    const f = extractFindings(eps, "full");
    const port80 = f.find((x) => x.id === "port:80-tcp")!;
    expect(port80.used_by_seq).toContain(1); // curl ...:80 consumed it
  });
  it("marks an observed flag proven and masks it under public_safe", () => {
    const full = extractFindings(eps, "full").find((x) => x.kind === "flag");
    expect(full?.proven).toBe(true);
    const safe = extractFindings(eps, "public_safe").find((x) => x.kind === "flag");
    expect(safe?.masked).toBe(true);
    expect(safe?.value).not.toContain("a1b2c3d4");
  });
  it("is deterministic", () => {
    expect(extractFindings(eps, "full")).toEqual(extractFindings(eps, "full"));
  });

  it("does not link port:80 to :8080, a decimal-octet host, or a bare numeric arg (precise port match)", () => {
    const negEps: Episode[] = [
      ep({ seq: 0, cmd: "nmap -sV 10.129.1.1", binary: "nmap", tactic: "TA0007", output_digest: "80/tcp open http Apache 2.4" }),
      ep({ seq: 1, cmd: "curl http://10.129.1.1:8080/", binary: "curl", tactic: "TA0007" }),
      ep({ seq: 2, cmd: "ping 10.10.10.80", binary: "ping", tactic: "TA0007" }),
      ep({ seq: 3, cmd: "sleep 80", binary: "sleep", tactic: "TA0007" }),
    ];
    const f = extractFindings(negEps, "full");
    const port80 = f.find((x) => x.id === "port:80-tcp")!;
    expect(port80.used_by_seq).toEqual([]);
  });

  it("still links port:80 to a later command that references it as a real port (:80 non-digit boundary)", () => {
    const posEps: Episode[] = [
      ep({ seq: 0, cmd: "nmap -sV 10.129.1.1", binary: "nmap", tactic: "TA0007", output_digest: "80/tcp open http Apache 2.4" }),
      ep({ seq: 1, cmd: "curl http://10.129.1.1:80/admin", binary: "curl", tactic: "TA0007" }),
    ];
    const f = extractFindings(posEps, "full");
    const port80 = f.find((x) => x.id === "port:80-tcp")!;
    expect(port80.used_by_seq).toContain(1);
  });

  it("recognizes the [redacted-flag] sentinel as a proven flag observation (real ingest path)", () => {
    // Mirrors envelopesToRawCommands: redactText runs on output_digest before extractFindings ever
    // sees it, so a genuinely captured 32-hex flag arrives here already scrubbed to the sentinel.
    const rawFlag = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
    const digest = redactText(rawFlag);
    expect(digest).toBe("[redacted-flag]"); // sanity: confirms the sentinel this test exercises

    const redactedEps: Episode[] = [ep({ seq: 0, cmd: "cat root.txt", binary: "cat", tactic: "TA0004", output_digest: digest })];
    const flag = extractFindings(redactedEps, "full").find((x) => x.kind === "flag");
    expect(flag?.proven).toBe(true);
    expect(flag?.id).toBe("flag:root");
    expect(flag?.value).not.toContain(rawFlag);
    expect(flag?.value).toBe("[redacted-flag]");
  });
});
