import { useState, useEffect } from "react";
import { useReport } from "../store/report";
import { machineOf } from "../lib/machine";
import { resolveProvider } from "../lib/llm";
import { goldenFromText } from "../lib/writeup";
import { fetchWriteupUrl, fetchWriteupFrom0xdf, writeupSearchUrl, isDesktop, hasHtbToken, setHtbToken, fetchHtbWriteup } from "../lib/net";

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
  const [htbReady, setHtbReady] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const hasDag = report.golden_dag.length > 0;
  const working = status.kind === "working";

  useEffect(() => {
    hasHtbToken().then(setHtbReady);
  }, []);

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

  async function fromHtb() {
    if (!(await hasHtbToken())) {
      setShowToken(true);
      return;
    }
    setStatus({ kind: "working", msg: `Fetching HTB's official write-up for ${box.name}…` });
    try {
      const content = await fetchHtbWriteup(box.name);
      await extract(content, "htb-official");
    } catch (e) {
      setStatus({ kind: "error", msg: `${e instanceof Error ? e.message : "HTB fetch failed"} — or use URL / paste.` });
    }
  }

  async function saveToken() {
    const t = tokenInput.trim();
    if (!t) return;
    try {
      await setHtbToken(t);
      setTokenInput("");
      setShowToken(false);
      setHtbReady(true);
      await fromHtb(); // token in place — go straight to the fetch
    } catch (e) {
      setStatus({ kind: "error", msg: e instanceof Error ? e.message : "Couldn't save the token." });
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-panel-2/50 px-4 py-3">
      {/* header: title + how-to-add actions on one aligned row */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="label text-faint">Reference path</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {!writeup && <span className="label text-xs text-faint">Load from</span>}
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
          {isDesktop() ? (
            <button
              type="button"
              onClick={fromHtb}
              disabled={working}
              title={htbReady ? `Fetch HTB's official write-up for ${box.name}` : "Add your HTB App Token to auto-fetch the official write-up"}
              className="rounded border border-edge px-2 py-1 text-xs text-muted transition-colors hover:text-fg disabled:opacity-40"
            >
              HTB{htbReady ? "" : " ⚙"}
            </button>
          ) : (
            <a
              href={writeupSearchUrl("htb", box.name)}
              target="_blank"
              rel="noreferrer"
              title="HTB write-ups are auth-gated — opens a search to find it"
              className="rounded border border-edge px-2 py-1 text-xs text-muted transition-colors hover:text-fg"
            >
              HTB ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded border border-edge px-2 py-1 text-xs text-muted transition-colors hover:text-fg"
          >
            {open ? "Cancel" : hasDag ? "Replace" : "URL / paste"}
          </button>
        </div>
      </div>

      {/* status / explanation on its own full-width line */}
      <div className="mt-2 text-sm">
        {writeup ? (
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span className="text-match">✓</span>
            <span className="font-semibold text-fg">{SRC[writeup.source] ?? writeup.source}</span>
            <span className="text-muted">write-up</span>
            <span className="text-xs text-faint">· {Math.round(writeup.confidence * 100)}% extraction confidence</span>
          </span>
        ) : (
          <div className="space-y-1">
            <p className="text-muted">
              No reference yet — we grade <span className="text-fg">how</span> you worked, not <span className="text-fg">what</span> you did. Link this box's write-up to compare your path against the intended solution — surfacing detours, skipped steps, and missed objectives.
            </p>
            <p className="text-xs text-faint">
              {box.retired
                ? "This box is retired, so community write-ups are available."
                : "Write-ups are usually published once a box retires — active boxes may not have one yet."}
            </p>
          </div>
        )}
      </div>

      {showToken && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-3">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveToken()}
            placeholder="Paste your HTB App Token (HTB profile → settings)"
            className="mono min-w-0 flex-1 rounded border border-edge bg-ink/60 p-2 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
          />
          <button
            type="button"
            onClick={saveToken}
            disabled={working || !tokenInput.trim()}
            className="label rounded bg-signal/20 px-3 py-1.5 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40"
          >
            Save &amp; fetch
          </button>
          <span className="w-full text-xs text-faint">Stored locally on this machine — never uploaded. Retired write-ups need HTB VIP.</span>
        </div>
      )}

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
