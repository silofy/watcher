/**
 * A canonical offensive-methodology golden for runs that arrive WITHOUT an authored
 * golden DAG (imports: Sysmon, Claude Code transcripts, a raw PTY capture). It is a
 * fixed reference ladder — the standard beats of a host engagement — so a run is
 * graded against a methodology it did not define, and skipping a phase (e.g. never
 * auditing SMB shares, never enumerating for privesc) costs real coverage. It is
 * NOT derived from the run itself, which would score 100% trivially.
 *
 * Objectives align by tactic + tool (see pipeline/align.ts), so each `satisfied_by`
 * lists the common tools for that beat across platforms. A scenario-specific golden
 * (from a write-up) always beats this when available; this is the floor so an
 * import still gets a meaningful coverage number instead of 0%.
 *
 * Web (HTTP-proxy) runs need their own rubric — the "binary" of a web episode is the
 * HTTP method, not a tool — so this returns no golden for them (documented gap).
 */
import type { GoldenObjective, WatcherReport } from "../../types/report";

/** Standard host engagement ladder: recon → access → orient → privesc → root. */
export const HOST_METHODOLOGY: GoldenObjective[] = [
  { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap", "rustscan", "masscan", "nc", "ncat"], depends_on: [] },
  { objective: "enumerate_web_content", tactic: "TA0007", satisfied_by: ["gobuster", "ffuf", "feroxbuster", "dirb", "dirbuster", "nikto", "whatweb", "wfuzz", "curl", "wget"], depends_on: ["enumerate_services"] },
  { objective: "enumerate_smb_shares", tactic: "TA0007", satisfied_by: ["smbclient", "smbmap", "crackmapexec", "cme", "netexec", "nxc", "enum4linux", "enum4linux-ng", "rpcclient", "nmblookup"], depends_on: ["enumerate_services"] },
  { objective: "get_foothold", tactic: "TA0002", satisfied_by: ["nc", "ncat", "curl", "wget", "python", "python3", "bash", "sh", "powershell", "pwsh", "msfconsole", "ssh", "evil-winrm", "smbclient"], depends_on: ["enumerate_services"] },
  { objective: "situational_awareness", tactic: "TA0004", satisfied_by: ["whoami", "id", "hostname", "uname", "ipconfig", "systeminfo", "arch"], depends_on: ["get_foothold"] },
  { objective: "enumerate_privesc", tactic: "TA0004", satisfied_by: ["sudo", "find", "ls", "cat", "getcap", "linpeas", "linpeas.sh", "pspy", "pspy64", "winpeas", "winpeas.exe", "powerup", "ss", "netstat", "crontab"], depends_on: ["situational_awareness"] },
  { objective: "escalate_to_root", tactic: "TA0004", satisfied_by: ["su", "sudo", "ssh", "systemctl", "docker", "python", "python3", "bash", "gcc", "chmod", "msfconsole", ".rootbash"], depends_on: ["enumerate_privesc"] },
];

/** True when the run is predominantly web traffic (needs a web rubric, not this one). */
function isWebRun(report: WatcherReport): boolean {
  if ((report.session?.context_path ?? "").toLowerCase().startsWith("web")) return true;
  const eps = report.episodes ?? [];
  if (!eps.length) return false;
  const web = eps.filter((e) => (e.context_path ?? "").toLowerCase().startsWith("web")).length;
  return web / eps.length > 0.5;
}

/**
 * The fallback golden for a run with none authored. Returns the host methodology
 * ladder for host-context runs, and [] for web runs (their rubric is a follow-up).
 */
export function methodologyGolden(report: WatcherReport): GoldenObjective[] {
  if (isWebRun(report)) return [];
  return HOST_METHODOLOGY.map((o) => ({ ...o }));
}
