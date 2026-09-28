import type { WatcherReport } from "../../types/report";
import type { Incident, ArtifactHit, InvestigationResult } from "./types";

/** Token-level containment: indicator appears as a whole token in the text (case-insensitive). */
function surfaces(text: string, indicator: string): boolean {
  const hay = text.toLowerCase();
  const needle = indicator.toLowerCase();
  if (!hay.includes(needle)) return false;
  // guard against matching inside a longer alphanumeric run (id -> guid); allow path/punct boundaries
  const i = hay.indexOf(needle);
  const before = hay[i - 1] ?? " ";
  const after = hay[i + needle.length] ?? " ";
  const wordish = (c: string) => /[a-z0-9]/.test(c);
  const boundaryOk = (edge: string, inner: string) => !(wordish(edge) && wordish(inner));
  return boundaryOk(before, needle[0]) && boundaryOk(after, needle[needle.length - 1]);
}

export function alignInvestigation(incident: Incident, run: WatcherReport): InvestigationResult {
  const eps = [...(run.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const t0 = eps[0]?.started_at_ms ?? 0;
  const hits: ArtifactHit[] = incident.artifacts.map((a) => ({
    artifact_id: a.id, found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null,
  }));
  const advancing = new Set<number>();
  for (const ep of eps) {
    const text = `${ep.cmd} ${ep.output_digest ?? ""}`;
    let advanced = false;
    incident.artifacts.forEach((a, i) => {
      if (hits[i].found) return;
      const ind = a.indicators.find((x) => surfaces(text, x));
      if (ind) {
        hits[i] = { artifact_id: a.id, found: true, found_by_seq: ep.seq, found_at_ms: (ep.started_at_ms ?? t0) - t0, matched_indicator: ind };
        advanced = true;
      }
    });
    if (advanced) advancing.add(ep.seq);
  }
  const noise = eps.filter((e) => !advancing.has(e.seq)).map((e) => e.seq);
  return { incident, hits, advancing_seqs: [...advancing], noise_seqs: noise };
}
