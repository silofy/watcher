import type { PrivescVector } from "../analysis/privesc";

/** Report severity (distinct from privesc confidence tiers). */
export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unset";

/** Sort rank — critical first, unset last. */
export const SEV_RANK: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4, unset: 5,
};

export interface FindingTemplate {
  title: string;
  severity: Severity;
  cwe?: string;
  description: string;
  impact: string;
  remediation: string;
  references: string[];
}

const GTFO = "https://gtfobins.github.io/";
const cwe = (id: string) => `https://cwe.mitre.org/data/definitions/${id.replace("CWE-", "")}.html`;

// Keyed built-in library. Public NVD/CWE/GTFOBins facts, re-expressed. Extend like the privesc rulebook.
const BY_CVE: Record<string, FindingTemplate> = {
  "CVE-2026-4480": {
    title: "Samba print-job command injection (CVE-2026-4480)",
    severity: "critical",
    cwe: "CWE-78",
    description: "The Samba print path forwards the print-job description through the shell without escaping, so a crafted job name is executed as a command on the server.",
    impact: "Unauthenticated remote command execution as the Samba service account — an initial foothold on the host.",
    remediation: "Patch Samba to a fixed release; disable the print$ / spooler services if unused; never pass untrusted job metadata to a shell.",
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2026-4480"],
  },
};

const BY_VECTOR: Partial<Record<PrivescVector, FindingTemplate>> = {
  systemd: {
    title: "Writable systemd unit directory allows root escalation",
    severity: "critical", cwe: "CWE-732",
    description: "A systemd unit or drop-in directory is group/world-writable, so a low-privileged user can add an ExecStartPre/ExecStart that runs as root on the next (re)start.",
    impact: "Full root compromise of the host.",
    remediation: "Restrict systemd unit directories to root ownership and 0755 permissions; audit group membership that grants write access.",
    references: [cwe("CWE-732")],
  },
  writable: {
    title: "World-writable sensitive file",
    severity: "high", cwe: "CWE-732",
    description: "A security-sensitive file is writable by an unprivileged user.",
    impact: "Tampering that can lead to privilege escalation or persistence.",
    remediation: "Tighten file ownership and permissions to least privilege.",
    references: [cwe("CWE-732")],
  },
  suid: {
    title: "Exploitable SUID binary", severity: "high", cwe: "CWE-269",
    description: "A SUID-root binary can be abused (per GTFOBins) to run commands as root.",
    impact: "Local privilege escalation to root.",
    remediation: "Remove the SUID bit where not required; replace GTFOBins-listed binaries or restrict access.",
    references: [GTFO, cwe("CWE-269")],
  },
  sudo: {
    title: "Abusable sudo rule", severity: "high", cwe: "CWE-269",
    description: "A sudo rule permits running a binary that can spawn a shell or write arbitrary files as root (per GTFOBins).",
    impact: "Local privilege escalation to root.",
    remediation: "Scope sudo rules to specific safe commands; avoid NOPASSWD on shell-capable binaries.",
    references: [GTFO, cwe("CWE-269")],
  },
  sgid: {
    title: "Exploitable SGID binary", severity: "high", cwe: "CWE-269",
    description: "An SGID binary can be abused to run with an elevated group (per GTFOBins).",
    impact: "Privilege escalation via an elevated group.",
    remediation: "Remove the SGID bit where not required.",
    references: [GTFO, cwe("CWE-269")],
  },
  cap: {
    title: "Dangerous file capability", severity: "high", cwe: "CWE-269",
    description: "A binary carries a Linux capability (e.g. cap_setuid) that allows privilege escalation.",
    impact: "Local privilege escalation.",
    remediation: "Remove unnecessary file capabilities with setcap -r.",
    references: [GTFO, cwe("CWE-269")],
  },
  group: {
    title: "Dangerous group membership", severity: "medium", cwe: "CWE-269",
    description: "Membership in a privileged group (docker, lxd, disk, …) grants a path to root.",
    impact: "Local privilege escalation to root.",
    remediation: "Remove users from privileged groups they do not need.",
    references: [cwe("CWE-269")],
  },
  nfs: {
    title: "NFS no_root_squash misconfiguration", severity: "high", cwe: "CWE-732",
    description: "An NFS export with no_root_squash lets a client write root-owned SUID binaries.",
    impact: "Local privilege escalation to root.",
    remediation: "Enable root_squash on NFS exports.",
    references: [cwe("CWE-732")],
  },
  "ld-preload": {
    title: "LD_PRELOAD preserved across sudo", severity: "high", cwe: "CWE-426",
    description: "sudo preserves LD_PRELOAD, allowing a malicious shared object to run as root.",
    impact: "Local privilege escalation to root.",
    remediation: "Remove env_keep+=LD_PRELOAD from sudoers.",
    references: [cwe("CWE-426")],
  },
  "kernel-cve": {
    title: "Kernel vulnerable to a known privilege-escalation CVE", severity: "critical", cwe: "CWE-269",
    description: "The kernel version matches a published local-privilege-escalation CVE.",
    impact: "Local privilege escalation to root.",
    remediation: "Patch the kernel to a fixed release.",
    references: ["https://nvd.nist.gov/"],
  },
  "sudo-cve": {
    title: "sudo vulnerable to a known CVE", severity: "critical", cwe: "CWE-269",
    description: "The sudo version matches a published privilege-escalation CVE (e.g. Baron Samedit).",
    impact: "Local privilege escalation to root.",
    remediation: "Update sudo to a fixed release.",
    references: ["https://nvd.nist.gov/"],
  },
};

const BY_CWE: Record<string, FindingTemplate> = {
  "CWE-78": {
    title: "OS command injection", severity: "critical", cwe: "CWE-78",
    description: "User-controlled input reaches a shell/command interpreter without sanitisation.",
    impact: "Remote command execution on the host.",
    remediation: "Use parameterised APIs; validate and escape all input that reaches a shell.",
    references: [cwe("CWE-78")],
  },
  "CWE-89": {
    title: "SQL injection", severity: "high", cwe: "CWE-89",
    description: "User input is concatenated into a SQL query.",
    impact: "Database read/write, authentication bypass, sometimes RCE.",
    remediation: "Use parameterised queries / prepared statements.",
    references: [cwe("CWE-89")],
  },
  "CWE-522": {
    title: "Insufficiently protected credentials", severity: "medium", cwe: "CWE-522",
    description: "Credentials are stored or transmitted in a recoverable form.",
    impact: "Credential theft enabling lateral movement or escalation.",
    remediation: "Store secrets in a vault; never reuse credentials across accounts/services.",
    references: [cwe("CWE-522")],
  },
};

/** First match wins in priority order: exact CVE, then privesc vector, then CWE. */
export function matchTemplate(key: { cve?: string; cwe?: string; vector?: PrivescVector }): FindingTemplate | null {
  if (key.cve && BY_CVE[key.cve]) return BY_CVE[key.cve];
  if (key.vector && BY_VECTOR[key.vector]) return BY_VECTOR[key.vector]!;
  if (key.cwe && BY_CWE[key.cwe]) return BY_CWE[key.cwe];
  return null;
}
