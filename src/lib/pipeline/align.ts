/**
 * Path comparison against the seeded write-up (brief §4.3).
 *
 * Comparison is at the INTENT layer, not on raw commands — a student who reaches the
 * same objective with a different tool did nothing wrong. We align the user's episodes
 * against the golden DAG of tool-agnostic objectives. The alignment and time accounting
 * are deterministic (re-runs give the same verdict); the only piece the LLM owns is the
 * objective-equivalence judgment, stubbed here by a deterministic matcher the LLM later
 * refines.
 */
import type { Episode, GoldenObjective } from "../../types/report";

/** Negative-yield signals in an output digest — used to tell a detour from valid enumeration. */
const LOW_YIELD = /\b(no |not found|nothing|0 |zero|unreliable|rate.?limit|rejected|blocked|fail|invalid|denied)/i;

function firstWord(s: string): string {
  return s.trim().split(/\s+/)[0]?.replace(/^.*[\\/]/, "") ?? "";
}

/**
 * Deterministic stand-in for the LLM's objective-equivalence judgment: an episode
 * satisfies an objective if it shares the objective's tactic AND its binary (or command
 * text) matches one of the objective's satisfied_by methods. Returns the matched index
 * within satisfied_by, or -1.
 */
export function equivalenceIndex(ep: Episode, objective: GoldenObjective): number {
  if (ep.tactic !== objective.tactic) return -1;
  const lowerCmd = ep.cmd.toLowerCase();
  for (let i = 0; i < objective.satisfied_by.length; i++) {
    const method = objective.satisfied_by[i].toLowerCase();
    const tool = firstWord(method);
    if (ep.binary.toLowerCase() === tool) return i;
    if (tool && lowerCmd.includes(tool)) return i;
    if (lowerCmd.includes(method)) return i;
  }
  return -1;
}

export interface AlignResult {
  episodes: Episode[];
  golden: GoldenObjective[];
}

/**
 * Align episodes to the golden DAG, returning new arrays with alignment labels and
 * user_satisfied_by_seq filled in. Objectives are assumed authored in a valid
 * topological order (true prerequisites earlier).
 */
export function alignEpisodes(rawEpisodes: Episode[], rawGolden: GoldenObjective[]): AlignResult {
  const episodes = rawEpisodes.map((e) => ({ ...e, alignment: null as Episode["alignment"], loop_of_seq: null as number | null }));
  const golden = rawGolden.map((o) => ({ ...o, user_satisfied_by_seq: null as number | null }));
  const consumed = new Set<number>();
  const satisfierSeq = new Map<string, number>(); // objective -> seq that satisfied it

  // 1) For each objective in order, claim the earliest unconsumed equivalent episode.
  for (const obj of golden) {
    let best: { seq: number; idx: number } | null = null;
    for (const ep of episodes) {
      if (consumed.has(ep.seq)) continue;
      const idx = equivalenceIndex(ep, obj);
      if (idx >= 0) {
        best = { seq: ep.seq, idx };
        break; // earliest in seq order
      }
    }
    if (best) {
      consumed.add(best.seq);
      obj.user_satisfied_by_seq = best.seq;
      satisfierSeq.set(obj.objective, best.seq);
      const ep = episodes.find((e) => e.seq === best!.seq)!;
      // primary tool (satisfied_by[0]) => match; any other listed tool => alternative method
      ep.alignment = best.idx === 0 ? "match" : "alternative";
    }
    // else: objective stays skipped (user_satisfied_by_seq = null)
  }

  // 2) out_of_order: a satisfier that happened before a prerequisite's satisfier.
  for (const obj of golden) {
    const mySeq = obj.user_satisfied_by_seq;
    if (mySeq == null || !obj.depends_on?.length) continue;
    for (const dep of obj.depends_on) {
      const depSeq = satisfierSeq.get(dep);
      if (depSeq != null && mySeq < depSeq) {
        const ep = episodes.find((e) => e.seq === mySeq)!;
        ep.alignment = "out_of_order";
      }
    }
  }

  // 3) Leftover running episodes: classify loop vs detour vs valid-alternative.
  const running = episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
  for (let i = 0; i < running.length; i++) {
    const ep = running[i];
    if (ep.alignment) continue; // already matched/alternative/out_of_order

    // loop: an adjacent earlier attempt of the same binary that failed/was rejected,
    // immediately followed by a successful retry of the same binary.
    const prev = running[i - 1];
    const next = running[i + 1];
    const failed = (ep.exit_code != null && ep.exit_code !== 0) || (ep.output_digest != null && LOW_YIELD.test(ep.output_digest));
    if (failed && next && next.binary === ep.binary) {
      ep.loop_of_seq = next.seq;
      continue;
    }
    if (failed && prev && prev.binary === ep.binary && prev.loop_of_seq == null) {
      ep.loop_of_seq = prev.seq;
      continue;
    }

    // detour: unmatched and low-yield; otherwise it was valid, unscored enumeration.
    const lowYield = (ep.exit_code != null && ep.exit_code !== 0) || (ep.output_digest != null && LOW_YIELD.test(ep.output_digest));
    ep.alignment = lowYield ? "detour" : "alternative";
  }

  return { episodes, golden };
}

/** Objective coverage = satisfied objectives / total, as a percentage (deterministic). */
export function objectiveCoverage(golden: GoldenObjective[]): number {
  if (golden.length === 0) return 0;
  const satisfied = golden.filter((o) => o.user_satisfied_by_seq != null).length;
  return (satisfied / golden.length) * 100;
}
