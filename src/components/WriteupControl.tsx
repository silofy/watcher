import { useState, useEffect, useRef } from "react";
import { useReport } from "../store/report";
import { machineOf } from "../lib/machine";
import { resolveProvider } from "../lib/llm";
import { goldenFromText } from "../lib/writeup";

type Status = { kind: "idle" | "working" | "error"; msg?: string };

const SRC: Record<string, string> = { "htb-official": "HTB official", "0xdf": "0xdf", "ippsec-notes": "IppSec notes", "htb-auto": "HTB", pasted: "pasted write-up" };

/**
 * Layer-2 trigger: paste a box write-up, the local model extracts the intended objective path, and
 * the report re-aligns your run against it. Offline by default — the text you paste is read by the
 * local model only; your session never leaves the machine.
 */
export function WriteupControl() {
  const { report, applyGoldenDag, writeup } = useReport();
  const box = machineOf(report);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const hasDag = report.golden_dag.length > 0;
  const autoTried = useRef<string | null>(null);

  async function analyze(source: string, sourceLabel?: string) {
    const input = source.trim();
    if (!input) return;
    setStatus({ kind: "working", msg: "Reading the write-up with the local model…" });
    try {
      const provider = await resolveProvider();
      const res = await goldenFromText(input, { name: box.name, os: report.session.machine?.os ?? null }, provider, sourceLabel);
      if (res.golden.length === 0) {
        setStatus({ kind: "error", msg: res.note });
        return;
      }
      applyGoldenDag(res.golden, { source: res.source, confidence: res.confidence });
      setStatus({ kind: "idle" });
      setText("");
      setOpen(false);
    } catch {
      setStatus({ kind: "error", msg: "Extraction failed — is the local model reachable?" });
    }
  }

  // Auto-overlay: when the extension has pulled a write-up from HTB and no reference is applied yet,
  // extract it automatically (once per session). Manual paste below stays as the fallback.
  useEffect(() => {
    const wt = report.writeup_text;
    const key = report.session.uuid;
    if (wt && !hasDag && autoTried.current !== key) {
      autoTried.current = key;
      void analyze(wt, "htb-auto");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.session.uuid, report.writeup_text, hasDag]);

  return (
    <div className="mb-3 rounded-lg border border-edge bg-panel-2/40 p-3">
      {/* one source-of-truth row: provenance on the left, replace/add on the right — same control either way */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="label text-faint">Reference path</span>
        {writeup ? (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm">
            <span className="text-match">✓</span>
            <span className="font-semibold text-fg">{SRC[writeup.source] ?? writeup.source}</span>
            <span className="text-muted">write-up</span>
            <span className="text-xs text-faint">· {Math.round(writeup.confidence * 100)}% extraction confidence</span>
          </span>
        ) : (
          <span className="text-sm text-muted">
            None yet — <span className="text-fg">grading your run only</span>. Auto-pulls for retired boxes, or add one now.
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="label ml-auto rounded border border-signal/50 px-2 py-1 text-signal transition-colors hover:bg-signal/15"
        >
          {open ? "Cancel" : hasDag ? "Replace" : "Add write-up"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={`Paste a write-up for ${box.name} (HTB official, 0xdf, IppSec notes, GitHub…). It's read locally to extract the intended path.`}
            className="mono w-full resize-y rounded border border-edge bg-ink/60 p-2 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => analyze(text, "pasted")}
              disabled={status.kind === "working" || !text.trim()}
              className="label rounded bg-signal/20 px-3 py-1 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40"
            >
              {status.kind === "working" ? "Analyzing…" : "Analyze"}
            </button>
            <span className="text-xs text-faint">Offline — only the text above is read by the local model; your session stays on this machine.</span>
          </div>
          {status.kind === "error" && status.msg && <p className="text-xs text-detour">{status.msg}</p>}
        </div>
      )}
    </div>
  );
}
