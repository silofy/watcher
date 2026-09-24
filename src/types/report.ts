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

export type PlatformId = "htb" | "thm" | "offsec" | "immersive" | "local";

export interface TargetDifficulty {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
}

export interface TargetEmblem {
  avatar?: string | null;
  hue?: number | null;
}

/** Neutral, platform-agnostic target identity (schema v1.2). Supersedes Machine. */
export interface Target {
  platform: PlatformId;
  kind: string;
  name: string;
  slug?: string;
  os?: string;
  difficulty?: TargetDifficulty | null;
  emblem?: TargetEmblem;
  url?: string | null;
}

export type ObjectiveStatus = "untouched" | "attempted" | "reached" | "proven";

export type FindingKind = "port" | "service" | "version" | "cred" | "url" | "path" | "host" | "hash" | "vuln" | "flag";

/** Platform-agnostic evidence entry extracted from an episode (schema v1.2). */
export interface Finding {
  id: string;
  kind: FindingKind;
  value: string;
  masked?: boolean;
  source_seq: number;
  used_by_seq?: number[];
  tactic?: string;
  proven?: boolean;
  confidence?: number;
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
  target?: Target;
}

/** Cross-framework tags overlaid on an episode's ATT&CK classification (schema v1.1). */
export interface EpisodeFrameworks {
  /** Unified Kill Chain phase derived from the ATT&CK tactic — adds attack ordering. */
  ukc?: string;
  /** CWE weakness classes the episode exploited (absent when none is unambiguous). */
  cwe?: string[];
}

export interface Episode {
  seq: number;
  cmd: string;
  binary: string;
  /** Absolute wall-clock start (epoch ms); present on live/fused captures, lets lanes be positioned on a real time axis. */
  started_at_ms?: number;
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
  frameworks?: EpisodeFrameworks;
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
  status?: ObjectiveStatus;
  finding_refs?: string[];
  proven_by_seq?: number | null;
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
  /** Distinct UKC phases reached vs. those the intended path requires (schema v1.1). */
  ukc_coverage_pct?: number;
  /** Share of UKC-phase transitions that advance rather than backtrack (schema v1.1). */
  ukc_progression?: number;
  /** Distinct CWE weakness classes exploited — a sharper breadth than techniques (schema v1.1). */
  weakness_breadth?: number;
  /** Share of the expected methodology checklist actually touched (schema v1.3). */
  methodology_coverage_pct?: number;
  /** Share of active time spent on-path vs. detours (schema v1.3). */
  focus_discipline_pct?: number;
  /** Median time to recover from a stuck/loop episode (schema v1.3). */
  recovery_median_ms?: number | null;
  /** Headline copy of ghost.time_lost_ms for the summary card (schema v1.4). */
  ghost_time_lost_ms?: number | null;
  /** Headline copy of ghost.human_wins for the summary card (schema v1.4). */
  ghost_human_wins?: number | null;
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

/** Verdict of a golden objective vs. the deterministic ghost trajectory (schema v1.4). */
export type GhostVerdict = "on_time" | "late_pivot" | "skipped" | "ahead" | "off_path_win";

/** Per-objective ghost diff entry — a golden objective or a detected run signal (schema v1.4). */
export interface GhostItem {
  objective: string;
  verdict: GhostVerdict;
  /** Earliest episode seq where prerequisite findings existed. */
  unlock_seq?: number | null;
  /** Episode seq that satisfied it, or null. */
  actual_seq?: number | null;
  /** Time between unlock and your action (0 for on_time/ahead). */
  lag_ms?: number;
  /** Optional model narration; deterministic hint when absent. */
  note?: string;
}

/** Counterfactual "optimal-from-your-state" analysis (schema v1.4). Deterministic; never feeds the grade. */
export interface Ghost {
  /** Σ late-pivot lag (time between a finding-unlock and your action). */
  time_lost_ms?: number;
  /** Count of ahead / off-path moments where the human beat the optimal line. */
  human_wins?: number;
  items?: GhostItem[];
}

export interface WatcherReport {
  schema_version: "1.0" | "1.1" | "1.2" | "1.3" | "1.4";
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
  /** Platform-agnostic evidence entries cross-referenced by golden_dag objectives (schema v1.2). */
  findings?: Finding[];
  /** Counterfactual "optimal-from-your-state" analysis (schema v1.4). Deterministic; never feeds the grade. */
  ghost?: Ghost;
}
