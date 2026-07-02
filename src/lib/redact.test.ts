import { describe, it, expect } from "vitest";
import fixture from "../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../types/report";
import { redactReport, redactText } from "./redact";

const report = fixture as unknown as WatcherReport;

describe("redactText", () => {
  it("masks IPv4 addresses", () => {
    expect(redactText("nmap 10.10.10.5")).toBe("nmap x.x.x.x");
  });
  it("masks flag hashes", () => {
    expect(redactText("flag: 0123456789abcdef0123456789abcdef")).toBe("flag: [redacted-flag]");
  });
  it("masks key=value credentials (mirrors watcher_core::redact)", () => {
    expect(redactText("mysql config: password=Winter2023!")).toBe("mysql config: password=[redacted]");
    expect(redactText("api_key: sk-live-abc123")).toBe("api_key=[redacted]");
    expect(redactText("token=eyJhbGciOi")).toBe("token=[redacted]");
  });
});

describe("redactReport public_safe", () => {
  const safe = redactReport(report, "public_safe");

  it("leaves the original untouched (deep clone)", () => {
    expect(report.episodes[0].cmd).toContain("10.10.10.5");
  });
  it("strips IPs from commands and digests", () => {
    const blob = JSON.stringify(safe.episodes);
    expect(blob).not.toMatch(/\b10\.10\.10\.5\b/);
    expect(blob).not.toMatch(/\b10\.10\.14\.7\b/);
  });
  it("sets the profile", () => {
    expect(safe.redaction_profile).toBe("public_safe");
  });
});

describe("redactReport full", () => {
  it("keeps detail", () => {
    const full = redactReport(report, "full");
    expect(full.episodes[0].cmd).toContain("10.10.10.5");
  });
});
