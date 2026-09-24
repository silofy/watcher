import { describe, it, expect } from "vitest";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("deriveReportFindings (Abducted fixture)", () => {
  const findings = deriveReportFindings(report);

  it("derives exactly the two source-backed findings", () => {
    const ids = findings.map((f) => f.id).sort();
    expect(ids).toEqual(["cve-cve-2026-4480", "vector-systemd"]);
  });

  it("orders by severity (both critical here) then evidence seq", () => {
    expect(findings[0].severity).toBe("critical");
    expect(findings.every((f) => f.severity !== "unset")).toBe(true);
  });

  it("attaches evidence and reproduction from real episodes", () => {
    const priv = findings.find((f) => f.id === "vector-systemd")!;
    expect(priv.evidence[0].seq).toBe(24);
    expect(priv.evidence[0].cmd).toContain("smbd.service.d");
    expect(priv.reproduction.length).toBeGreaterThan(0);
    expect(priv.cwe).toBe("CWE-732");
  });

  it("uses the target name as affected", () => {
    expect(findings[0].affected).toBe("Abducted");
  });
});

describe("deriveReportFindings fallback", () => {
  it("emits an unset-severity finding for a source weakness the library doesn't know", () => {
    const r = {
      session: { target: { name: "Box" }, target_scope: "HTB :: Box" },
      episodes: [{ seq: 1, cmd: "searchsploit foo", binary: "searchsploit", tactic: "TA0001", output_digest: "CVE-1999-9999 found", duration_ms: 0, gap_before_ms: 0, actor: "human_active" }],
      findings: [{ id: "vuln:CVE-1999-9999", kind: "vuln", value: "CVE-1999-9999", source_seq: 1, used_by_seq: [] }],
      phases: [], metrics: {}, golden_dag: [],
    } as unknown as WatcherReport;
    const f = deriveReportFindings(r);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("unset");
    expect(f[0].cve).toBe("CVE-1999-9999");
  });
});
