import type { GhostResult, GhostDiffItem } from "../ghost/ghost";
import type { InvestigationResult, ArtifactHit } from "./types";

/**
 * "You vs. the optimal investigation line": one item per incident artifact, in kill-chain
 * (source_seq) order. Found respecting prerequisites → on_time; found before a prereq was
 * surfaced → late_pivot (you stumbled on the effect before the cause); missed → skipped.
 */
export function investigationGhost(result: InvestigationResult): GhostResult {
  const { incident, hits } = result;
  const byId = new Map<string, ArtifactHit>(hits.map((h) => [h.artifact_id, h]));
  const seqOf = (id: string) => byId.get(id)?.found_by_seq ?? null;
  const items: GhostDiffItem[] = [...incident.artifacts].sort((a, b) => a.source_seq - b.source_seq).map((a) => {
    const h = byId.get(a.id)!;
    let verdict: GhostDiffItem["verdict"];
    if (!h.found) verdict = "skipped";
    else if (a.depends_on.length && a.depends_on.some((d) => { const ds = seqOf(d); return ds == null || ds > (h.found_by_seq ?? Infinity); }))
      verdict = "late_pivot";
    else verdict = "on_time";
    return { objective: a.label, verdict, unlock_seq: a.source_seq, actual_seq: h.found_by_seq, lag_ms: 0, note: "" };
  });
  const time_lost_ms = 0;
  const human_wins = items.filter((i) => i.verdict === "on_time").length;
  return { time_lost_ms, human_wins, items };
}
