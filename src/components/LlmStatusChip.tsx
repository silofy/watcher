import { useEffect, useState } from "react";
import { llmStatus, startOllama, describeStatus, type LlmRuntimeStatus } from "../lib/llm/runtime";

/**
 * Live offline-LLM status (brief §5.1). Shows "ollama" when a local model is reachable, else
 * "rules-only". In the desktop shell, clicking when rules-only asks the Tauri backend to start the
 * Ollama sidecar. Refinement itself stays deterministic-first regardless.
 */
export function LlmStatusChip() {
  const [status, setStatus] = useState<LlmRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => llmStatus().then(setStatus);
  useEffect(() => {
    refresh();
  }, []);

  if (!status) return null;
  const color = status.available ? "var(--color-match)" : "var(--color-faint)";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (status.available) return;
        setBusy(true);
        await startOllama();
        await refresh();
        setBusy(false);
      }}
      title={status.available ? "Offline LLM refinement available" : "Rules-only — click to start the Ollama sidecar (desktop)"}
      className="rounded-full border border-edge px-2 py-0.5 transition-colors hover:bg-panel-2 disabled:opacity-50"
      style={{ color }}
    >
      {busy ? "LLM · starting…" : describeStatus(status)}
    </button>
  );
}
