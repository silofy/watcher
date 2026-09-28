import type { Session } from "../../types/report";
import type { GhostResult } from "../ghost/ghost";
import type { OneLesson } from "../one-lesson";

export type UkcPhase =
  | "reconnaissance" | "initial-access" | "execution" | "persistence"
  | "privilege-escalation" | "defense-evasion" | "credential-access"
  | "discovery" | "lateral-movement" | "collection" | "exfiltration" | "impact" | "unknown";

export interface Artifact {
  id: string;
  label: string;
  phase: UkcPhase;
  technique: string;
  indicators: string[];
  entities: string[];
  weight: number;
  depends_on: string[];
  source_seq: number;
}

export interface Incident {
  artifacts: Artifact[];
  entities: string[];
  target_scope: string;
}

export interface ArtifactHit {
  artifact_id: string;
  found: boolean;
  found_by_seq: number | null;
  found_at_ms: number | null;
  matched_indicator: string | null;
}

export interface InvestigationResult {
  incident: Incident;
  hits: ArtifactHit[];
  advancing_seqs: number[];
  noise_seqs: number[];
}

export interface DefenseMetric { name: string; score: number; weight: number; points: number }
export interface DefenseGrade { score: number; letter: string; metrics: DefenseMetric[] }

export interface DefenseReport {
  mode: "defense";
  session: Session;
  incident: Incident;
  result: InvestigationResult;
  grade: DefenseGrade;
  ghost: GhostResult;
  lesson: OneLesson | null;
}
