import { describe, it, expect } from "vitest";
// @ts-expect-error — plain-JS module shipped as-is in the extension
import { classifyHtbActivity, toSessionControl, redact, wsFrameToEnvelope } from "./detect.js";

describe("classifyHtbActivity — the HTB session triggers (real v4 API)", () => {
  it("detects a VIP spawn (POST /vm/spawn {machine_id})", () => {
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v4/vm/spawn", "POST", { machine_id: 233 });
    expect(sig).toMatchObject({ kind: "spawn", machine_id: 233 });
  });
  it("detects a free-VPN spawn (POST /machine/play/{id})", () => {
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v4/machine/play/478", "POST", null);
    expect(sig).toMatchObject({ kind: "spawn", machine_id: 478 });
  });
  it("detects a stop/terminate", () => {
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v4/vm/terminate", "POST", '{"machine_id":233}');
    expect(sig).toMatchObject({ kind: "stop", machine_id: 233 });
  });
  it("enriches from active, absolutizing the relative avatar", () => {
    const body = { info: { id: 233, name: "Optimum", avatar: "/storage/avatars/4aee57.png", ip: "10.10.10.8" } };
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v4/machine/active", "GET", body);
    expect(sig).toMatchObject({ kind: "active", machine_id: 233, name: "Optimum", ip: "10.10.10.8" });
    expect(sig!.avatar).toBe("https://labs.hackthebox.com/storage/avatars/4aee57.png");
  });
  it("enriches OS + difficulty from the profile endpoint", () => {
    const body = { info: { id: 233, name: "Optimum", os: "Windows", difficultyText: "Easy" } };
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v4/machine/profile/optimum", "GET", body);
    expect(sig).toMatchObject({ kind: "profile", os: "Windows", difficulty: "Easy" });
  });
  it("ignores unrelated API calls", () => {
    expect(classifyHtbActivity("https://labs.hackthebox.com/api/v4/user/info", "GET", {})).toBeNull();
  });
});

describe("classifyHtbActivity — HTB's v5 /virtual_machine API (the current platform)", () => {
  it("detects a v5 spawn", () => {
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v5/virtual_machine/spawn", "POST", { machine_id: 909 });
    expect(sig).toMatchObject({ kind: "spawn", machine_id: 909 });
  });
  it("detects a v5 terminate", () => {
    const sig = classifyHtbActivity("https://labs.hackthebox.com/api/v5/virtual_machine/terminate", "POST", { machine_id: 909 });
    expect(sig).toMatchObject({ kind: "stop", machine_id: 909 });
  });
  it("treats a running v5 active poll as authoritative presence (unwraps info/data/flat)", () => {
    const wrapped = classifyHtbActivity("https://labs.hackthebox.com/api/v5/virtual_machine/active", "GET", {
      info: { id: 909, name: "Checkpoint", os: "Windows", difficultyText: "Medium", ip: "10.129.14.251" },
    });
    expect(wrapped).toMatchObject({ kind: "active", machine_id: 909, name: "Checkpoint", os: "Windows", difficulty: "Medium", ip: "10.129.14.251" });
    const flat = classifyHtbActivity("https://labs.hackthebox.com/api/v5/virtual_machine/active", "GET", { id: 909, name: "Checkpoint" });
    expect(flat).toMatchObject({ kind: "active", machine_id: 909, name: "Checkpoint" });
  });
  it("reports an empty active slot as inactive (machine stopped)", () => {
    expect(classifyHtbActivity("https://labs.hackthebox.com/api/v5/virtual_machine/active", "GET", { info: null })).toMatchObject({ kind: "inactive" });
    expect(classifyHtbActivity("https://labs.hackthebox.com/api/v5/virtual_machine/active", "GET", {})).toMatchObject({ kind: "inactive" });
  });
});

describe("toSessionControl — maps triggers to session lifecycle", () => {
  it("spawn → session_start with the machine hero (name, avatar, os, difficulty)", () => {
    const ctrl = toSessionControl({ kind: "spawn", machine_id: 233, name: "Optimum", avatar: "https://h/o.png", os: "Windows", difficulty: "Easy" });
    expect(ctrl).toMatchObject({ kind: "session_start", target_scope: "Optimum", context_path: "cloud:htb" });
    expect(ctrl!.machine).toMatchObject({ name: "Optimum", avatar: "https://h/o.png", os: "Windows", difficulty: "Easy" });
  });
  it("falls back to a machine id when the name is unknown", () => {
    expect(toSessionControl({ kind: "spawn", machine_id: 7 }).target_scope).toBe("HTB machine 7");
  });
  it("stop → session_end", () => {
    expect(toSessionControl({ kind: "stop", machine_id: 233 })).toMatchObject({ kind: "session_end", reason: "machine_stopped" });
  });
  it("active is enrichment, not a control event", () => {
    expect(toSessionControl({ kind: "active", machine_id: 1 })).toBeNull();
  });
});

describe("redact — client-side masking before anything leaves the page", () => {
  it("masks IPs, flags, and credentials", () => {
    expect(redact("ssh root@10.10.10.8")).toBe("ssh root@x.x.x.x");
    expect(redact("root.txt: 0123456789abcdef0123456789abcdef")).toContain("[redacted-flag]");
    expect(redact("password=hunter2")).toBe("password=[redacted]");
  });
});

describe("wsFrameToEnvelope — tapped terminal frame → §3.3 envelope", () => {
  const ctx = { session_uuid: "u", seq: 5, ts_utc_us: 1000, platform: "ttyd" };
  it("stdout frames become redacted output with inferred-boundary confidence", () => {
    const e = wsFrameToEnvelope("connected to 10.10.10.8", "in", ctx);
    expect(e).toMatchObject({ source: "browser_ext", kind: "output" });
    expect(e.payload.text).toBe("connected to x.x.x.x");
    expect(e.provenance.boundary_confidence).toBeLessThan(1);
    expect(e.provenance.redaction_method).toBe("regex");
  });
  it("user keystrokes become input", () => {
    expect(wsFrameToEnvelope("whoami\r", "out", ctx).kind).toBe("input");
  });
});
