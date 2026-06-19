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
