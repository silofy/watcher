/**
 * Offline LLM refinement (brief §4.2, §4.3, §5.1). Deterministic-first: this layer is optional and
 * only refines compact cards. `resolveProvider` probes for a local Ollama; if absent, everything
 * runs rules-only.
 */
import { NullProvider, type LlmProvider } from "./provider";
import { OllamaProvider } from "./ollama";
import { CloudProvider } from "./cloud";
import { getCoachMode, type CoachMode } from "./mode";

export * from "./hardware";
export * from "./grammar";
export * from "./provider";
export * from "./ollama";
export * from "./cloud";
export * from "./mode";
export * from "./runtime";
export * from "./refine";

/**
 * Resolve the coaching provider for the selected mode. `rules` → deterministic only; a cloud mode →
 * that CloudProvider when its key is set (else rules); `local` (default) → a reachable Ollama, else
 * rules. Any provider that can't run degrades to rules-only, so coaching never hard-fails.
 */
export async function resolveProvider(opts?: { url?: string; model?: string; mode?: CoachMode }): Promise<LlmProvider> {
  const mode = opts?.mode ?? getCoachMode();
  if (mode === "rules") return new NullProvider();
  if (mode === "anthropic" || mode === "openai" || mode === "gemini") {
    const cloud = new CloudProvider(mode);
    return (await cloud.available()) ? cloud : new NullProvider();
  }
  const ollama = new OllamaProvider(opts?.url, opts?.model);
  if (await ollama.available()) return ollama;
  return new NullProvider();
}
