import type { WatcherReport, Episode } from "../../types/report";
import { analyzePrivesc, type PrivescPath, type PrivescSeverity } from "../analysis/privesc";
import { matchTemplate, SEV_RANK, type Severity } from "./library";
import { BINARY_TO_CWE } from "../pipeline/frameworks";

export interface Evidence { seq: number; cmd: string; output: string; }
export interface ReportFinding {
  id: string;
  title: string;
  severity: Severity;
  cwe?: string;
  cve?: string;
  affected: string;
  description: string;
  impact: string;
  remediation: string;
  references: string[];
  evidence: Evidence[];
  reproduction: string[];
}

/** Privesc confidence tier → a conservative report severity, when the library has no override. */
function confidenceToSeverity(c: PrivescSeverity): Severity {
  return c === "confirmed" ? "high" : c === "likely" ? "medium" : "info";
}

export function deriveReportFindings(report: WatcherReport): ReportFinding[] {
  const episodes = report.episodes ?? [];
  const bySeq = new Map<number, Episode>(episodes.map((e) => [e.seq, e]));
  const affected = report.session?.target?.name ?? report.session?.target_scope ?? "the target";

  const evidenceOf = (seq: number): Evidence => {
    const e = bySeq.get(seq);
    return { seq, cmd: e?.cmd ?? "", output: e?.output_digest ?? "" };
  };
  // Reproduction: the commands of the same phase (tactic) up to and including the evidence step.
  const reproductionFor = (seq: number): string[] => {
    const anchor = bySeq.get(seq);
    if (!anchor) return [];
    return episodes
      .filter((e) => e.tactic === anchor.tactic && e.seq <= seq)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => e.cmd);
  };

  const byId = new Map<string, ReportFinding>();
  const add = (f: ReportFinding) => {
    const existing = byId.get(f.id);
    if (existing) { existing.evidence.push(...f.evidence); return; }
    byId.set(f.id, f);
  };

  // Source 1 — CVE findings.
  for (const vf of (report.findings ?? []).filter((f) => f.kind === "vuln")) {
    const tpl = matchTemplate({ cve: vf.value });
    add({
      id: `cve-${vf.value.toLowerCase()}`,
      title: tpl?.title ?? `${vf.value} (unverified)`,
      severity: tpl?.severity ?? "unset",
      cwe: tpl?.cwe,
      cve: vf.value,
      affected,
      description: tpl?.description ?? `The run referenced ${vf.value}; confirm applicability against the affected service and version.`,
      impact: tpl?.impact ?? "Depends on the affected component — assess and set the impact.",
      remediation: tpl?.remediation ?? "Patch the affected component to a fixed release; confirm the version is in range.",
      references: tpl?.references ?? [`https://nvd.nist.gov/vuln/detail/${vf.value}`],
      evidence: [evidenceOf(vf.source_seq)],
      reproduction: reproductionFor(vf.source_seq),
    });
  }

  // Source 2 — privesc paths (confirmed / likely).
  const pr = analyzePrivesc(report);
  for (const p of pr.paths.filter((x: PrivescPath) => x.severity === "confirmed" || x.severity === "likely")) {
    const tpl = matchTemplate({ vector: p.vector });
    add({
      id: `vector-${p.vector}`,
      title: tpl?.title ?? p.title,
      severity: tpl?.severity ?? confidenceToSeverity(p.severity),
      cwe: tpl?.cwe,
      affected,
      description: tpl?.description ?? p.detail,
      impact: tpl?.impact ?? "Local privilege escalation on the host.",
      remediation: tpl?.remediation ?? "Remove the misconfiguration; apply least privilege.",
      references: tpl?.references ?? (p.ref ? [p.ref] : []),
      evidence: [evidenceOf(p.evidence_seq)],
      reproduction: reproductionFor(p.evidence_seq),
    });
  }

  // Source 3 — CWE tags (episode.frameworks.cwe or BINARY_TO_CWE), only when the library knows the CWE.
  for (const e of episodes) {
    const cwes = new Set<string>([...(e.frameworks?.cwe ?? []), ...(BINARY_TO_CWE[e.binary] ?? [])]);
    for (const c of cwes) {
      const tpl = matchTemplate({ cwe: c });
      if (!tpl) continue;
      add({
        id: `cwe-${c.toLowerCase()}`,
        title: tpl.title, severity: tpl.severity, cwe: c, affected,
        description: tpl.description, impact: tpl.impact, remediation: tpl.remediation,
        references: tpl.references,
        evidence: [evidenceOf(e.seq)],
        reproduction: reproductionFor(e.seq),
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    const s = SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return s !== 0 ? s : (a.evidence[0]?.seq ?? 0) - (b.evidence[0]?.seq ?? 0);
  });
}
