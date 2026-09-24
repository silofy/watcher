import type { WatcherReport, Finding } from "../../types/report";
import type { ReportFinding } from "./findings";
import type { Severity } from "./library";
import { fmtClock } from "../format";
import { groupFindingsByKind } from "../findings-view";

export function severityLabel(s: Severity): string {
  return s === "unset" ? "— set severity" : s[0].toUpperCase() + s.slice(1);
}

function fence(lines: string[]): string {
  return "```\n" + lines.join("\n") + "\n```";
}

export function headerSection(report: WatcherReport): string {
  const t = report.session?.target;
  const name = t?.name ?? report.session?.target_scope ?? "Engagement";
  const platform = t?.platform ?? "";
  const diff = t?.difficulty?.label ?? "";
  const start = report.session?.started_at ?? "";
  const end = report.session?.ended_at ?? "";
  const profile = report.redaction_profile ?? "full";
  return [
    `# ${name} — Penetration Test Report`,
    "",
    `**Target:** ${name}${platform ? ` (${platform}${diff ? `, ${diff}` : ""})` : ""}  `,
    `**Engagement window:** ${start} → ${end}  `,
    `> Evidence is redacted per the run's redaction profile (\`${profile}\`); credentials and flags are masked.`,
  ].join("\n");
}

export function execSummarySection(report: WatcherReport, findings: ReportFinding[], summary?: string): string {
  if (summary) return `## Executive summary\n\n${summary}`;
  const counts = new Map<Severity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const parts = [...counts.entries()].filter(([, n]) => n > 0).map(([s, n]) => `${n} ${severityLabel(s).toLowerCase()}`);
  const rooted = report.golden_dag?.some((o) => /root/i.test(o.objective) && o.status === "proven");
  return [
    "## Executive summary",
    "",
    `The engagement surfaced ${findings.length} finding${findings.length === 1 ? "" : "s"}${parts.length ? ` (${parts.join(", ")})` : ""}.`,
    rooted ? "The target was fully compromised (root access achieved)." : "",
  ].filter(Boolean).join("\n");
}

export function scopeSection(report: WatcherReport): string {
  const t = report.session?.target;
  return [
    "## Scope",
    "",
    `- **Target:** ${t?.name ?? report.session?.target_scope ?? "—"}`,
    `- **Platform:** ${t?.platform ?? "—"}`,
    `- **Context:** ${report.session?.context_path ?? "host"}`,
    `- **Window:** ${report.session?.started_at ?? "—"} → ${report.session?.ended_at ?? "—"}`,
  ].join("\n");
}

export function methodologySection(report: WatcherReport): string {
  const phases = (report.phases ?? []).map((p) => p.label);
  return [
    "## Methodology",
    "",
    "The engagement was recorded end-to-end and analysed against three frameworks — MITRE ATT&CK (technique), the Unified Kill Chain (ordering), and CWE (weakness class).",
    phases.length ? `Phases exercised: ${phases.join(" → ")}.` : "",
  ].filter(Boolean).join("\n");
}

export function findingsSection(findings: ReportFinding[]): string {
  if (!findings.length) return "## Findings\n\nNo findings were derived from the run.";
  const blocks = findings.map((f, i) => {
    const idpart = [f.cve, f.cwe].filter(Boolean).join(" · ") || "—";
    const refs = f.references.length ? f.references.map((r) => `  - ${r}`).join("\n") : "  - —";
    return [
      `### ${i + 1}. ${f.title}`,
      "",
      `**Severity**: ${severityLabel(f.severity)}  `,
      `**Weakness**: ${idpart}  `,
      `**Affected**: ${f.affected}`,
      "",
      `**Description** — ${f.description}`,
      "",
      `**Impact** — ${f.impact}`,
      "",
      "**Evidence**",
      f.evidence.map((e) => `- \`#${e.seq}\` \`${e.cmd}\`\n${fence([e.output || "(no captured output)"])}`).join("\n"),
      "",
      "**Steps to reproduce**",
      fence(f.reproduction.length ? f.reproduction : ["(see the walkthrough)"]),
      "",
      `**Remediation** — ${f.remediation}`,
      "",
      "**References**",
      refs,
    ].join("\n");
  });
  return "## Findings\n\n" + blocks.join("\n\n");
}

export function walkthroughSection(report: WatcherReport): string {
  const episodes = [...(report.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const labelByTactic = new Map((report.phases ?? []).map((p) => [p.mitre_tactic, p.label]));
  const out: string[] = ["## Walkthrough", ""];
  let current = "";
  for (const e of episodes) {
    const label = labelByTactic.get(e.tactic) ?? e.tactic;
    if (label !== current) { out.push(`### ${label}`, ""); current = label; }
    out.push(`- \`#${e.seq}\` \`${e.cmd}\`${e.output_digest ? ` — ${e.output_digest}` : ""}`);
  }
  return out.join("\n");
}

export function appendixSection(report: WatcherReport): string {
  const episodes = [...(report.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const t0 = episodes[0]?.started_at_ms ?? 0;
  const log = episodes.map((e) => `| ${e.seq} | ${e.started_at_ms ? fmtClock(e.started_at_ms - t0) : "—"} | \`${e.cmd}\` |`).join("\n");
  const ledgerRows = groupFindingsByKind(report.findings ?? [])
    .filter(([kind]) => kind === "port" || kind === "service" || kind === "cred")
    .flatMap(([kind, fs]: [string, Finding[]]) => fs.map((f) => `| ${kind} | ${f.masked ? "••••" : f.value} |`));
  const loadout = new Map<string, number>();
  for (const e of episodes) loadout.set(e.binary, (loadout.get(e.binary) ?? 0) + 1);
  const tools = [...loadout.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => `| \`${b}\` | ${n} |`).join("\n");
  return [
    "## Appendix",
    "",
    "### Command log",
    "",
    "| # | Time | Command |",
    "| --- | --- | --- |",
    log,
    "",
    "### Findings ledger",
    "",
    "| Kind | Value |",
    "| --- | --- |",
    ledgerRows.join("\n") || "| — | — |",
    "",
    "### Tool loadout",
    "",
    "| Tool | Count |",
    "| --- | --- |",
    tools,
  ].join("\n");
}
