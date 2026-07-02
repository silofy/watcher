/**
 * MITRE ATT&CK technique id → human name, for the techniques surfaced in reports. Not exhaustive —
 * falls back to the bare id via `techniqueName`. Extend as new techniques get classified upstream.
 */
export const ATTACK_TECHNIQUES: Record<string, string> = {
  T1046: "Network Service Discovery",
  T1595: "Active Scanning",
  "T1595.003": "Wordlist Scanning",
  T1190: "Exploit Public-Facing Application",
  T1110: "Brute Force",
  T1059: "Command & Scripting Interpreter",
  T1033: "System Owner / User Discovery",
  T1068: "Exploitation for Privilege Escalation",
  T1057: "Process Discovery",
  T1083: "File & Directory Discovery",
  T1548: "Abuse Elevation Control Mechanism",
  "T1548.003": "Sudo and Sudo Caching",
};

export function techniqueName(id: string): string {
  return ATTACK_TECHNIQUES[id] ?? id;
}

/** One-line plain-English explanation per technique, for the hover card. Falls back to a generic line. */
export const ATTACK_TECHNIQUE_DESC: Record<string, string> = {
  T1046: "Enumerate the services and ports exposed on a host or network to map the attack surface (e.g. nmap).",
  T1595: "Probe the target directly — port/vuln scans, banner grabs, fuzzing — to gather info before exploiting it.",
  "T1595.003": "Brute-force hidden paths, files, or vhosts with a wordlist (directory busting) to find unlinked content.",
  T1190: "Abuse a vulnerability in an internet-facing app or service to gain a first foothold on the target.",
  T1110: "Guess credentials by trying many passwords or keys against an authentication mechanism.",
  T1059: "Run commands through a shell or interpreter (bash, PowerShell, python) — often to land a reverse shell.",
  T1033: "Identify the current user and their privileges after landing on a host (whoami, id).",
  T1068: "Exploit a flaw — kernel bug, vulnerable service, bad SUID binary — to gain higher privileges on the host.",
  T1057: "List running processes to spot privesc paths, credentials, or scheduled jobs (ps, pspy).",
  T1083: "Walk the filesystem for sensitive files, configs, SUID binaries, or leftover credentials.",
  T1548: "Abuse sudo, setuid, or a similar mechanism to execute with elevated privileges.",
  "T1548.003": "Leverage a misconfigured or cached sudo rule to run commands as root.",
};

export function techniqueDesc(id: string): string {
  return ATTACK_TECHNIQUE_DESC[id] ?? "A MITRE ATT&CK technique observed in this run. Open the reference for the full description.";
}

/** Canonical MITRE ATT&CK page for a technique (sub-techniques become /Txxxx/00n/). */
export function techniqueUrl(id: string): string {
  const [base, sub] = id.split(".");
  return `https://attack.mitre.org/techniques/${base}${sub ? `/${sub}` : ""}/`;
}
