import { useState } from "react";
import { useReport } from "../store/report";
import { MachineAvatar } from "./MachineAvatar";
import { DIFFICULTY_COLOR } from "../lib/machine";
import { targetOf, adapterFor } from "../lib/platform";
import { resolveProvider } from "../lib/llm";
import { goldenFromText } from "../lib/writeup";
import { fetchWriteupUrl, isDesktop } from "../lib/net";

type Status = { kind: "idle" | "working" | "error"; msg?: string };

/**
 * The write-up gate. The comparison half of the report (coverage, "what you'd do differently", the
 * golden path) is measured against the box's intended path — extracted from a write-up. With none
 * applied, there's nothing to grade against, so we ask for one up front rather than show a half report.
 */
export function WriteupGate() {
  const { report, applyGoldenDag, setGateDismissed } = useReport();
  const target = targetOf(report);
  const isThm = target.platform === "thm";
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function analyze() {
    const input = text.trim();
    if (!input) return;
    try {
      let content = input;
      if (/^https?:\/\/\S+$/.test(input)) {
        setStatus({ kind: "working", msg: "Fetching the write-up…" });
        try {
          content = await fetchWriteupUrl(input);
        } catch {
          setStatus({
            kind: "error",
            msg: isDesktop()
              ? "Couldn't fetch that URL — check the link, or paste the write-up text instead."
              : "URL fetch needs the desktop app (the browser blocks cross-origin reads). Paste the write-up text instead.",
          });
          return;
        }
      }
      // Try the target's native intended-path first (any adapter that has one — currently just THM's
      // task list) before falling back to write-up extraction below.
      const adapter = adapterFor(target.platform);
      if (adapter?.intendedPath) {
        const tree = await adapter.intendedPath({ target, raw: content });
        if (tree) {
          applyGoldenDag(tree, { source: adapter.id === "thm" ? "thm-tasks" : `${adapter.id}-native`, confidence: 0.7 });
          // golden_dag is now populated → the gate condition clears and the full debrief renders
          return;
        }
      }

      setStatus({ kind: "working", msg: "Reading the write-up with the local model…" });
      const provider = await resolveProvider();
      const res = await goldenFromText(content, { name: target.name, os: report.session.machine?.os ?? null }, provider, "pasted");
      if (res.golden.length === 0) {
        setStatus({ kind: "error", msg: res.note ?? "Couldn't extract an intended path from that — try a fuller write-up." });
        return;
      }
      applyGoldenDag(res.golden, { source: res.source, confidence: res.confidence });
      // golden_dag is now populated → the gate condition clears and the full debrief renders
    } catch {
      setStatus({ kind: "error", msg: "Extraction failed — is the local model reachable? You can still paste plain numbered steps." });
    }
  }

  const working = status.kind === "working";

  return (
    <div className="mx-auto max-w-2xl py-6">
      {/* the target you're debriefing */}
      <div className="mb-5 flex items-center gap-3">
        <MachineAvatar target={target} size={44} />
        <div>
          <div className="font-display text-xl font-semibold text-fg">{target.name}</div>
          <div className="flex items-center gap-1.5">
            {target.difficulty?.label && (
              <span className="label rounded border border-edge px-1.5 py-0.5 text-xs" style={{ color: DIFFICULTY_COLOR[target.difficulty.label] }}>
                {target.difficulty.label}
              </span>
            )}
            {target.os && <span className="label rounded border border-edge px-1.5 py-0.5 text-xs">{target.os}</span>}
          </div>
        </div>
      </div>

      <h2 className="font-display text-2xl font-semibold text-fg">One step before your debrief</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The Watcher grades your run against the {target.kind}'s <span className="text-fg">intended path</span> — coverage, where you went off-route, what you'd do differently. That path is
        extracted from a <span className="text-fg">write-up</span>. Give it one to unlock the full report.
      </p>

      <div className="mt-4 rounded-lg border border-edge bg-panel p-4">
        <div className="label mb-2 text-faint">{isThm ? "Paste the room's tasks" : "Paste a write-up — text or a URL"}</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            isThm
              ? `Paste the room's task list for ${target.name} (Task 1 — Title, Task 2 — Title, …), or a write-up / link. Read locally — nothing is uploaded.`
              : `Paste a write-up for ${target.name} (HTB official, 0xdf, IppSec notes…), or a link to one. It's read locally to extract the intended path — nothing is uploaded.`
          }
          className="mono w-full resize-y rounded border border-edge bg-ink/60 p-2.5 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={analyze}
            disabled={working || !text.trim()}
            className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {working ? status.msg ?? "Analyzing…" : "Analyze & open report →"}
          </button>
          <span className="text-xs text-faint">Offline — read by the local model only; your session stays on this machine.</span>
        </div>
        {status.kind === "error" && status.msg && <p className="mt-2 text-xs text-detour">{status.msg}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3 text-sm">
        <button type="button" onClick={() => setGateDismissed(true)} className="text-faint transition-colors hover:text-muted">
          Skip — just analyze my own run
        </button>
      </div>
    </div>
  );
}
