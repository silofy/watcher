import type { WatcherReport, Episode, Finding } from "../../types/report";
import { isOnTarget } from "../pipeline/mitre";

interface Ctx {
  episodes: Episode[];
  findings: Finding[];
  binaries: Set<string>;
  ports: Map<string, number>;   // "445" -> source_seq
  hasWeb: boolean; webSeq: number | null;
  hasFoothold: boolean; footholdSeq: number | null;
}

export interface MethodologyCheck { id: string; tactic: string; label: string; applicable: boolean; done: boolean; hint: string; evidence_seq: number | null; }
export interface MethodologyResult { coverage_pct: number; checks: MethodologyCheck[]; }

interface RuleResult { applicable: boolean; evidence: number | null; }

interface Rule {
  id: string; tactic: string; label: string; hint: string;
  applies: (c: Ctx) => RuleResult;
  done: (c: Ctx) => boolean;
}

const usesAny = (c: Ctx, bins: string[]) => bins.some((b) => c.binaries.has(b));

const RULES: Rule[] = [
  { id: "port_scan", tactic: "TA0007", label: "Full service scan", hint: "Start with a full service scan (`nmap -sV -sC`).",
    applies: (c) => ({ applicable: c.episodes.length > 0, evidence: null }),
    done: (c) => usesAny(c, ["nmap", "rustscan", "masscan"]) || c.findings.some((f) => f.kind === "port") },
  { id: "service_version_enum", tactic: "TA0007", label: "Service version enumeration", hint: "Enumerate service versions (`-sV`) to map the exploit surface.",
    applies: (c) => { const p = c.findings.find((f) => f.kind === "port"); const seq = p ? p.source_seq : null; return { applicable: seq != null, evidence: seq }; },
    done: (c) => c.findings.some((f) => f.kind === "version") },
  { id: "web_content_enum", tactic: "TA0007", label: "Web content discovery", hint: "Brute web content (`ffuf`/`gobuster`) — you found a web service.",
    applies: (c) => { const seq = c.hasWeb ? c.webSeq : null; return { applicable: seq != null, evidence: seq }; },
    done: (c) => usesAny(c, ["gobuster", "ffuf", "feroxbuster", "dirb", "wfuzz"]) || c.findings.filter((f) => f.kind === "url" || f.kind === "path").length >= 2 },
  { id: "smb_enum", tactic: "TA0007", label: "SMB enumeration", hint: "SMB is open — enumerate it (`enum4linux-ng`, `smbclient -L`).",
    applies: (c) => { const seq = c.ports.get("445") ?? c.ports.get("139") ?? null; return { applicable: seq != null, evidence: seq }; },
    done: (c) => usesAny(c, ["enum4linux", "enum4linux-ng", "smbclient", "crackmapexec", "cme"]) },
  { id: "priv_enum", tactic: "TA0004", label: "Privilege-escalation enumeration", hint: "After foothold, enumerate privesc (`sudo -l`, `linpeas`, `pspy`).",
    applies: (c) => ({ applicable: c.hasFoothold, evidence: c.footholdSeq }),
    done: (c) => usesAny(c, ["linpeas", "linpeas.sh", "pspy", "pspy64", "getcap"]) || c.episodes.some((e) => /\bsudo\s+-l\b/.test(e.cmd)) },
];

function buildCtx(report: WatcherReport): Ctx {
  const episodes = report.episodes;
  const findings = report.findings ?? [];
  const binaries = new Set(episodes.map((e) => e.binary.toLowerCase()).filter(Boolean));
  const ports = new Map<string, number>();
  for (const f of findings) if (f.kind === "port") { const n = f.value.split("/")[0]; if (!ports.has(n)) ports.set(n, f.source_seq); }
  const webPort = ["80", "443", "8080", "8000", "8443"].map((p) => ports.get(p)).find((s) => s != null) ?? null;
  const urlSeq = findings.find((f) => f.kind === "url")?.source_seq ?? null;
  const webSeq = webPort ?? urlSeq;
  const hasWeb = webSeq != null;
  const goldenFootholdSeq = report.golden_dag.find((o) => o.tactic === "TA0002" && o.user_satisfied_by_seq != null)?.user_satisfied_by_seq ?? null;
  const footholdSeq = goldenFootholdSeq ?? episodes.find((e) => isOnTarget(e.context_path))?.seq ?? null;
  const hasFoothold = footholdSeq != null;
  return { episodes, findings, binaries, ports, hasWeb, webSeq, hasFoothold, footholdSeq };
}

/** Deterministic methodology coverage: applicable disciplined checks the run performed. */
export function computeMethodology(report: WatcherReport): MethodologyResult {
  const c = buildCtx(report);
  const checks: MethodologyCheck[] = RULES.map((r) => {
    const result = r.applies(c);
    return { id: r.id, tactic: r.tactic, label: r.label, applicable: result.applicable, done: result.applicable ? r.done(c) : false, hint: r.hint, evidence_seq: result.applicable ? result.evidence : null };
  });
  const applicable = checks.filter((c) => c.applicable);
  const doneN = applicable.filter((c) => c.done).length;
  const coverage_pct = applicable.length === 0 ? 0 : (doneN / applicable.length) * 100;
  return { coverage_pct, checks };
}

/** The single highest-value un-done applicable check (RULES are ordered recon→privesc), or null. */
export function topUnmetCheck(report: WatcherReport): MethodologyCheck | null {
  return computeMethodology(report).checks.find((c) => c.applicable && !c.done) ?? null;
}
