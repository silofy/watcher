import { useState } from "react";
import { useReport } from "../store/report";
import { machineOf } from "../lib/machine";
import { resolveProvider } from "../lib/llm";
import { goldenFromText } from "../lib/writeup";
import { fetchWriteupUrl, fetchWriteupFrom0xdf, writeupSearchUrl } from "../lib/net";

type Status = { kind: "idle" | "working" | "error"; msg?: string };

const SRC: Record<string, string> = { "htb-official": "HTB official", "0xdf": "0xdf", "ippsec-notes": "IppSec notes", "htb-auto": "HTB", pasted: "pasted write-up" };

/**
 * Reference-path control — the high-level "unlock the comparison" action, docked at the top of the
 * debrief where the key takeaway lives. Quick source shortcuts (0xdf auto-fetches via its sitemap;
 * IppSec/HTB open a search since video/auth-gated content can't be auto-extracted), plus URL and
 * paste. Everything is read by the local model only; your session never leaves the machine.
 */
export function WriteupControl() {
  const { report, applyGoldenDag, writeup } = useReport();
  const box = machineOf(report);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const hasDag = report.golden_dag.length > 0;
  const working = status.kind === "working";

  async function extract(content: string, sourceLabel: string) {
    if (!content.trim()) return;
    setStatus({ kind: "working", msg: "Reading the write-up with the local model…" });
    try {
      const provider = await resolveProvider();
      const res = await goldenFromText(content, { name: box.name, os: report.session.machine?.os ?? null }, provider, sourceLabel);
      if (res.golden.length === 0) {
        setStatus({ kind: "error", msg: res.note ?? "Couldn't extract an intended path from that — try a fuller write-up." });
        return;
      }
      applyGoldenDag(res.golden, { source: res.source, confidence: res.confidence });
      setStatus({ kind: "idle" });
      setText("");
      setUrl("");
      setOpen(false);
    } catch {
      setStatus({ kind: "error", msg: "Extraction failed — is the local model reachable?" });
    }
  }

  async function fromUrl(u: string) {
    if (!u.trim()) return;
    setStatus({ kind: "working", msg: "Fetching the write-up…" });
    try {
      const content = await fetchWriteupUrl(u.trim());
      await extract(content, "pasted");
    } catch {
      setStatus({ kind: "error", msg: "Couldn't fetch that URL — check the link, or paste the write-up text instead." });
    }
  }

  async function from0xdf() {
    setStatus({ kind: "working", msg: `Finding 0xdf's write-up for ${box.name}…` });
    try {
      const content = await fetchWriteupFrom0xdf(box.name);
      await extract(content, "0xdf");
    } catch (e) {
      setStatus({ kind: "error", msg: e instanceof Error ? e.message : "0xdf lookup failed — paste the URL instead." });
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-panel-2/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="label text-faint">Reference path</span>
        {writeup ? (
          <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
            <span className="text-match">✓</span>
            <span className="font-semibold text-fg">{SRC[writeup.source] ?? writeup.source}</span>
            <span className="text-muted">write-up</span>
            <span className="text-xs text-faint">· {Math.round(writeup.confidence * 100)}% extraction confidence</span>
          </span>
        ) : (
          <span className="text-sm text-muted">
            None yet — <span className="text-fg">grading your run only</span>. Add one to unlock the comparison.
          </span>
        )}

        {/* quick source shortcuts — choose a source instead of hunting for a URL */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={from0xdf}
            disabled={working}
            title={`Auto-fetch 0xdf's write-up for ${box.name}`}
            className="rounded border border-signal/50 px-2 py-1 text-xs font-medium text-signal transition-colors hover:bg-signal/15 disabled:opacity-40"
          >
            0xdf
          </button>
          <a
            href={writeupSearchUrl("ippsec", box.name)}
            target="_blank"
            rel="noreferrer"
            title="IppSec is video — opens a search to find it"
            className="rounded border border-edge px-2 py-1 text-xs text-muted transition-colors hover:text-fg"
          >
            IppSec ↗
          </a>
          <a
            href={writeupSearchUrl("htb", box.name)}
            target="_blank"
            rel="noreferrer"
            title="HTB write-ups are auth-gated — opens a search to find it"
            className="rounded border border-edge px-2 py-1 text-xs text-muted transition-colors hover:text-fg"
          >
            HTB ↗
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded border border-edge px-2 py-1 text-xs text-muted transition-colors hover:text-fg"
          >
            {open ? "Cancel" : hasDag ? "Replace" : "URL / paste"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-edge/60 pt-3">
          {/* URL */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fromUrl(url)}
              placeholder={`Write-up URL for ${box.name} (0xdf, a GitHub gist, any page)`}
              className="mono min-w-0 flex-1 rounded border border-edge bg-ink/60 p-2 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
            />
            <button
              type="button"
              onClick={() => fromUrl(url)}
              disabled={working || !url.trim()}
              className="label rounded bg-signal/20 px-3 py-1.5 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40"
            >
              Fetch
            </button>
          </div>
          {/* paste */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="…or paste the write-up text here. Read locally to extract the intended path — nothing is uploaded."
            className="mono w-full resize-y rounded border border-edge bg-ink/60 p-2 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => extract(text, "pasted")}
              disabled={working || !text.trim()}
              className="label rounded bg-signal/20 px-3 py-1 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40"
            >
              {working ? status.msg ?? "Analyzing…" : "Analyze"}
            </button>
            <span className="text-xs text-faint">Offline — read by the local model only; your session stays on this machine.</span>
          </div>
        </div>
      )}

      {status.kind === "error" && status.msg && <p className="mt-2 text-xs text-detour">{status.msg}</p>}
      {working && !open && <p className="mt-2 text-xs text-faint">{status.msg}</p>}
    </div>
  );
}
