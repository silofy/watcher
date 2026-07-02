import { describe, it, expect } from "vitest";
import { parseSshTarget, formatSshTarget } from "../src/lib/pwnbox";

describe("pwnbox ssh target", () => {
  it("parses user@host", () => {
    expect(parseSshTarget("htb-user@10.10.14.5")).toEqual({ user: "htb-user", host: "10.10.14.5", port: undefined });
  });

  it("parses user@host:port", () => {
    expect(parseSshTarget("htb-user@10.10.14.5:2222")).toEqual({ user: "htb-user", host: "10.10.14.5", port: 2222 });
  });

  it("tolerates a leading 'ssh ' and whitespace", () => {
    expect(parseSshTarget("  ssh htb-user@box.htb  ")).toEqual({ user: "htb-user", host: "box.htb", port: undefined });
  });

  it("parses a bare host", () => {
    expect(parseSshTarget("10.10.14.5")).toEqual({ user: "", host: "10.10.14.5", port: undefined });
  });

  it("round-trips through format", () => {
    for (const t of ["htb-user@10.10.14.5", "htb-user@box.htb:2222"]) {
      expect(formatSshTarget(parseSshTarget(t))).toBe(t);
    }
    expect(formatSshTarget({ host: "", user: "", port: undefined })).toBe("");
  });
});
