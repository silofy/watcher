import { describe, it, expect } from "vitest";
import { ABDUCTED } from "./abducted";

describe("HTB Abducted demo", () => {
  it("grades to a real multi-phase report", () => {
    expect(ABDUCTED.platform).toBe("htb");
    expect(ABDUCTED.report.episodes.length).toBeGreaterThan(10);
    // the chain reaches privilege escalation
    expect(ABDUCTED.report.phases.some((p) => p.mitre_tactic === "TA0004")).toBe(true);
  });
  it("is redacted: no flag hash, no known credential, no live IP in any step", () => {
    const blob = ABDUCTED.raw.map((r) => `${r.cmd} ${r.output_digest ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\b[0-9a-f]{32}\b/i);        // 32-hex flag
    expect(blob).not.toContain("iXzvcib3SrpZ");           // the rclone-revealed password
    expect(blob).not.toMatch(/\b10\.129\.\d+\.\d+\b/);     // live lab IP
  });
});
