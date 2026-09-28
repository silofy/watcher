import { describe, it, expect } from "vitest";
import { captureSource } from "./capture-source";
import type { Session } from "../types/report";

const s = (over: Partial<Session>): Session =>
  ({ uuid: "u", started_at: "", ended_at: "", target_scope: "", shell: "", source: "plugin", ...over }) as Session;

describe("captureSource", () => {
  it("identifies each adapter by its shell", () => {
    expect(captureSource(s({ shell: "claude-code" })).key).toBe("claude-code");
    expect(captureSource(s({ shell: "http-proxy" })).key).toBe("http-proxy");
    expect(captureSource(s({ shell: "sysmon" })).key).toBe("sysmon");
  });

  it("falls back to context_path when the shell is generic", () => {
    expect(captureSource(s({ shell: "bash", context_path: "web:burp" })).key).toBe("http-proxy");
    expect(captureSource(s({ shell: "pwsh", context_path: "edr:sysmon" })).key).toBe("sysmon");
  });

  it("labels the built-in sources and defaults unknown plugins", () => {
    expect(captureSource(s({ source: "local_pty", shell: "bash", context_path: "host" })).label).toBe("Local terminal");
    expect(captureSource(s({ source: "in_vm_daemon", shell: "bash" })).label).toBe("Pwnbox / VM");
    expect(captureSource(s({ source: "plugin", shell: "", context_path: "" })).label).toBe("Plugin");
  });

  it("gives every source a distinct label, color, and hint", () => {
    const keys = ["claude-code", "http-proxy", "sysmon", "local_pty"];
    const badges = keys.map((k) => captureSource(s(k === "local_pty" ? { source: "local_pty", shell: "bash", context_path: "host" } : { shell: k })));
    expect(new Set(badges.map((b) => b.label)).size).toBe(4);
    expect(new Set(badges.map((b) => b.color)).size).toBe(4);
    for (const b of badges) expect(b.hint.length).toBeGreaterThan(0);
  });
});
