import { describe, it, expect } from "vitest";
import { analyzePrivesc } from "./privesc";
import type { WatcherReport, Episode, Finding } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "x", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004", ...o });
const rep = (episodes: Episode[], findings: Finding[] = []): WatcherReport => ({
  schema_version: "1.4", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:20:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: [], findings,
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

const byId = (r: ReturnType<typeof analyzePrivesc>, id: string) => r.paths.find((p) => p.id === id);

describe("analyzePrivesc — rulebook", () => {
  it("confirms a SUID GTFOBins binary from a `find -perm /4000` sweep (RootMe pattern)", () => {
    // The real THM RootMe demo line: bare-path output from a SUID sweep.
    const r = analyzePrivesc(rep([ep({ seq: 5, cmd: "find / -user root -perm /4000 2>/dev/null", output_digest: "/usr/bin/python — the one non-standard entry alongside the usual passwd/su/sudo/mount SUID set" })]));
    const p = byId(r, "suid:python");
    expect(p).toBeTruthy();
    expect(p!.severity).toBe("confirmed");
    expect(p!.abuse).toMatch(/os\.setuid\(0\)/);
    expect(p!.ref).toContain("gtfobins.github.io/gtfobins/python");
    expect(r.confirmed).toBe(1);
  });

  it("confirms a group-writable systemd drop-in dir (HTB Abducted pattern)", () => {
    const r = analyzePrivesc(rep([ep({ seq: 9, cmd: "ls -ld /etc/systemd/system/smbd.service.d/", output_digest: "drwxrwxr-x 2 root operators 4096 ... — group-writable by operators" })]));
    const p = r.paths.find((x) => x.vector === "systemd");
    expect(p).toBeTruthy();
    expect(p!.severity).toBe("confirmed");
    expect(p!.abuse).toMatch(/ExecStart/);
  });

  it("parses a perm-prefixed SUID listing and tags SUID vs SGID by the right bit", () => {
    const out = "-rwsr-xr-x 1 root root 1183448 /usr/bin/find\n-rwxr-sr-x 1 root shadow 44016 /usr/bin/passwd";
    const r = analyzePrivesc(rep([ep({ seq: 2, cmd: "ls -la /usr/bin", output_digest: out })]));
    expect(byId(r, "suid:find")!.severity).toBe("confirmed");
    expect(r.paths.some((p) => p.vector === "sgid" && p.id === "sgid:passwd")).toBe(false); // passwd has no SGID rulebook entry -> not emitted
  });

  it("reads a sudo -l NOPASSWD grant and maps it to a GTFOBins sudo escape", () => {
    const r = analyzePrivesc(rep([ep({ seq: 3, cmd: "sudo -l", output_digest: "User www-data may run the following commands: (ALL) NOPASSWD: /usr/bin/vim" })]));
    const p = byId(r, "sudo:vim");
    expect(p!.severity).toBe("confirmed");
    expect(p!.abuse).toMatch(/:!\/bin\/sh/);
  });

  it("flags full `(ALL : ALL) ALL` sudo as an instant confirmed root", () => {
    const r = analyzePrivesc(rep([ep({ seq: 1, cmd: "sudo -l", output_digest: "(ALL : ALL) ALL" })]));
    expect(byId(r, "sudo:ALL")!.severity).toBe("confirmed");
  });

  it("confirms a cap_setuid capability on a shell-capable binary", () => {
    const r = analyzePrivesc(rep([ep({ seq: 4, cmd: "getcap -r / 2>/dev/null", output_digest: "/usr/bin/python3.11 = cap_setuid+ep" })]));
    const p = r.paths.find((x) => x.vector === "cap");
    expect(p!.severity).toBe("confirmed");
    expect(p!.id).toBe("cap:python3:cap_setuid");
  });

  it("confirms docker group membership as a direct root path, sudo group only as likely", () => {
    const r = analyzePrivesc(rep([ep({ seq: 0, cmd: "id", output_digest: "uid=1000(scott) gid=1000(scott) groups=1000(scott),998(docker),27(sudo)" })]));
    expect(byId(r, "group:docker")!.severity).toBe("confirmed");
    expect(byId(r, "group:sudo")!.severity).toBe("likely");
  });

  it("confirms a writable /etc/passwd", () => {
    const r = analyzePrivesc(rep([ep({ seq: 6, cmd: "find / -writable 2>/dev/null", output_digest: "/etc/passwd is writable by current user" })]));
    expect(byId(r, "writable:/etc/passwd")!.severity).toBe("confirmed");
  });

  it("matches a kernel version to DirtyPipe as a LIKELY (not confirmed) path", () => {
    const r = analyzePrivesc(rep([ep({ seq: 2, cmd: "uname -a", output_digest: "Linux target 5.13.0-39-generic #44-Ubuntu SMP x86_64 GNU/Linux" })]));
    const p = r.paths.find((x) => x.vector === "kernel-cve");
    expect(p!.title).toMatch(/DirtyPipe/);
    expect(p!.severity).toBe("likely");
  });

  it("matches a sudo version to Baron Samedit", () => {
    const r = analyzePrivesc(rep([ep({ seq: 2, cmd: "sudo --version", output_digest: "Sudo version 1.8.31" })]));
    expect(r.paths.some((p) => p.vector === "sudo-cve" && /Samedit/.test(p.title))).toBe(true);
  });

  it("does not match a patched sudo version outside every range", () => {
    const r = analyzePrivesc(rep([ep({ seq: 2, cmd: "sudo --version", output_digest: "Sudo version 1.9.15" })]));
    expect(r.paths.some((p) => p.vector === "sudo-cve" && /Samedit/.test(p.title))).toBe(false);
  });
});

describe("analyzePrivesc — the slow-line counterfactual", () => {
  it("flags when a confirmed path was on the table long before the run rooted by another vector", () => {
    const eps = [
      ep({ seq: 5, cmd: "sudo -l", output_digest: "(ALL) NOPASSWD: /usr/bin/find" }),   // confirmed path here
      ep({ seq: 6, cmd: "searchsploit kernel", alignment: "detour", output_digest: "nothing" }),
      ep({ seq: 7, cmd: "wget dirtypipe.c", alignment: "detour", output_digest: "nothing" }),
      ep({ seq: 8, cmd: "gcc dirtypipe.c -o e", exit_code: 1, output_digest: "compile error" }),
      ep({ seq: 9, cmd: "cat /root/root.txt", output_digest: "uid=0(root) gid=0(root)" }),  // rooted late after thrashing
    ];
    const r = analyzePrivesc(rep(eps));
    expect(r.first_confirmed_seq).toBe(5);
    expect(r.rooted_seq).toBe(9);
    expect(r.slow_line).toBeTruthy();
    expect(r.slow_line!.path.id).toBe("sudo:find");
  });

  it("does NOT flag a slow line when root came right after the path surfaced", () => {
    const eps = [
      ep({ seq: 5, cmd: "sudo -l", output_digest: "(ALL) NOPASSWD: /usr/bin/find" }),
      ep({ seq: 6, cmd: "sudo find . -exec /bin/sh \\; -quit", output_digest: "uid=0(root) gid=0(root)" }),
    ];
    const r = analyzePrivesc(rep(eps));
    expect(r.slow_line).toBeNull();
  });

  it("uses a proven root flag finding as the rooted_seq", () => {
    const eps = [ep({ seq: 5, cmd: "sudo -l", output_digest: "(ALL) NOPASSWD: /usr/bin/find" }), ep({ seq: 6, alignment: "detour" }), ep({ seq: 7, alignment: "detour" }), ep({ seq: 12, cmd: "cat /root/root.txt" })];
    const findings: Finding[] = [{ id: "flag:root", kind: "flag", value: "[redacted-flag]", source_seq: 12, proven: true }];
    const r = analyzePrivesc(rep(eps, findings));
    expect(r.rooted_seq).toBe(12);
    expect(r.slow_line?.rooted_seq).toBe(12);
  });
});

describe("analyzePrivesc — hygiene", () => {
  it("returns nothing on a run with no privesc signals", () => {
    const r = analyzePrivesc(rep([ep({ seq: 0, cmd: "nmap -sV target", output_digest: "22/tcp open ssh" })]));
    expect(r.paths).toEqual([]);
    expect(r.confirmed).toBe(0);
    expect(r.slow_line).toBeNull();
  });

  it("is deterministic and sorts confirmed paths before likely", () => {
    const eps = [
      ep({ seq: 2, cmd: "uname -a", output_digest: "Linux t 5.13.0-39-generic" }),                 // likely (kernel)
      ep({ seq: 3, cmd: "sudo -l", output_digest: "(ALL) NOPASSWD: /usr/bin/vim" }),               // confirmed
    ];
    const a = analyzePrivesc(rep(eps));
    const b = analyzePrivesc(rep(eps));
    expect(a).toEqual(b);
    expect(a.paths[0].severity).toBe("confirmed");
    expect(a.paths[a.paths.length - 1].severity).toBe("likely");
  });
});
