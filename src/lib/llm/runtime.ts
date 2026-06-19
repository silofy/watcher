/**
 * Frontend LLM runtime status. In the Tauri shell it asks the Rust `ollama_status` command (no
 * webview CORS limits); in a plain browser it best-effort probes Ollama directly. Either way it
 * degrades to rules-only. Browser-safe — deliberately does NOT import the node-side OllamaProvider.
 */

const OLLAMA_URL = "http://127.0.0.1:11434";

export interface LlmRuntimeStatus {
  available: boolean;
  runtime: "ollama" | "rules-only";
  version?: string;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function llmStatus(): Promise<LlmRuntimeStatus> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const s = (await invoke("ollama_status")) as { available: boolean; version?: string };
      return { available: s.available, runtime: s.available ? "ollama" : "rules-only", version: s.version };
    } catch {
      /* fall through to a direct probe */
    }
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 600);
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: ctl.signal });
    clearTimeout(t);
    return { available: res.ok, runtime: res.ok ? "ollama" : "rules-only" };
  } catch {
    return { available: false, runtime: "rules-only" };
  }
}

export async function startOllama(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("start_ollama")) as boolean;
  } catch {
    return false;
  }
}

export function describeStatus(s: LlmRuntimeStatus): string {
  return s.available ? `LLM · ollama${s.version ? ` ${s.version}` : ""}` : "LLM · rules-only";
}
