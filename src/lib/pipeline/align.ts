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
import type { Episode, Finding, GoldenObjective } from "../../types/report";

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
  const cmdTokens = ep.cmd.toLowerCase().split(/\s+/).filter(Boolean);
  const binary = ep.binary.toLowerCase();
  for (let i = 0; i < objective.satisfied_by.length; i++) {
    const method = objective.satisfied_by[i].toLowerCase().trim();
    if (!method) continue;
    const parts = method.split(/\s+/);
    const tool = firstWord(parts[0]);
    // The method's tool must be the episode's binary, or appear as a whole command TOKEN — matched by
    // equality, not substring, so short tools like "id"/"sh"/"ssh" don't false-match inside a longer
    // word ("guid", "bash"). Matching stays at the intent layer, so a flagless method ("nmap",
    // "cat user.txt") is satisfied by any use of that tool.
    const toolMatches = binary === tool || cmdTokens.some((t) => firstWord(t) === tool);
    if (!toolMatches) continue;
    // But when the method pins a specific flag ("sudo -l"), that flag must actually be present — a bare
    // `sudo cat /root/notes` shares the tool yet is a different action and must not satisfy it.
    const flags = parts.slice(1).filter((a) => a.startsWith("-"));
    if (flags.every((f) => cmdTokens.includes(f))) return i;
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

const ROOT_OBJ = /root|admin|system/i;

/** Deterministic objective status + proof marking (schema v1.2). */
export function annotateObjectiveStatus(episodes: Episode[], golden: GoldenObjective[], findings: Finding[]): GoldenObjective[] {
  return golden.map((o) => {
    const seq = o.user_satisfied_by_seq;
    // finding_refs: findings whose source or use touches the satisfier episode
    const refs = findings.filter((f) => f.source_seq === seq || (f.used_by_seq?.includes(seq ?? -1) ?? false)).map((f) => f.id);

    if (seq == null) {
      // attempted if any episode shared the tactic but didn't land it; else untouched
      const attempted = episodes.some((e) => e.tactic === o.tactic && (e.alignment === "detour" || e.loop_of_seq != null));
      return { ...o, status: attempted ? "attempted" : "untouched", finding_refs: refs, proven_by_seq: null };
    }

    // proof rules
    let proven_by_seq: number | null = null;
    const flagRef = findings.find((f) => f.kind === "flag" && f.proven && (f.source_seq === seq || refs.includes(f.id)));
    if (flagRef) proven_by_seq = flagRef.source_seq;
    else if (o.tactic === "TA0004" && ROOT_OBJ.test(o.objective)) {
      const proof = episodes.find((e) => e.seq >= seq && /uid=0|euid=0|\broot\b/.test(e.output_digest ?? ""));
      if (proof) proven_by_seq = proof.seq;
    }

    const status: GoldenObjective["status"] = proven_by_seq != null ? "proven" : "reached";
    return { ...o, status, finding_refs: refs, proven_by_seq };
  });
}

/** Objective coverage = satisfied objectives / total, as a percentage (deterministic). */
export function objectiveCoverage(golden: GoldenObjective[]): number {
  if (golden.length === 0) return 0;
  const satisfied = golden.filter((o) => o.user_satisfied_by_seq != null).length;
  return (satisfied / golden.length) * 100;
}
