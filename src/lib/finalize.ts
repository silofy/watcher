/**
 * Finalize a captured live session into a structured debrief.
 *
 * A capture agent (watcher-capture --attach / --export) writes a session with episodes but no phase
 * map or real metrics. This runs the same deterministic pipeline the curated reports use — phase
 * derivation + metrics — plus a skill radar, so a real engagement renders as a graded debrief rather
 * than a raw command list. Golden-DAG alignment is deliberately skipped: there's no per-machine
 * reference write-up for an arbitrary live box, so we don't fabricate "optimal path" coverage.
 *
 * Idempotent and cheap (a handful of episodes), so it's safe to run on every poll/ingest.
 */
import type { CoachingStep, Episode, SkillRadar, WatcherReport } from "../types/report";
import { normalizeCoaching } from "./coaching";
import { derivePhases, alignEpisodes } from "./pipeline";
import { computeMetrics } from "./metrics";

const SKILL_BY_TACTIC: Record<string, keyof SkillRadar> = {
  TA0007: "recon", // Discovery
  TA0001: "web", // Initial Access
  TA0002: "exploit", // Execution
  TA0006: "exploit", // Credential Access
  TA0008: "exploit", // Lateral Movement
  TA0004: "privesc", // Privilege Escalation
  TA0011: "opsec", // Command & Control
};

function deriveSkillRadar(episodes: Episode[]): SkillRadar {
  const radar: SkillRadar = { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 };
  for (const e of episodes) {
    const skill = SKILL_BY_TACTIC[e.tactic] ?? "exploit";
    radar[skill] = Math.min(100, radar[skill] + 25);
  }
  return radar;
}

export function finalizeLiveReport(r: WatcherReport): WatcherReport {
  if (!r.episodes?.length) return r;

  // Layer-1 deviation: loops (failed retries) + detours (dead-ends) classified from exit codes and
  // low-yield output, with NO golden reference. (Layer 2 — straying from the intended path — needs a
  // write-up-sourced golden DAG and is added separately.)
  const { episodes } = alignEpisodes(r.episodes, r.golden_dag ?? []);
  const aligned: WatcherReport = { ...r, episodes };

  const startMs = Date.parse(r.session.started_at) || 0;
  const phases = derivePhases(episodes, startMs);
  const cm = computeMetrics(aligned);
  const breadth = cm.technique_breadth;

  const lead: CoachingStep = {
    action: r.recording
      ? `Recording — ${r.episodes.length} command(s) captured across ${breadth} technique(s).`
      : `${r.episodes.length} commands captured across ${breadth} ATT&CK technique(s).`,
    why: "",
    category: "Recap",
    evidence_seq: null,
  };

  return {
    ...aligned,
    phases,
    metrics: {
      ...r.metrics,
      efficiency_pct: cm.efficiency_pct,
      objective_coverage_pct: cm.objective_coverage_pct,
      stealth_score: cm.stealth_score,
      technique_breadth: breadth,
      time_waster: cm.time_waster,
    },
    coaching: {
      ...r.coaching,
      skill_radar: deriveSkillRadar(episodes),
      next_steps: [lead, ...normalizeCoaching(r.coaching?.next_steps).slice(1)],
    },
  };
}
