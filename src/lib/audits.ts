/**
 * Phase audits — the report recast as a Google-Lighthouse-style checklist, one "category" per MITRE
 * phase (kill-chain order). Everything here is PURE and derived from the report's own deterministic
 * fields (phases, episodes, golden_dag, coaching) — no new judgement, just a different projection of
 * what metrics.ts / grade.ts already compute. The point is actionable TEXT per phase, not only graphs.
 *
 * Each phase yields three Lighthouse-shaped groups:
 *   - insights  : ranked, actionable findings (coaching + concrete dead-ends / loops / stalls), with
 *                 an estimated time-saving where a concrete deviation backs it.
 *   - manual    : "additional items to manually check" — what the deterministic pipeline cannot
 *                 confirm on its own (unsatisfied objectives, unverifiable coverage when no write-up).
 *   - passed    : objectives you actually hit in this phase.
 */
import type { CoachCategory, CoachingStep, Episode, WatcherReport } from "../types/report";
import { activeMs, wasteByTactic, type WasteBreakdown } from "./metrics";
import { normalizeCoaching } from "./coaching";
import { runWeaknesses } from "./pipeline/frameworks";

export type AuditKind = "insight" | "manual" | "pass";

export interface AuditItem {
  id: string;
  kind: AuditKind;
  /** the imperative lead (markdown allowed). */
  title: string;
  /** supporting rationale (markdown allowed). */
  detail?: string;
  /** estimated time this would have saved, ms — only set where a concrete deviation backs it. */
  savings_ms?: number;
  /** deep-link target into the timeline / command log. */
  evidence_seq?: number | null;
  /** for the colored category chip on coaching-sourced insights. */
  category?: CoachCategory;
}

/** One goal on the intended path for this phase, and whether the run reached it. */
export interface ObjectiveStatus {
  slug: string;
  /** clean display name (mapped, else humanized from the slug). */
  label: string;
  /** what a write-up says satisfies this objective — the hint for an unreached one. */
  satisfied_by: string[];
  reached: boolean;
  /** the step that satisfied it, when reached. */
  seq: number | null;
}

export interface PhaseAudit {
  tactic: string;
  label: string;
  /** gauge score — the phase's efficiency (0–100). */
  efficiency: number;
  /** active wall-clock spent in this phase (ms). */
  active_ms: number;
  /** wasted time in this phase, split by bucket. */
  waste: WasteBreakdown;
  /** total wasted ms = detour + loop + stuck. */
  wasted_ms: number;
  commands: number;
  techniques: number;
  /** distinct CWE weakness classes exploited in this phase (phase-scoped, unlike the run-level axes). */
  cwe: string[];
  coverage: { satisfied: number; total: number; pct: number };
  /** the phase's goals on the intended path, each with reached/not-reached status. */
  objectives: ObjectiveStatus[];
  /** loudest command in this phase, if any was noisy. */
  loudest: { seq: number; noise: number } | null;
  insights: AuditItem[];
  manual: AuditItem[];
}

/** Short tactic name used for IDs / chips, mirrors AttackTimeline's SHORT_TACTIC. */
const SHORT_TACTIC: Record<string, string> = {
  TA0043: "Recon",
  TA0042: "Resource",
  TA0007: "Discovery",
  TA0001: "Access",
  TA0002: "Exec",
  TA0003: "Persist",
  TA0004: "PrivEsc",
  TA0005: "Defense",
  TA0006: "Creds",
  TA0008: "Lateral",
  TA0009: "Collect",
  TA0011: "C2",
  TA0010: "Exfil",
  TA0040: "Impact",
};

/** Map a coaching category to the MITRE tactic it most naturally belongs to, for steps with no
 *  evidence_seq to anchor them to a phase. */
const CATEGORY_TACTIC: Record<CoachCategory, string | null> = {
  Recon: "TA0007",
  Web: "TA0001",
  Access: "TA0001",
  PrivEsc: "TA0004",
  OpSec: null, // cross-cutting — attached to the phase of its loudest moment instead
  Tactics: null,
  Recap: null,
};

/** Clean display names for the objectives the deterministic pipeline knows about, so the checklist
 *  reads like prose. Unknown slugs (e.g. from a freshly-extracted write-up) fall back to a humanized
 *  title-case of the slug. Mirrors how attack.ts maps technique IDs to names. */
const OBJECTIVE_LABELS: Record<string, string> = {
  enumerate_services: "Enumerate exposed services",
  enumerate_web_content: "Enumerate web content",
  locate_admin_panel: "Locate the admin panel",
  obtain_admin_access: "Obtain admin access",
  bypass_upload_filter: "Bypass the upload filter",
  achieve_code_execution: "Achieve code execution",
  stabilize_shell: "Stabilize the shell",
  capture_user_flag: "Capture the user flag",
  enumerate_privesc_surface: "Enumerate the privesc surface",
  find_sudo_misconfig: "Find the sudo misconfiguration",
  escalate_to_root: "Escalate to root",
  capture_root_flag: "Capture the root flag",
  test_credential_reuse_ssh: "Test credential reuse over SSH",
};

/** A readable objective name: a mapped label, else title-cased from the slug. */
export function humanizeObjective(slug: string): string {
  if (OBJECTIVE_LABELS[slug]) return OBJECTIVE_LABELS[slug];
  const s = slug.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : slug;
}

/** Which phase (by tactic) a coaching step belongs to: its evidence episode's tactic wins; else its
 *  category's home tactic. Returns null when it can't be placed in any present phase. */
function tacticForStep(step: CoachingStep, bySeq: Map<number, Episode>, present: Set<string>): string | null {
  if (step.evidence_seq != null) {
    const t = bySeq.get(step.evidence_seq)?.tactic;
    if (t && present.has(t)) return t;
  }
  const home = CATEGORY_TACTIC[step.category];
  return home && present.has(home) ? home : null;
}

/**
 * Project a report into per-phase audits (in kill-chain order) plus a `general` bucket for coaching
 * that can't be tied to a single phase — so the Phase Audit is a complete home for every move and
 * nothing is lost when the standalone playbook goes away.
 */
export function buildPhaseAudits(report: WatcherReport): { phases: PhaseAudit[]; general: AuditItem[] } {
  const { episodes, phases, golden_dag } = report;
  const bySeq = new Map(episodes.map((e) => [e.seq, e]));
  const present = new Set(phases.map((p) => p.mitre_tactic));
  const wasteByT = wasteByTactic(episodes);

  // coaching steps, placed onto their phase tactic
  const steps = normalizeCoaching(report.coaching?.next_steps).filter((s) => s.category !== "Recap");

  // loud moments per tactic (so OpSec advice + the loudest command land in the right phase)
  const noiseByTactic = new Map<string, { seq: number; noise: number }>();
  for (const e of episodes) {
    const w = e.noise_weight ?? 0;
    if (w === 0) continue;
    const noise = w * (1 + Math.log10(Math.max(1, e.volume ?? 1)));
    const cur = noiseByTactic.get(e.tactic);
    if (!cur || noise > cur.noise) noiseByTactic.set(e.tactic, { seq: e.seq, noise });
  }
  // the single loudest command in the run — its phase gets the OpSec coaching
  let loudestTactic: string | null = null;
  let loudestNoise = 0;
  for (const [t, m] of noiseByTactic) if (m.noise > loudestNoise) ((loudestNoise = m.noise), (loudestTactic = t));

  const stepTactic = (s: CoachingStep): string | null => {
    const t = tacticForStep(s, bySeq, present);
    if (t) return t;
    if (s.category === "OpSec" && loudestTactic) return loudestTactic;
    return null;
  };
  const placements = steps.map(stepTactic);

  const phaseAudits = phases.map((phase) => {
    const tactic = phase.mitre_tactic;
    const eps = episodes.filter((e) => e.tactic === tactic);
    const waste = wasteByT[tactic] ?? { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0, efficiency_pct: 100 };
    const wasted_ms = waste.detour_ms + waste.loop_ms + waste.stuck_ms;

    const objectives = golden_dag.filter((o) => o.tactic === tactic);
    const satisfied = objectives.filter((o) => o.user_satisfied_by_seq != null);

    // ── insights ──────────────────────────────────────────────────────────
    const insights: AuditItem[] = [];

    // 1) curated coaching for this phase (highest-value, human-grade advice first)
    for (const [i, s] of steps.entries()) {
      if (placements[i] !== tactic) continue;
      insights.push({
        id: `${tactic}-coach-${i}`,
        kind: "insight",
        title: s.action,
        detail: s.why,
        evidence_seq: s.evidence_seq ?? null,
        category: s.category,
      });
    }

    // 2) concrete deviations, aggregated, each with a real time cost
    const detours = eps.filter((e) => e.alignment === "detour");
    const loops = eps.filter((e) => e.loop_of_seq != null);
    if (detours.length) {
      insights.push({
        id: `${tactic}-detour`,
        kind: "insight",
        title: `${detours.length} dead-end ${detours.length === 1 ? "command" : "commands"} in this phase`,
        detail: detours.length === 1 ? `\`${detours[0].cmd}\` produced no new attack surface.` : "Commands that produced no new attack surface — skippable next time.",
        savings_ms: detours.reduce((a, e) => a + activeMs(e), 0),
        evidence_seq: detours[0].seq,
      });
    }
    if (loops.length) {
      insights.push({
        id: `${tactic}-loop`,
        kind: "insight",
        title: `${loops.length} repeated ${loops.length === 1 ? "attempt" : "attempts"} (loops)`,
        detail: "The same approach retried after failing — a signal to change tack sooner.",
        savings_ms: loops.reduce((a, e) => a + activeMs(e), 0),
        evidence_seq: loops[0].seq,
      });
    }
    if (waste.stuck_ms >= 60_000) {
      insights.push({
        id: `${tactic}-stuck`,
        kind: "insight",
        title: `Long stalls — ${Math.round(waste.stuck_ms / 60000)} min of think-time above your baseline`,
        detail: "Extended pauses beyond your usual pace; often where a hint or a step back would help.",
        savings_ms: waste.stuck_ms,
      });
    }

    // ── the phase's objectives, each with reached / not-reached status ────────
    const objectiveStatus: ObjectiveStatus[] = objectives.map((o) => ({
      slug: o.objective,
      label: humanizeObjective(o.objective),
      satisfied_by: o.satisfied_by,
      reached: o.user_satisfied_by_seq != null,
      seq: o.user_satisfied_by_seq ?? null,
    }));

    // ── additional items to manually check (non-objective) ───────────────────
    // Unreached objectives are already shown in the objectives checklist; this group is for things the
    // pipeline genuinely can't confirm — e.g. when there's no reference path to grade coverage against.
    const manual: AuditItem[] = [];
    if (golden_dag.length === 0 && eps.length > 0) {
      manual.push({
        id: `${tactic}-noref`,
        kind: "manual",
        title: "Confirm you covered this phase's objectives",
        detail: "No reference write-up is loaded, so objective coverage can't be auto-verified for this box.",
      });
    }

    const techniques = new Set(eps.map((e) => e.technique).filter(Boolean)).size;
    const cwe = runWeaknesses(eps);
    const total = objectives.length;

    return {
      tactic,
      label: phase.label,
      efficiency: Math.round(phase.efficiency_pct),
      active_ms: waste.t_active_ms,
      waste,
      wasted_ms,
      commands: eps.length,
      techniques,
      cwe,
      coverage: { satisfied: satisfied.length, total, pct: total === 0 ? 0 : (satisfied.length / total) * 100 },
      objectives: objectiveStatus,
      loudest: noiseByTactic.get(tactic) ?? null,
      insights,
      manual,
    };
  });

  // coaching that couldn't be placed in any present phase → the cross-cutting "General" bucket
  const general: AuditItem[] = steps
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => placements[i] == null)
    .map(({ s, i }) => ({
      id: `general-coach-${i}`,
      kind: "insight" as const,
      title: s.action,
      detail: s.why,
      evidence_seq: s.evidence_seq ?? null,
      category: s.category,
    }));

  return { phases: phaseAudits, general };
}

export { SHORT_TACTIC };
