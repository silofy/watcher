import type { InvestigationResult, DefenseGrade, DefenseMetric, ArtifactHit } from "./types";

export function letterFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const round = (n: number) => Math.round(n * 10) / 10;

export function gradeDefense(result: InvestigationResult): DefenseGrade {
  const { incident, hits, advancing_seqs, noise_seqs } = result;
  const arts = incident.artifacts;
  const hitById = new Map<string, ArtifactHit>(hits.map((h) => [h.artifact_id, h]));
  const foundIds = new Set(hits.filter((h) => h.found).map((h) => h.artifact_id));

  // Coverage: weighted fraction of artifacts surfaced.
  const totalW = arts.reduce((s, a) => s + a.weight, 0) || 1;
  const foundW = arts.filter((a) => foundIds.has(a.id)).reduce((s, a) => s + a.weight, 0);
  const coverage = (foundW / totalW) * 100;

  // Reconstruction: of found artifacts with deps, the share found after all their prereqs.
  const seqOf = (id: string) => hitById.get(id)?.found_by_seq ?? Infinity;
  const withDeps = arts.filter((a) => foundIds.has(a.id) && a.depends_on.length > 0);
  const inOrder = withDeps.filter((a) => a.depends_on.every((d) => foundIds.has(d) && seqOf(d) <= seqOf(a.id)));
  const reconstruction = withDeps.length ? (inOrder.length / withDeps.length) * 100 : 100;

  // Time-to-detect: earlier surfacing of high-weight artifacts is better. Normalize each found
  // artifact's order position (index among run steps) to [0,1]; score = 100*(1 - avg position).
  const foundHits = hits.filter((h) => h.found && h.found_by_seq != null);
  const maxSeq = Math.max(1, ...advancing_seqs, ...noise_seqs);
  const dwellAvg = foundHits.length
    ? foundHits.reduce((s, h) => s + (h.found_by_seq! / maxSeq), 0) / foundHits.length
    : 1;
  const timeToDetect = foundHits.length ? Math.max(0, (1 - dwellAvg) * 100) : 0;

  // Scoping: fraction of affected entities the analyst surfaced (an entity is surfaced if any
  // artifact carrying it was found, or it appears among found artifacts' entities).
  const foundEntities = new Set(arts.filter((a) => foundIds.has(a.id)).flatMap((a) => a.entities));
  const scoping = incident.entities.length
    ? (incident.entities.filter((e) => foundEntities.has(e)).length / incident.entities.length) * 100
    : 100;

  // Discipline: advancing steps / total scored steps.
  const scored = advancing_seqs.length + noise_seqs.length;
  const discipline = scored ? (advancing_seqs.length / scored) * 100 : 100;

  const metrics: DefenseMetric[] = [
    { name: "Coverage", score: round(coverage), weight: 0.34, points: 0 },
    { name: "Reconstruction", score: round(reconstruction), weight: 0.2, points: 0 },
    { name: "Time-to-detect", score: round(timeToDetect), weight: 0.16, points: 0 },
    { name: "Scoping", score: round(scoping), weight: 0.16, points: 0 },
    { name: "Discipline", score: round(discipline), weight: 0.14, points: 0 },
  ].map((m) => ({ ...m, points: round(m.score * m.weight) }));

  const score = round(metrics.reduce((s, m) => s + m.points, 0));
  return { score, letter: letterFromScore(score), metrics };
}
