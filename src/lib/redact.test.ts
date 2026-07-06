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
  it("masks key=value credentials (mirrors watcher_core::redact_body)", () => {
    expect(redactText("mysql config: password=Winter2023!")).toBe("mysql config: password=[redacted]");
    expect(redactText("api_key: sk-live-abc123")).toBe("api_key=[redacted]");
    expect(redactText("token=eyJhbGciOi")).toBe("token=[redacted]");
  });

  it("bounds the keyword-secret capture at the param delimiter", () => {
    const out = redactText("token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig&user=admin");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("user=admin"); // trailing params must survive
  });

  it("masks JWT-shaped access tokens while preserving the param name", () => {
    const out = redactText("access=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_123&user=admin");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("access=");
    expect(out).toContain("user=admin");
  });

  it("masks Bearer tokens", () => {
    const out = redactText("Authorization was Bearer sk-live-abcdef0123456789 here");
    expect(out).not.toContain("sk-live-abcdef0123456789");
    expect(out).toMatch(/Bearer \[redacted\]|\[redacted-key\]/);
  });

  it("masks bare api-key shapes (sk-/pk-/ghp-/xox*-)", () => {
    expect(redactText("key is ghp_abcdefghij0123456789")).not.toContain("ghp_abcdefghij0123456789");
    expect(redactText("key is ghp_abcdefghij0123456789")).toContain("[redacted-key]");
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
