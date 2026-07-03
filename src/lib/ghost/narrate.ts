/**
 * Optional model narration for the Ghost (brief §4.5 / plan Task 5). `computeGhost` already produces
 * a grounded `note` per item from the deterministic diff alone — this pass only ever SHARPENS that
 * wording via a local/cloud model; it never changes verdicts, seqs, or lag, so `computeGhost`'s
 * determinism is unaffected. Deterministic-first: NullProvider (or any provider that yields nothing
 * usable) is a true no-op — the result comes back unchanged and the deterministic notes stand.
 *
 * Privacy: the prompt carries ONLY {objective, verdict, unlock_seq, actual_seq, lag_ms} per item —
 * the same non-sensitive, already-derived fields on `GhostDiffItem`. Raw commands, `output_digest`,
 * and finding `value`s live on `Episode`/`Finding`, not on `GhostDiffItem`, so there is nothing to
 * redact here beyond keeping this pass reading only the Ghost's own output.
 */
import type { GhostDiffItem, GhostResult } from "./ghost";
import type { LlmProvider } from "../llm/provider";

const TEMPERATURE = 0.2;

export const NARRATE_SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: { objective: { type: "string" }, note: { type: "string" } },
        required: ["objective", "note"],
      },
    },
  },
  required: ["notes"],
} as const;

/** A compact, non-sensitive card — everything else on the episode/finding stays out of the prompt. */
function card(item: GhostDiffItem): string {
  return `objective=${item.objective} verdict=${item.verdict} unlock_seq=${item.unlock_seq ?? "null"} actual_seq=${item.actual_seq ?? "null"} lag_ms=${item.lag_ms}`;
}

export function buildNarratePrompt(items: GhostDiffItem[]): string {
  const lines = items.map((it) => `- ${card(it)}`);
  return [
    "You are narrating a deterministic counterfactual diff from a penetration-test session: for each",
    "objective, whether the operator tracked the optimal line, got ahead of it, pivoted to it late,",
    "skipped it, or won it off the intended path.",
    "For EACH objective below, write ONE short, specific line (max 20 words) restating its verdict for",
    "a human reader. No flattery, no filler, no markdown. Do not invent facts beyond what's given.",
    "Return ONLY JSON matching the schema — exactly one entry per objective.",
    "",
    "Objectives:",
    ...lines,
  ].join("\n");
}

/**
 * Sharpen each item's `note` via the provider. Rules-only (NullProvider) or any provider that returns
 * nothing usable → the input `result` comes back unchanged, reference-equal, deterministic notes intact.
 * Never mutates `result`; never blanks a note the model didn't cover or failed to improve.
 */
export async function narrateGhost(result: GhostResult, provider: LlmProvider): Promise<GhostResult> {
  if (!result.items.length) return result;
  const raw = await provider.generateJson(buildNarratePrompt(result.items), { schema: NARRATE_SCHEMA, temperature: TEMPERATURE });
  const arr = (raw as { notes?: { objective?: unknown; note?: unknown }[] } | null)?.notes;
  if (!Array.isArray(arr)) return result;

  const notes = new Map<string, string>();
  for (const n of arr) {
    if (typeof n?.objective === "string" && typeof n?.note === "string" && n.note.trim()) notes.set(n.objective, n.note.trim());
  }
  if (notes.size === 0) return result;

  return { ...result, items: result.items.map((it) => (notes.has(it.objective) ? { ...it, note: notes.get(it.objective)! } : it)) };
}
