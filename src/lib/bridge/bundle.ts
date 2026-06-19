/**
 * Manager-profile minimization (brief §6.4). The institution never receives raw telemetry —
 * only scores and evidence *digests*. This is the exact bundle the student previews and consents
 * to before sync, and the unit the attestation signs. Pure and browser-safe (no crypto, no raw
 * commands or output text).
 */
import type { WatcherReport } from "../../types/report";
import { redactText } from "../redact";
import { computeGrade, type Grade } from "./grade";

export interface EvidenceDigest {
  objective: string;
  tactic: string;
  satisfied: boolean;
  /** which episode satisfied it (a pointer, not the command text). */
  by_seq: number | null;
}

export interface AttestationContent {
  schema_version: "1.0";
  session: { uuid: string; target_scope: string; started_at: string; ended_at: string };
  grade: {
    score: number;
    letter: string;
    routed_to: Grade["routed_to"];
    integrity_flag: boolean;
    components: Record<string, { raw: number; weight: number; weighted: number }>;
  };
  metrics_summary: {
    objective_coverage_pct: number;
    technique_breadth: number;
    efficiency_pct: number;
    stealth_score: number;
    independence: number;
  };
  evidence_digests: EvidenceDigest[];
  redaction_profile: "manager";
}

/** Build the minimized, manager-profile content for a report (no raw telemetry). */
export function minimizedBundle(report: WatcherReport, grade: Grade = computeGrade(report)): AttestationContent {
  const m = report.metrics;
  return {
    schema_version: "1.0",
    session: {
      uuid: report.session.uuid,
      // manager profile: redact the scope label so a live IP never reaches the institution
      target_scope: redactText(report.session.target_scope),
      started_at: report.session.started_at,
      ended_at: report.session.ended_at,
    },
    grade: {
      score: grade.score,
      letter: grade.letter,
      routed_to: grade.routed_to,
      integrity_flag: grade.independence_gate.flagged,
      components: grade.components,
    },
    metrics_summary: {
      objective_coverage_pct: m.objective_coverage_pct,
      technique_breadth: m.technique_breadth,
      efficiency_pct: m.efficiency_pct,
      stealth_score: m.stealth_score,
      independence: m.independence?.score ?? 0,
    },
    evidence_digests: report.golden_dag.map((o) => ({
      objective: o.objective,
      tactic: o.tactic,
      satisfied: o.user_satisfied_by_seq != null,
      by_seq: o.user_satisfied_by_seq ?? null,
    })),
    redaction_profile: "manager",
  };
}
