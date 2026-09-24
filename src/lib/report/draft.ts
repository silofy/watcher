import type { WatcherReport } from "../../types/report";
import { deriveReportFindings, type ReportFinding } from "./findings";
import {
  headerSection, execSummarySection, scopeSection, methodologySection,
  findingsSection, walkthroughSection, appendixSection,
} from "./sections";

/**
 * Render a full OSCP/CPTS-style Markdown report draft. Pure and deterministic. `opts.findings`
 * and `opts.summary` let a caller inject model-polished pieces (see report/narrate.ts); with no
 * opts the whole draft is deterministic.
 */
export function draftReport(report: WatcherReport, opts?: { findings?: ReportFinding[]; summary?: string }): string {
  const findings = opts?.findings ?? deriveReportFindings(report);
  return [
    headerSection(report),
    execSummarySection(report, findings, opts?.summary),
    scopeSection(report),
    methodologySection(report),
    findingsSection(findings),
    walkthroughSection(report),
    appendixSection(report),
  ].join("\n\n");
}
