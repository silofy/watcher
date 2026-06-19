/**
 * Layer 2 orchestration. Primary path is a write-up you supply (paste/import) — fully offline, no
 * boundary crossing. Auto-fetch (box-name-only egress, opt-in) layers on later behind `fetchWriteup`.
 */
import type { LlmProvider } from "../llm/provider";
import { extractGoldenDag, heuristicGoldenDag, type BoxRef, type WriteupResult } from "./extract";

export * from "./extract";

/**
 * Extract a golden DAG from write-up text the user provided. Tries the local model first (sharp,
 * tool-agnostic); with no model, falls back to a keyword heuristic so the comparison still works
 * offline (rougher, flagged with lower confidence). Source label defaults to "pasted".
 */
export async function goldenFromText(text: string, box: BoxRef, provider: LlmProvider, source = "pasted"): Promise<WriteupResult> {
  let golden = await extractGoldenDag(text, box, provider);
  let rough = false;
  if (golden.length === 0) {
    golden = heuristicGoldenDag(text);
    rough = golden.length > 0;
  }
  if (golden.length === 0) {
    return {
      golden,
      source,
      confidence: 0,
      note: "Couldn't extract an intended path from that text. Paste a fuller write-up, or enable Local AI (Ollama) for sharper extraction.",
    };
  }
  // confidence reflects completeness — and is capped lower for the keyword fallback
  const confidence = rough ? Math.min(0.5, 0.25 + golden.length * 0.05) : Math.min(0.85, 0.4 + golden.length * 0.07);
  return { golden, source, confidence, note: rough ? "Rough extraction — no local model, so this is keyword-based. Enable Local AI (Ollama) for a sharper intended path." : undefined };
}
