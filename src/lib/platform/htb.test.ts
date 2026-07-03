import { describe, it, expect } from "vitest";
import { htbAdapter } from "./htb";
import { resolveAdapter } from "./index";

describe("htbAdapter", () => {
  it("identifies an HTB box from machine metadata", () => {
    const t = htbAdapter.identify({ name: "Forge", os: "Linux", difficulty: "Medium", avatar: "https://cdn/forge.png" }, {});
    expect(t.platform).toBe("htb");
    expect(t.kind).toBe("box");
    expect(t.name).toBe("Forge");
    expect(t.os).toBe("Linux");
    expect(t.difficulty).toEqual({ level: 2, label: "Medium" });
    expect(t.emblem?.avatar).toBe("https://cdn/forge.png");
    expect(t.url).toContain("hackthebox.com");
  });
  it("falls back to parsing target_scope when machine is absent", () => {
    const t = htbAdapter.identify(undefined, { targetScope: "HTB::Forge (Medium)" });
    expect(t.name).toBe("Forge");
    expect(t.difficulty?.label).toBe("Medium");
  });
  it("detects HTB from a pwnbox context path", () => {
    expect(htbAdapter.detect({ contextPath: "cloud:htb:pwnbox" })).toBeGreaterThanOrEqual(0.9);
  });
});

describe("resolveAdapter", () => {
  it("resolves HTB for a pwnbox context", () => {
    expect(resolveAdapter({ contextPath: "cloud:htb:pwnbox" }).id).toBe("htb");
  });
  it("resolves the 10.10.10.x overlap to HTB when contextPath says htb", () => {
    expect(resolveAdapter({ contextPath: "cloud:htb", targetScope: "box 10.10.10.5" }).id).toBe("htb");
  });
  it("resolves THM for a THM:: scope", () => {
    expect(resolveAdapter({ targetScope: "THM::Blue (Easy)" }).id).toBe("thm");
  });
  it("falls back to local for a bare scope", () => {
    expect(resolveAdapter({ targetScope: "just a hostname" }).id).toBe("local");
  });
});
