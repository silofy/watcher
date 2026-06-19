/**
 * Offline LLM refinement (brief §4.2, §4.3, §5.1). Deterministic-first: this layer is optional and
 * only refines compact cards. `resolveProvider` probes for a local Ollama; if absent, everything
 * runs rules-only.
 */
import { NullProvider, type LlmProvider } from "./provider";
import { OllamaProvider } from "./ollama";

export * from "./hardware";
export * from "./grammar";
export * from "./provider";
export * from "./ollama";
export * from "./refine";

/** Use a reachable local Ollama if present, else the rules-only NullProvider. */
export async function resolveProvider(opts?: { url?: string; model?: string }): Promise<LlmProvider> {
  const ollama = new OllamaProvider(opts?.url, opts?.model);
  if (await ollama.available()) return ollama;
  return new NullProvider();
}
