import { describe, it, expect } from "vitest";
import { headerSection, findingsSection, walkthroughSection, appendixSection, severityLabel } from "./sections";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("sections", () => {
  it("header names the target and states redaction", () => {
    const h = headerSection(report);
    expect(h).toContain("# Abducted");
    expect(h.toLowerCase()).toContain("redact");
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
});
