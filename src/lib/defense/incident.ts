import type { WatcherReport, Episode, Finding } from "../../types/report";
import type { Artifact, Incident, UkcPhase } from "./types";

const PHASE_WEIGHT: Record<string, number> = {
  "initial-access": 5, execution: 4, persistence: 5, "privilege-escalation": 5,
  "credential-access": 4, "lateral-movement": 4, impact: 5, exfiltration: 4,
  "defense-evasion": 3, discovery: 2, collection: 2, reconnaissance: 1, unknown: 2,
};

// Tokens too generic to prove an analyst "found" a specific malicious step.
const STOP = new Set([
  "echo", "cat", "ls", "cd", "id", "whoami", "cp", "mv", "rm", "chmod", "chown",
  "the", "and", "for", "with", "sudo", "bash", "sh", "-e", "-l", "-a", "-la", "|bash",
]);

function phaseOf(ep: Episode): UkcPhase {
  const u = (ep.frameworks?.ukc ?? "").toLowerCase().replace(/\s+/g, "-");
  return (u || "unknown") as UkcPhase;
}

/** Distinctive tokens from a command: filenames, paths, long identifiers — not generic verbs. */
function indicatorsFrom(ep: Episode): string[] {
  const out = new Set<string>();
  for (const tok of `${ep.cmd} ${ep.output_digest ?? ""}`.split(/[\s'"();]+/)) {
    const t = tok.trim();
    if (t.length < 4 || STOP.has(t.toLowerCase())) continue;
    // a path/file, a CVE, an override/service unit, or a long distinctive token
    if (/[/.]/.test(t) || /^CVE-\d/i.test(t) || t.length > 6) out.add(t.replace(/^\.*/, ""));
    if (out.size >= 6) break;
  }
  // the file basename is a strong indicator (override.conf, rootbash)
  for (const m of ep.cmd.matchAll(/[\w.-]+\.(conf|sh|service|txt|php|py|exe)\b/g)) out.add(m[0]);
  return [...out];
}

function entitiesFrom(ep: Episode): string[] {
  const text = `${ep.cmd} ${ep.output_digest ?? ""}`;
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[\w-]+\.(?:htb|local|internal)\b/gi)) out.add(m[0]);
  for (const m of text.matchAll(/user:\[([^\]]+)\]/g)) out.add(m[1]);
  return [...out];
}

export function deriveIncident(attacker: WatcherReport): Incident {
  const eps = [...(attacker.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const cveBySeq = new Map<number, string>();
  for (const f of (attacker.findings ?? []) as Finding[]) {
    if (f.kind === "vuln" && f.source_seq != null) cveBySeq.set(f.source_seq, f.value);
  }
  const artifacts: Artifact[] = [];
  const allEntities = new Set<string>();
  let prevId: string | null = null;
  for (const ep of eps) {
    const indicators = indicatorsFrom(ep);
    const cve = cveBySeq.get(ep.seq);
    if (cve) indicators.push(cve);
    // A step with no discriminating indicator is not a standalone artifact (a generic command).
    if (indicators.length === 0) continue;
    const phase = phaseOf(ep);
    const entities = entitiesFrom(ep);
    entities.forEach((e) => allEntities.add(e));
    const id = `art:seq${ep.seq}`;
    artifacts.push({
      id,
      label: cve ? `${ep.binary} (${cve})` : `${ep.binary}: ${ep.cmd.slice(0, 48)}`,
      phase,
      technique: ep.technique ?? "",
      indicators: [...new Set(indicators)],
      entities,
      weight: (PHASE_WEIGHT[phase] ?? 2) + (cve ? 2 : 0),
      depends_on: prevId ? [prevId] : [],
      source_seq: ep.seq,
    });
    prevId = id;
  }
  return {
    artifacts,
    entities: [...allEntities],
    target_scope: attacker.session?.target?.name ?? attacker.session?.target_scope ?? "Incident",
  };
}
