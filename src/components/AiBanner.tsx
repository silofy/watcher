import { useEffect, useState } from "react";
import { llmStatus, type LlmRuntimeStatus } from "../lib/llm/runtime";

/**
 * Transparency strip: when the local model is on, parts of the coaching are AI-rewritten, so say so
 * plainly. Only the steps tagged `ai` are model output; everything else in the report is deterministic.
 */
export function AiBanner() {
  const [status, setStatus] = useState<LlmRuntimeStatus | null>(null);
  useEffect(() => {
    llmStatus().then(setStatus);
  }, []);

  if (!status?.available) return null;

  return (
    <div className="border-b border-match/25 bg-match/[0.06]">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-5 py-1.5 text-xs">
        <span className="text-match" aria-hidden>
          ⦿
        </span>
        <span className="text-muted">
          <span className="font-medium text-match">Local AI is on</span> — coaching steps tagged{" "}
          <span className="mono rounded bg-signal/20 px-1 text-signal">ai</span> are rewritten by your local model, offline. Everything else in this report is computed
          deterministically.
        </span>
      </div>
    </div>
  );
}
