import type { WatcherReport, Finding } from "../../types/report";
import type { ReportFinding } from "./findings";
import type { Severity } from "./library";
import { fmtClock } from "../format";
import { groupFindingsByKind } from "../findings-view";
import { humanizeObjective } from "../audits";

/** Join a list into prose: "a", "a and b", "a, b and c". */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

export function severityLabel(s: Severity): string {
  return s === "unset" ? "unset (set severity)" : s[0].toUpperCase() + s.slice(1);
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
  const redactionNote =
    profile === "public_safe"
      ? `> Redacted for sharing (profile \`${profile}\`): credentials and flags are masked.`
      : `> ⚠️ Full, unredacted detail (profile \`${profile}\`). This draft may contain real credentials and flags. Do not share it; regenerate from a \`public_safe\` report to redact.`;
  return [
    `# ${name}: Penetration Test Report`,
    "",
    `**Target:** ${name}${platform ? ` (${platform}${diff ? `, ${diff}` : ""})` : ""}  `,
    `**Engagement window:** ${start} → ${end}  `,
    redactionNote,
  ].join("\n");
}

export function execSummarySection(report: WatcherReport, findings: ReportFinding[], summary?: string): string {
  if (summary) return `## Executive summary\n\n${summary}`;
  const t = report.session?.target;
  const name = t?.name ?? report.session?.target_scope ?? "The target";
  const counts = new Map<Severity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const parts = [...counts.entries()].filter(([, n]) => n > 0).map(([s, n]) => `${n} ${severityLabel(s).toLowerCase()}`);
  const rooted = report.golden_dag?.some((o) => /root/i.test(o.objective) && o.status === "proven");
  const n = findings.length;
  // the attack path in one plain sentence (no commands) — initial access → escalation
  const path =
    n === 0
      ? ""
      : n === 1
        ? `The principal issue was **${findings[0].title}**.`
        : `Initial access was gained through **${findings[0].title}**, which was escalated to full administrative control via **${findings[n - 1].title}**.`;
  const outcome = rooted
    ? `${name} was assessed end-to-end and **fully compromised** — root (administrative) access was achieved.`
    : `${name} was assessed end-to-end; root access was **not** achieved during this engagement.`;
  const risk = `The assessment surfaced ${n} finding${n === 1 ? "" : "s"}${parts.length ? ` (${parts.join(", ")})` : ""}.${rooted ? " Until these are remediated, the host should be treated as fully attacker-controlled." : ""}`;
  return ["## Executive summary", "", outcome, "", risk, ...(path ? ["", path] : [])].join("\n");
}

/** A plain-language, command-free account of the engagement for a non-operator reader (the "CISO
 *  view"): what was accomplished in each phase, derived from the objectives reached. */
export function engagementSection(report: WatcherReport): string {
  const reached = new Map<string, string[]>();
  for (const o of report.golden_dag ?? []) {
    if (o.status === "reached" || o.status === "proven") {
      const arr = reached.get(o.tactic) ?? [];
      arr.push(humanizeObjective(o.objective));
      reached.set(o.tactic, arr);
    }
  }
  const lines: string[] = [];
  for (const p of report.phases ?? []) {
    const objs = reached.get(p.mitre_tactic);
    if (!objs?.length) continue;
    const phrased = objs.map((o, i) => (i === 0 ? o : o.charAt(0).toLowerCase() + o.slice(1)));
    lines.push(`- **${p.label}** — ${listJoin(phrased)}.`);
  }
  if (!lines.length) return "## What was done\n\nNo phased activity was recorded.";
  return [
    "## What was done",
    "",
    "A plain-language account of the engagement, phase by phase. Technical detail and evidence are in Findings and the Walkthrough below.",
    "",
    ...lines,
  ].join("\n");
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
    "The engagement was recorded end-to-end and analysed against three frameworks: MITRE ATT&CK (technique), the Unified Kill Chain (ordering), and CWE (weakness class).",
    phases.length ? `Phases exercised: ${phases.join(" → ")}.` : "",
  ].filter(Boolean).join("\n");
}

export function findingsSection(findings: ReportFinding[]): string {
  if (!findings.length) return "## Findings\n\nNo findings were derived from the run.";
  // A scannable summary table up front, then the detailed write-ups. Severities are code-styled so
  // they read cleanly in raw Markdown and render as colour badges in the app.
  const summary = [
    "| # | Finding | Severity | Weakness |",
    "| --- | --- | --- | --- |",
    ...findings.map((f, i) => `| ${i + 1} | ${f.title} | \`${severityLabel(f.severity)}\` | ${[f.cve, f.cwe].filter(Boolean).join(" · ") || "—"} |`),
  ].join("\n");
  const blocks = findings.map((f, i) => {
    const idpart = [f.cve, f.cwe].filter(Boolean).join(" · ") || "—";
    const refs = f.references.length ? f.references.map((r) => `  - ${r}`).join("\n") : "  - —";
    return [
      `### ${i + 1}. ${f.title}`,
      "",
      // compact meta line — inline labels, severity code-styled (renders as a badge in-app)
      `**Severity**: \`${severityLabel(f.severity)}\` · **Weakness**: ${idpart} · **Affected**: ${f.affected}`,
      "",
      "#### Description",
      "",
      f.description,
      "",
      "#### Impact",
      "",
      f.impact,
      "",
      "#### Evidence",
      "",
      f.evidence.map((e) => `- \`#${e.seq}\` \`${e.cmd}\`\n${fence([e.output || "(no captured output)"])}`).join("\n"),
      "",
      "#### Steps to reproduce",
      "",
      fence(f.reproduction.length ? f.reproduction : ["(see the walkthrough)"]),
      "",
      "#### Remediation",
      "",
      f.remediation,
      "",
      "#### References",
      "",
      refs,
    ].join("\n");
  });
  return "## Findings\n\n" + summary + "\n\n" + blocks.join("\n\n");
}

export function walkthroughSection(report: WatcherReport): string {
  const episodes = [...(report.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const labelByTactic = new Map((report.phases ?? []).map((p) => [p.mitre_tactic, p.label]));
  const out: string[] = ["## Walkthrough", ""];
  let current = "";
  for (const e of episodes) {
    const label = labelByTactic.get(e.tactic) ?? e.tactic;
    if (label !== current) { out.push(`### ${label}`, ""); current = label; }
    out.push(`- \`#${e.seq}\` \`${e.cmd}\`${e.output_digest ? `: ${e.output_digest}` : ""}`);
  }
  return out.join("\n");
}

export function appendixSection(report: WatcherReport): string {
  const episodes = [...(report.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const t0 = episodes[0]?.started_at_ms ?? 0;
  const log = episodes.map((e) => `| ${e.seq} | ${e.started_at_ms ? fmtClock(e.started_at_ms - t0) : "—"} | \`${e.cmd}\` |`).join("\n");
  const SECRET_KINDS = new Set(["cred", "hash"]);
  const ledgerRows = groupFindingsByKind(report.findings ?? [])
    .filter(([kind]) => kind === "port" || kind === "service" || kind === "cred")
    .flatMap(([kind, fs]: [string, Finding[]]) => fs.map((f) => `| ${kind} | ${SECRET_KINDS.has(kind) ? "••••" : f.value} |`));
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
