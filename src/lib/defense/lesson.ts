import type { OneLesson } from "../one-lesson";
import type { InvestigationResult } from "./types";

/** The single highest-value malicious step the analyst never surfaced. */
export function defenseLesson(result: InvestigationResult): OneLesson | null {
  const found = new Set(result.hits.filter((h) => h.found).map((h) => h.artifact_id));
  const missed = result.incident.artifacts.filter((a) => !found.has(a.id));
  if (missed.length === 0) return null;
  const worst = missed.reduce((a, b) => (b.weight > a.weight ? b : a));
  return {
    text: `You never surfaced ${worst.label}. It is the highest-value step you missed; trace back from what you did find to its origin.`,
    evidence_seq: worst.source_seq,
  };
}
