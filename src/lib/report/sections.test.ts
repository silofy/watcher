import { describe, it, expect } from "vitest";
import { headerSection, findingsSection, walkthroughSection, appendixSection, severityLabel } from "./sections";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("sections", () => {
  it("header names the target and warns of unredacted detail under the full profile", () => {
    expect(report.redaction_profile).toBe("full");
    const h = headerSection(report);
    expect(h).toContain("# Abducted");
    expect(h).toMatch(/do not share/i);
    expect(h).not.toMatch(/are masked/i);
  });

  it("header states a masked-for-sharing guarantee under the public_safe profile", () => {
    const publicSafeReport: WatcherReport = { ...report, redaction_profile: "public_safe" };
    const h = headerSection(publicSafeReport);
    expect(h).toMatch(/masked/i);
    expect(h).not.toMatch(/do not share/i);
  });

  it("findings section has one ### entry per finding with the required fields", () => {
    const findings = deriveReportFindings(report);
    const md = findingsSection(findings);
    expect((md.match(/^### /gm) || []).length).toBe(findings.length);
    expect(md).toContain("**Severity**");
    expect(md).toContain("**Steps to reproduce**");
    expect(md).toContain("**Remediation**");
  });

  it("walkthrough groups by phase label", () => {
    expect(walkthroughSection(report)).toContain("Privilege Escalation");
  });

  it("severityLabel maps unset to a placeholder", () => {
    expect(severityLabel("unset")).toMatch(/set severity/i);
    expect(severityLabel("critical")).toMatch(/critical/i);
  });

  it("does not leak a raw flag — only the sentinel", () => {
    const md = appendixSection(report) + findingsSection(deriveReportFindings(report));
    expect(md).not.toMatch(/HTB\{[^}]/); // no real flag body
  });

  it("appendix ledger masks cred/hash regardless of masked flag", () => {
    const testReport: WatcherReport = {
      ...report,
      findings: [
        { id: "test-cred", kind: "cred", value: "password=SuperSecret1", source_seq: 1, masked: false },
        { id: "test-port", kind: "port", value: "22", source_seq: 1 },
      ],
    };
    const appendix = appendixSection(testReport);
    expect(appendix).toContain("••••"); // credential is masked
    expect(appendix).not.toContain("SuperSecret1"); // raw secret does not appear
    expect(appendix).toContain("22"); // port value appears unmasked
  });
});
