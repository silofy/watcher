import { useEffect, useState } from "react";
import { llmStatus, startOllama, describeStatus, type LlmRuntimeStatus } from "../lib/llm/runtime";

/**
 * Local-LLM control (brief §5.1) — the toggle for AI-refined coaching. Teal + a live dot when a local
 * model is reachable; otherwise a clear "enable" affordance that asks the Tauri backend to start the
 * Ollama sidecar. A hover/focus popover explains exactly what on/off changes. Coaching itself stays
 * deterministic-first either way (off = rules-based, not absent).
 */
export function LlmStatusChip() {
  const [status, setStatus] = useState<LlmRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => llmStatus().then(setStatus);
  useEffect(() => {
    refresh();
  }, []);

  if (!status) return null;
  const on = status.available;

  return (
    <div className="group relative">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (on) return;
          setBusy(true);
          await startOllama();
          await refresh();
          setBusy(false);
        }}
        aria-label={on ? "Local AI coaching is on" : "Local AI coaching is off — click to enable"}
        className={`flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-60 ${
          on ? "cursor-default border-match/40 bg-match/10 text-match" : "border-edge text-muted hover:border-signal/60 hover:bg-panel-2 hover:text-fg"
        }`}
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          {on && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-match opacity-50" />}
          <span className="relative h-2 w-2 rounded-full" style={{ background: on ? "var(--color-match)" : "var(--color-faint)" }} />
        </span>
        <span>{busy ? "Local AI · starting…" : on ? "Local AI · on" : "Local AI · off"}</span>
        {!on && !busy && <span className="text-faint transition-colors group-hover:text-signal">enable →</span>}
      </button>

      {/* hover / focus explainer — pt-2 keeps the hover bridge so it doesn't flicker on the gap */}
      <div className="invisible absolute right-0 top-full z-20 w-80 pt-2 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="rounded-lg border border-edge bg-panel p-3 text-left shadow-xl">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: on ? "var(--color-match)" : "var(--color-faint)" }} />
            <span className="label text-fg">Local AI coaching · {on ? "on" : "off"}</span>
          </div>

          {on ? (
            <p className="text-xs leading-relaxed text-muted">
              Your coaching steps are sharpened by a local model (<span className="mono text-fg">{describeStatus(status)}</span>): each one is rewritten into a specific
              suggestion that names the exact command, result, and the better move — those carry an{" "}
              <span className="mono rounded bg-signal/20 px-1 text-signal">ai</span> badge.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted">
              Coaching is <span className="text-fg">rules-based</span> right now — accurate, but templated. Turn it on and a local model rewrites each step into a
              specific suggestion grounded in your actual command and its output (the ones that earn an{" "}
              <span className="mono rounded bg-signal/20 px-1 text-signal">ai</span> badge). Nothing else in the report changes.
            </p>
          )}

          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-match">
            <span aria-hidden>⦿</span>
            <span>Runs entirely on your machine via Ollama — fully offline. Your commands are sent to the local model only; your session never leaves the device.</span>
          </p>

          {!on && (
            <p className="mt-2 border-t border-edge pt-2 text-xs text-faint">
              Click to start it. Needs the desktop app with <span className="mono">ollama</span> installed; on the web build it stays rules-based.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
