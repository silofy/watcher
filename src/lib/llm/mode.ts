/**
 * The chosen coaching model, persisted locally. Default is `local` — try Ollama, fall back to rules —
 * preserving the offline-first behavior. Cloud modes are a deliberate opt-in the user selects.
 */
import type { CloudName } from "./cloud";

export type CoachMode = "rules" | "local" | CloudName;

const KEY = "watcher.coachMode";

export function getCoachMode(): CoachMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "rules" || v === "local" || v === "anthropic" || v === "openai" || v === "gemini" || v === "openrouter") return v;
  } catch {
    /* no localStorage (SSR / tests) */
  }
  return "local";
}

export function setCoachMode(mode: CoachMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}

/** True for the modes that keep everything on the device (used to drive the offline/leaves-device UI). */
export function isOffline(mode: CoachMode): boolean {
  return mode === "rules" || mode === "local";
}
