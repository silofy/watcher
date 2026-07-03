import type { PlatformAdapter } from "./types";
import type { GoldenObjective, Target } from "../../types/report";

/** depends_on may only reference an objective earlier in the same array — no forward, self, or
 *  cyclic references. Returns a failure message, or null if the tree is topologically sane. */
function checkTopology(tree: GoldenObjective[]): string | null {
  const seen = new Set<string>();
  for (const o of tree) {
    for (const dep of o.depends_on ?? []) {
      if (!seen.has(dep)) return `intendedPath(): "${o.objective}" depends_on "${dep}", which is not an earlier objective`;
    }
    seen.add(o.objective);
  }
  return null;
}

/**
 * Adapter conformance kit (WP-8). Runs the handful of contract checks every `PlatformAdapter` must
 * satisfy to plug into `resolveAdapter`/`targetOf` and (optionally) the write-up gate's native path:
 * non-empty identity strings, a `detect()` that never throws and stays in [0,1], an `identify()` that
 * never throws and returns a fully-populated `Target`, and — if present — an `intendedPath()` that
 * never throws and, on an empty input, returns either `null` or a topologically sane objective tree.
 *
 * Every adapter call is wrapped in try/catch: a broken adapter should fail the check with a clear
 * message, not crash the conformance suite (or the app) with an uncaught exception. Returns a list of
 * failure messages — empty means the adapter passes. Async because `intendedPath` is.
 */
export async function checkAdapter(a: PlatformAdapter): Promise<string[]> {
  const errs: string[] = [];
  if (!a.id) errs.push("missing id");
  if (!a.label) errs.push("missing label");
  if (!a.kindNoun) errs.push("missing kindNoun");

  let score = NaN;
  try {
    score = a.detect({});
  } catch (e) {
    errs.push(`detect() threw: ${e}`);
  }
  if (!(score >= 0 && score <= 1)) errs.push(`detect() out of range [0,1]: ${score}`);

  let target: Target | undefined;
  try {
    target = a.identify(undefined, {});
  } catch (e) {
    errs.push(`identify() threw: ${e}`);
  }
  if (target) {
    if (target.platform !== a.id) errs.push(`identify() Target.platform "${target.platform}" !== adapter id "${a.id}"`);
    if (!target.name) errs.push("identify() Target missing name");
    if (!target.kind) errs.push("identify() Target missing kind");
  } else {
    errs.push("identify() did not return a Target");
  }

  if (a.intendedPath) {
    try {
      const probeTarget = target ?? { platform: a.id, kind: a.kindNoun, name: "conformance-probe" };
      const tree = await a.intendedPath({ target: probeTarget, raw: undefined });
      if (tree !== null) {
        if (!Array.isArray(tree)) errs.push("intendedPath() must return null or a GoldenObjective[]");
        else {
          const topoErr = checkTopology(tree);
          if (topoErr) errs.push(topoErr);
        }
      }
    } catch (e) {
      errs.push(`intendedPath() threw: ${e}`);
    }
  }

  return errs;
}
