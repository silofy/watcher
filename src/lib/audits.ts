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
import { isOnTarget } from "./pipeline/mitre";
import { computeMethodology } from "./analysis/methodology";
import { computeFocus } from "./analysis/focus";
import { computeRecovery } from "./analysis/recovery";
import { analyzePrivesc } from "./analysis/privesc";

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
  /** reached AND backed by observable proof (the golden objective's status is "proven"). */
  proven: boolean;
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
  /** the distinct ATT&CK technique ids in this phase (first-seen order), so the count is inspectable. */
  techniqueIds: string[];
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

/** Home coaching category for a MITRE tactic, for the methodology checks (which come with a tactic,
 *  not a category) to get the same colored chip as coaching-sourced insights. Covers the tactics the
 *  methodology rules actually target; a tactic with no natural category gets no chip. */
const TACTIC_CATEGORY: Record<string, CoachCategory | undefined> = {
  TA0007: "Recon",
  TA0001: "Access",
  TA0004: "PrivEsc",
};

/** Slow-recovery threshold for the general coaching note: above this, getting back on track after a
 *  dead end or loop is taking long enough to call out explicitly. */
const SLOW_RECOVERY_MS = 5 * 60 * 1000;

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
  reuse_found_cred: "Reuse a found credential",
  audit_smb_shares: "Audit the SMB shares",
  escalate_via_confirmed_path: "Escalate via the confirmed path",
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
      proven: o.status === "proven",
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

    const techniqueIds = [...new Set(eps.map((e) => e.technique).filter((t): t is string => !!t))];
    const techniques = techniqueIds.length;
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
      techniqueIds,
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

  // SSH-block warning: a long interactive `ssh` with no on-target commands captured means the tap
  // wasn't active — everything you did on the box collapsed into one block. Make the gap explicit.
  const bigSsh = episodes.find((e) => e.binary === "ssh" && e.duration_ms >= 60_000);
  if (bigSsh && !episodes.some((e) => isOnTarget(e.context_path))) {
    general.push({
      id: "ssh-opaque-block",
      kind: "insight",
      title: "Commands inside your SSH session weren't captured",
      detail:
        "A long interactive `ssh` session was recorded as a single block — the enumeration, privesc, and flag reads you ran on the box aren't in this debrief. Run remote commands non-interactively (`ssh host 'cmd'`), or let the capture agent tap the session, for per-command detail.",
      evidence_seq: bigSsh.seq,
      category: "Tactics",
    });
  }

  // ── coaching insights from the methodology / focus / recovery analysis engines ─────────────────
  // Same engines that already feed the run's headline metrics — surfaced here as per-check, per-hole
  // guidance instead of a single rolled-up percentage. Appended, so nothing built above regresses.
  const phaseByTactic = new Map(phaseAudits.map((p) => [p.tactic, p]));

  const methodology = computeMethodology(report);
  for (const check of methodology.checks) {
    if (!check.applicable || check.done) continue;
    const item: AuditItem = {
      id: `methodology-${check.id}`,
      kind: "insight",
      title: check.label,
      detail: check.hint,
      evidence_seq: check.evidence_seq,
      category: TACTIC_CATEGORY[check.tactic],
    };
    (phaseByTactic.get(check.tactic)?.insights ?? general).push(item);
  }

  const focus = computeFocus(report);
  if (focus.rabbit_holes.length > 0) {
    let worst = focus.rabbit_holes[0];
    for (const h of focus.rabbit_holes) if (h.wasted_ms > worst.wasted_ms) worst = h;
    const attempts = episodes.filter(
      (e) => e.seq >= worst.start_seq && e.seq <= worst.end_seq && e.binary.toLowerCase() === worst.binary,
    ).length;
    const item: AuditItem = {
      id: "focus-rabbit-hole",
      kind: "insight",
      title: `Rabbit hole: ${attempts} low-yield \`${worst.binary}\` attempts — step back and enumerate`,
      detail: "Sustained low-yield attempts on the same tool with no new lead — a signal to pause and re-enumerate rather than keep grinding.",
      savings_ms: worst.wasted_ms,
      evidence_seq: worst.start_seq,
    };
    const ownerTactic = bySeq.get(worst.start_seq)?.tactic;
    ((ownerTactic && phaseByTactic.get(ownerTactic)?.insights) || general).push(item);
  }

  const recovery = computeRecovery(report);
  if (recovery.median_ms != null && recovery.median_ms > SLOW_RECOVERY_MS) {
    general.push({
      id: "recovery-slow",
      kind: "insight",
      title: `Slow recovery from stuck moments — median ${Math.round(recovery.median_ms / 60000)} min to get back on track`,
      detail: "After a dead end or a loop, it took a while before the next real advance. Time-box detours more tightly: if a path isn't paying off in a few minutes, switch approaches.",
    });
  }

  // ── privilege-escalation attack paths (RootHound-style, from the run's own enumeration) ─────────
  // The privesc engine matches captured output against a rulebook of known local-Linux root paths and
  // tags each confirmed / likely. Unlike the Ghost this needs no write-up, so it coaches on any box.
  // Surfaced into the PrivEsc phase; nothing here feeds the letter grade.
  const privesc = analyzePrivesc(report);
  const privescInsights = phaseByTactic.get("TA0004")?.insights ?? general;
  if (privesc.slow_line) {
    const { available_seq, rooted_seq, path } = privesc.slow_line;
    const wastedMs = episodes
      .filter((e) => e.seq > available_seq && e.seq < rooted_seq)
      .reduce((sum, e) => sum + e.duration_ms + e.gap_before_ms, 0);
    privescInsights.push({
      id: "privesc-slow-line",
      kind: "insight",
      title: `A confirmed root path (${path.title}) was on the table at step ${available_seq} — you rooted at step ${rooted_seq}`,
      detail: `The enumeration you'd already run exposed a known-good path to root (${path.title}): \`${path.abuse.split("\n")[0]}\`. You reached root by a longer line instead. When a confirmed escalation is visible, take it before chasing others.`,
      savings_ms: wastedMs > 0 ? wastedMs : undefined,
      evidence_seq: available_seq,
      category: "PrivEsc",
    });
  } else if (privesc.confirmed > 0 && privesc.rooted_seq == null) {
    const top = privesc.paths.find((p) => p.severity === "confirmed")!;
    privescInsights.push({
      id: "privesc-unrealized",
      kind: "insight",
      title: `A confirmed root path was available and not taken: ${top.title}`,
      detail: `Your enumeration surfaced a known-good escalation (${top.title}) that never got exploited: \`${top.abuse.split("\n")[0]}\`.`,
      evidence_seq: top.evidence_seq,
      category: "PrivEsc",
    });
  } else if (privesc.confirmed > 0 && privesc.first_confirmed_seq != null) {
    const top = privesc.paths.find((p) => p.severity === "confirmed")!;
    privescInsights.push({
      id: "privesc-clean-take",
      kind: "pass",
      title: `Spotted and used the confirmed privesc path (${top.title}) directly`,
      detail: `You identified a known-good root path from your own enumeration and acted on it without thrashing — the discipline this whole audit rewards.`,
      evidence_seq: top.evidence_seq,
      category: "PrivEsc",
    });
  }
  // The strongest LIKELY leads (kernel / sudo CVEs, dangerous groups) — surfaced so a real path isn't
  // missed, capped so the phase doesn't fill with noise.
  for (const p of privesc.paths.filter((p) => p.severity === "likely").slice(0, 2)) {
    privescInsights.push({
      id: `privesc-lead-${p.id}`,
      kind: "insight",
      title: `Privesc lead: ${p.title}`,
      detail: `${p.detail} ${p.abuse.split("\n")[0]}`,
      evidence_seq: p.evidence_seq || null,
      category: "PrivEsc",
    });
  }

  return { phases: phaseAudits, general };
}

export { SHORT_TACTIC };
