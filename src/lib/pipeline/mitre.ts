/**
 * MITRE ATT&CK clustering — pass 1: the deterministic lookup table (brief §4.2).
 *
 * This table is correct ~80% of the time on its own and provides the strong prior
 * the (future) GBNF-constrained LLM refines. Phases are not a clean partition, so a
 * binary maps to a (tactic, technique) prior plus a confidence; context-sensitive
 * overrides (e.g. `python -m http.server` during privesc is staging, not Execution)
 * are applied on the full command text.
 */
import { extractBinary } from "./types";

export interface MitrePrior {
  tactic: string;
  technique: string;
  confidence: number;
}

interface Rule {
  binaries: string[];
  tactic: string;
  technique: string;
  confidence: number;
}

// Ordered table; first matching rule wins.
const TABLE: Rule[] = [
  { binaries: ["nmap", "rustscan", "masscan"], tactic: "TA0007", technique: "T1046", confidence: 0.9 },
  { binaries: ["gobuster", "ffuf", "feroxbuster", "dirb", "wfuzz", "nikto"], tactic: "TA0007", technique: "T1595.003", confidence: 0.85 },
  { binaries: ["whatweb", "curl", "wget", "whois"], tactic: "TA0007", technique: "T1595", confidence: 0.55 },
  { binaries: ["hydra", "medusa", "patator", "crackmapexec"], tactic: "TA0001", technique: "T1110", confidence: 0.8 },
  { binaries: ["sqlmap"], tactic: "TA0001", technique: "T1190", confidence: 0.85 },
  { binaries: ["searchsploit", "msfconsole", "exploit"], tactic: "TA0001", technique: "T1190", confidence: 0.6 },
  { binaries: ["nc", "ncat", "netcat", "socat", "bash", "sh", "python", "python3", "php", "perl"], tactic: "TA0002", technique: "T1059", confidence: 0.65 },
  { binaries: ["id", "whoami", "uname", "hostname"], tactic: "TA0004", technique: "T1033", confidence: 0.6 },
  { binaries: ["linpeas", "linpeas.sh", "linux-exploit-suggester", "les.sh"], tactic: "TA0004", technique: "T1068", confidence: 0.7 },
  { binaries: ["pspy", "pspy64"], tactic: "TA0004", technique: "T1057", confidence: 0.6 },
  { binaries: ["sudo", "doas"], tactic: "TA0004", technique: "T1548", confidence: 0.85 },
  { binaries: ["getcap", "find", "ls", "cat", "stat"], tactic: "TA0004", technique: "T1083", confidence: 0.5 },
];

const FALLBACK: MitrePrior = { tactic: "TA0007", technique: "T1059", confidence: 0.2 };

/** Pure binary → prior lookup (pass 1, before any context override). */
export function classifyBinary(binary: string): MitrePrior {
  const b = binary.toLowerCase();
  for (const rule of TABLE) {
    if (rule.binaries.includes(b)) {
      return { tactic: rule.tactic, technique: rule.technique, confidence: rule.confidence };
    }
  }
  return { ...FALLBACK };
}

/**
 * Context-aware classification on the full command. Applies the few-shot override
 * cases the brief calls out, where the binary prior is wrong in context.
 *
 * @param phaseTactic the tactic of the surrounding phase, when known, used for overrides.
 */
export function classifyCommand(cmd: string, phaseTactic?: string): MitrePrior {
  const binary = extractBinary(cmd);
  const lower = cmd.toLowerCase();

  // Override: `python -m http.server` (or updog/simplehttpserver) during privesc is
  // file staging / ingress tool transfer, NOT Execution.
  if (/python[0-9]?\s+-m\s+http\.server|http\.server|updog|simplehttpserver/.test(lower)) {
    if (phaseTactic === "TA0004" || phaseTactic === "TA0008") {
      return { tactic: "TA0011", technique: "T1105", confidence: 0.7 };
    }
  }

  // Override: a reverse-shell one-liner is Execution regardless of the leading binary.
  if (/(bash|sh)\s+-i|\/dev\/tcp\/|rm\s+\/tmp\/f;.*mkfifo|nc.*-e/.test(lower)) {
    return { tactic: "TA0002", technique: "T1059", confidence: 0.85 };
  }

  return classifyBinary(binary);
}
