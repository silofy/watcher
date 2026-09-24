import type { WatcherReport } from "../../types/report";
import type { LlmProvider } from "../llm/provider";
import { deriveReportFindings, type ReportFinding } from "./findings";

/**
 * Optional prose polish. Deterministic-first: with no available provider (or on any error) it
 * returns the deterministic findings and no summary, so draftReport(report, out) === draftReport(report).
 * When a provider yields JSON, it overrides ONLY prose: the exec summary and per-finding description.
 * Structural fields (id, severity, cwe/cve, evidence, reproduction) are never touched. Nothing new
 * or un-redacted is sent — the model sees only fields already in the deterministic draft.
 */
export async function narrateReport(
  report: WatcherReport,
  provider: LlmProvider,
): Promise<{ findings: ReportFinding[]; summary?: string }> {
  const findings = deriveReportFindings(report);
  try {
    if (!(await provider.available())) return { findings };
    const payload = findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, description: f.description, impact: f.impact }));
    const prompt = [
      "Rewrite the prose of a penetration-test report for clarity and a professional tone.",
      "Return JSON { summary: string, descriptions: { <finding id>: string } }.",
      "Do not invent facts, CVEs, or severities. Keep every claim supported by the input.",
      JSON.stringify({ findings: payload }),
    ].join("\n");
    const res = (await provider.generateJson(prompt)) as { summary?: string; descriptions?: Record<string, string> } | null;
    if (!res) return { findings };
    const polished = findings.map((f) =>
      res.descriptions?.[f.id] ? { ...f, description: res.descriptions[f.id] } : f,
    );
    return { findings: polished, summary: res.summary };
  } catch {
    return { findings };
  }
}
