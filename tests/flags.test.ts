import { describe, it, expect } from "vitest";
import { detectFlags } from "../src/lib/flags";
import type { Episode } from "../src/types/report";

const ep = (seq: number, cmd: string, output_digest = ""): Episode =>
  ({ seq, cmd, binary: cmd.split(" ")[0] ?? "", duration_ms: 0, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0002", output_digest }) as Episode;

describe("detectFlags", () => {
  it("detects user + system flags captured in one read", () => {
    const f = detectFlags([ep(1, "nmap -oN nmap.txt 10.10.10.5"), ep(29, "cat /root/root.txt; cat /home/u/user.txt", "root and user flags captured")]);
    expect(f.user).toBe(29);
    expect(f.system).toBe(29);
    expect(f.events).toHaveLength(1);
    expect(f.events[0].kinds.sort()).toEqual(["system", "user"]);
  });

  it("ignores non-flag .txt files (wordlists, scan output, cookies)", () => {
    const f = detectFlags([ep(1, "gobuster dir -w common.txt"), ep(2, "hydra -P rockyou.txt host"), ep(3, "curl -c c.txt host")]);
    expect(f.user).toBeNull();
    expect(f.system).toBeNull();
  });

  it("classifies user vs system separately, first occurrence wins", () => {
    const f = detectFlags([ep(5, "cat user.txt", "[redacted-flag]"), ep(8, "cat user.txt"), ep(20, "type C:\\Users\\Administrator\\Desktop\\root.txt", "[redacted-flag]")]);
    expect(f.user).toBe(5);
    expect(f.system).toBe(20);
  });

  it("requires a read or flag-shaped output, not a write/mention", () => {
    const f = detectFlags([ep(1, "echo done > root.txt"), ep(2, "ls -la /root/root.txt")]);
    expect(f.system).toBeNull();
  });
});
