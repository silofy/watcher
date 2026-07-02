/**
 * Frontend LLM runtime status. In the Tauri shell it asks the Rust `ollama_status` command (no
 * webview CORS limits); in a plain browser it best-effort probes Ollama directly. Either way it
 * degrades to rules-only. Browser-safe — deliberately does NOT import the node-side OllamaProvider.
 */

const OLLAMA_URL = "http://127.0.0.1:11434";

/** The model the guided setup pulls and the coaching provider expects (matches the docs). */
export const DEFAULT_MODEL = "llama3.2";
export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

export interface LlmRuntimeStatus {
  available: boolean;
  runtime: "ollama" | "rules-only";
  version?: string;
  /** Installed model names when the server is up (e.g. "llama3.2:latest"). */
  models?: string[];
}

/** The one thing setup still needs: install Ollama, pull the model, or nothing (ready) — or web. */
export type SetupStep = "web" | "needs-ollama" | "needs-model" | "ready";

/** Decide the next setup action from a status probe. Pure, so the UI just renders the disclosure. */
export function nextSetupStep(s: LlmRuntimeStatus, opts: { isDesktop: boolean; model?: string }): SetupStep {
  if (!opts.isDesktop) return "web"; // the web build can't install anything
  if (!s.available) return "needs-ollama"; // server unreachable — install / start it
  const want = (opts.model ?? DEFAULT_MODEL).split(":")[0];
  const has = (s.models ?? []).some((m) => m.split(":")[0] === want);
  return has ? "ready" : "needs-model";
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function llmStatus(): Promise<LlmRuntimeStatus> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const s = (await invoke("ollama_status")) as { available: boolean; version?: string; models?: string[] };
      return { available: s.available, runtime: s.available ? "ollama" : "rules-only", version: s.version, models: s.models };
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

/** Pull a model via the native side (`ollama pull`). Rejects with the reason so the UI can show it. */
export async function pullModel(model: string = DEFAULT_MODEL): Promise<boolean> {
  if (!isTauri()) throw new Error("Downloading a model needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("pull_model", { model })) as boolean;
}

export function describeStatus(s: LlmRuntimeStatus): string {
  return s.available ? `LLM · ollama${s.version ? ` ${s.version}` : ""}` : "LLM · rules-only";
}
