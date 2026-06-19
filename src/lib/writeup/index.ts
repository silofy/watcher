/**
 * Layer 2 orchestration. Primary path is a write-up you supply (paste/import) — fully offline, no
 * boundary crossing. Auto-fetch (box-name-only egress, opt-in) layers on later behind `fetchWriteup`.
 */
import type { LlmProvider } from "../llm/provider";
import { extractGoldenDag, type BoxRef, type WriteupResult } from "./extract";

export * from "./extract";

/** Extract a golden DAG from write-up text the user provided. Source label defaults to "pasted". */
export async function goldenFromText(text: string, box: BoxRef, provider: LlmProvider, source = "pasted"): Promise<WriteupResult> {
  const golden = await extractGoldenDag(text, box, provider);
  if (golden.length === 0) {
    return {
      golden,
      source,
      confidence: 0,
      note: "No objectives extracted — needs a running local model (Ollama). Without one, the report stays self-relative (Layer 1).",
    };
  }
  // confidence is a rough function of how complete the extracted path looks
  const confidence = Math.min(0.85, 0.4 + golden.length * 0.07);
  return { golden, source, confidence };
}
