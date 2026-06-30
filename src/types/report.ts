/**
 * TypeScript mirror of schema/watcher-report.schema.json (v1.0).
 * The schema is the source of truth; these types are for editor ergonomics.
 * tests/schema.test.ts validates the fixture against the schema so drift is caught.
 */

export type ActorMode = "machine_bound" | "human_active" | "think_pause" | "idle";

export type Alignment =
  | "match"
  | "alternative"
  | "detour"
  | "skipped"
  | "out_of_order"
  | null;

export type Source = "local_pty" | "in_vm_daemon" | "plugin";

export type RedactionProfile = "public_safe" | "full";

export interface Machine {
  name?: string;
  slug?: string;
  os?: string;
  difficulty?: "Easy" | "Medium" | "Hard" | "Insane" | string;
  avatar?: string | null;
  points?: number | null;
  retired?: boolean;
}

export interface Session {
  uuid: string;
  started_at: string;
  ended_at: string;
  target_scope: string;
  context_path?: string;
  shell: string;
  source: Source;
  machine?: Machine;
}

export interface Episode {
  seq: number;
  cmd: string;
  binary: string;
  duration_ms: number;
  gap_before_ms: number;
  exit_code?: number | null;
  actor: ActorMode;
  output_digest?: string;
  tactic: string;
  technique?: string;
  confidence?: number;
  noise_weight?: number;
  volume?: number;
  context_path?: string;
  alignment?: Alignment;
  loop_of_seq?: number | null;
}

export interface Phase {
  mitre_tactic: string;
  label: string;
  started_at: string;
  ended_at: string;
  efficiency_pct: number;
}

export interface GoldenObjective {
  objective: string;
  tactic: string;
  satisfied_by: string[];
  depends_on?: string[];
  user_satisfied_by_seq?: number | null;
}

export interface TimeWaster {
  productive_ms: number;
  detour_ms: number;
  stuck_ms: number;
  loop_ms: number;
  t_active_ms: number;
}

export interface Independence {
  score: number;
  signals: {
    think_pause_presence?: number;
    typo_entropy?: number;
    paste_burst_ratio?: number;
    cohort_uniqueness?: number;
  };
}

export interface Metrics {
  efficiency_pct: number;
  time_waster: TimeWaster;
  stealth_score: number;
  loud_moments?: { seq: number; noise: number }[];
  independence?: Independence;
  objective_coverage_pct: number;
  technique_breadth: number;
}

export interface SkillRadar {
  recon: number;
  web: number;
  exploit: number;
  privesc: number;
  opsec: number;
}

export type CoachCategory = "Recon" | "Web" | "Access" | "PrivEsc" | "OpSec" | "Tactics" | "Recap";

export interface CoachingStep {
  /** the imperative lead — what to do next time (markdown: inline code allowed). */
  action: string;
  /** the rationale — why it matters, grounded in this run (markdown). */
  why: string;
  /** the discipline this addresses, used for the category chip + color. */
  category: CoachCategory;
  /** the captured step this advice points at, so the card can deep-link into the timeline. */
  evidence_seq?: number | null;
}

export interface Coaching {
  skill_radar: SkillRadar;
  next_steps: CoachingStep[];
}

export interface Replay {
  cast_ref?: string | null;
  inline_cast?: string | null;
}

export interface NoiseBaseline {
  /** Sum of the reference noise — the stealth-0 denominator. */
  total: number;
  /** The loud reference solve, broken down so the baseline is inspectable. */
  reference: { label: string; noise: number }[];
}

export interface WatcherReport {
  schema_version: "1.0";
  session: Session;
  episodes: Episode[];
  phases: Phase[];
  golden_dag: GoldenObjective[];
  metrics: Metrics;
  coaching: Coaching;
  replay?: Replay;
  redaction_profile: RedactionProfile;
  /** True while the session is live (machine spawned, capture ongoing). */
  recording?: boolean;
  /** Per-box loudness anchor — the noise of a "loud reference solve". Σ noise here = stealth 0.
   *  Derived per box from its expected loud tooling, so the 0–100 stealth score means something
   *  per box rather than against a global magic constant. */
  noise_baseline?: NoiseBaseline;
}
