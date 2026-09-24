import { describe, it, expect } from "vitest";
import { matchTemplate, SEV_RANK } from "./library";

describe("matchTemplate", () => {
  it("matches a seeded CVE", () => {
    const t = matchTemplate({ cve: "CVE-2026-4480" });
    expect(t?.severity).toBe("critical");
    expect(t?.title).toMatch(/print/i);
    expect(t?.remediation.length).toBeGreaterThan(0);
  });

  it("matches a privesc vector", () => {
    const t = matchTemplate({ vector: "systemd" });
    expect(t).not.toBeNull();
    expect(t?.cwe).toMatch(/^CWE-/);
  });

  it("matches a CWE", () => {
    expect(matchTemplate({ cwe: "CWE-78" })?.severity).toBe("critical");
  });

  it("prefers cve over vector over cwe, and returns null for unknowns", () => {
    expect(matchTemplate({ cve: "CVE-0000-0000" })).toBeNull();
    expect(matchTemplate({ vector: "nfs", cwe: "CWE-78" })?.cwe).not.toBe("CWE-78"); // vector wins
    expect(matchTemplate({})).toBeNull();
  });

  it("SEV_RANK orders critical highest, unset last", () => {
    expect(SEV_RANK.critical).toBeLessThan(SEV_RANK.high);
    expect(SEV_RANK.unset).toBeGreaterThan(SEV_RANK.info);
  });
});
