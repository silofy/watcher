import { useState, useEffect } from "react";
import { useReport } from "../store/report";
import { machineOf } from "../lib/machine";
import { targetOf, thmAdapter } from "../lib/platform";
import { resolveProvider } from "../lib/llm";
import { goldenFromText } from "../lib/writeup";
import { fetchWriteupUrl, fetchWriteupFrom0xdf, writeupSearchUrl, isDesktop, hasHtbToken, setHtbToken, fetchHtbWriteup, openExternal } from "../lib/net";

type Status = { kind: "idle" | "working" | "error"; msg?: string };

const SRC: Record<string, string> = { "htb-official": "HTB official", "0xdf": "0xdf", "ippsec-notes": "IppSec notes", "htb-auto": "HTB", pasted: "pasted write-up" };

/** Tauri rejects a command with the raw `Err(String)`, not an Error — surface either form. */
function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/**
 * Reference-path control — a minimal accordion docked just under the identity band. Collapsed it's a
 * one-line status; expanded it offers the load actions (0xdf auto-fetches via its sitemap; IppSec/HTB
 * open a search or fetch with a token; plus URL and paste). Read by the local model only.
 */
export function WriteupControl() {
  const { report, applyGoldenDag, writeup } = useReport();
  const box = machineOf(report);
  const target = targetOf(report);
  const isThm = target.platform === "thm";
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [htbReady, setHtbReady] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const working = status.kind === "working";

  useEffect(() => {
    hasHtbToken().then(setHtbReady);
  }, []);

  async function extract(content: string, sourceLabel: string) {
    if (!content.trim()) return;
    if (isThm && sourceLabel === "pasted") {
      const tree = await thmAdapter.intendedPath!({ target, raw: content });
      if (tree) {
        applyGoldenDag(tree, { source: "thm-tasks", confidence: 0.7 });
        setStatus({ kind: "idle" });
        setText("");
        setUrl("");
        return;
      }
    }
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
    } catch {
      setStatus({ kind: "error", msg: "Extraction failed — is the local model reachable?" });
    }
  }

  async function fromUrl(u: string) {
    if (!u.trim()) return;
    setStatus({ kind: "working", msg: "Fetching the write-up…" });
    try {
      await extract(await fetchWriteupUrl(u.trim()), "pasted");
    } catch {
      setStatus({ kind: "error", msg: "Couldn't fetch that URL — check the link, or paste the write-up text instead." });
    }
  }

  async function from0xdf() {
    setStatus({ kind: "working", msg: `Finding 0xdf's write-up for ${box.name}…` });
    try {
      await extract(await fetchWriteupFrom0xdf(box.name), "0xdf");
    } catch (e) {
      setStatus({ kind: "error", msg: errMsg(e, "0xdf lookup failed — paste the URL instead.") });
    }
  }

  async function fromHtb() {
    if (!(await hasHtbToken())) {
      setShowToken(true);
      return;
    }
    setStatus({ kind: "working", msg: `Fetching HTB's official write-up for ${box.name}…` });
    try {
      await extract(await fetchHtbWriteup(box.name), "htb-official");
    } catch (e) {
      setStatus({ kind: "error", msg: `${errMsg(e, "HTB fetch failed")} — or use URL / paste.` });
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
      await fromHtb();
    } catch (e) {
      setStatus({ kind: "error", msg: errMsg(e, "Couldn't save the token.") });
    }
  }

  const btnSecondary =
    "rounded-md border border-edge px-2.5 py-1 text-xs text-muted transition-colors hover:border-edge-bright hover:text-fg disabled:opacity-40";

  return (
    <details className="group border-b border-edge">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-faint">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            <span className="label">Writeup reference</span>
          </span>
          {writeup ? (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="text-match">✓</span>
              <span className="font-medium text-fg">{SRC[writeup.source] ?? writeup.source}</span>
              <span className="text-xs text-faint">· {Math.round(writeup.confidence * 100)}%</span>
            </span>
          ) : (
            <span className="text-sm text-muted">
              None yet — <span className="text-fg">grading your run only</span>
            </span>
          )}
        </div>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-faint">
          {writeup ? "Replace" : "Add to compare"}
          <span className="transition-transform group-open:rotate-90">▸</span>
        </span>
      </summary>

      <div className="space-y-2.5 pb-3">
        {!writeup && (
          <p className="text-xs leading-relaxed text-faint">
            We grade <span className="text-muted">how</span> you worked, not <span className="text-muted">what</span> you did — link this box's write-up to compare your route against the intended solution: detours, skipped steps, and missed objectives.
          </p>
        )}

        {/* load actions */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="label shrink-0 text-faint">Load from</span>
          <button
            type="button"
            onClick={from0xdf}
            disabled={working}
            title={`Auto-fetch 0xdf's write-up for ${box.name}`}
            className="rounded-md bg-signal px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:bg-signal/90 disabled:opacity-40"
          >
            0xdf
          </button>
          <button type="button" onClick={() => openExternal(writeupSearchUrl("ippsec", box.name))} title="IppSec is video — opens his walkthrough on YouTube" className={btnSecondary}>
            IppSec ↗
          </button>
          {isDesktop() ? (
            <button type="button" onClick={fromHtb} disabled={working} title={htbReady ? "Fetch HTB's official write-up" : "Add your HTB App Token first"} className={btnSecondary}>
              HTB{htbReady ? "" : " ⚙"}
            </button>
          ) : (
            <button type="button" onClick={() => openExternal(writeupSearchUrl("htb", box.name))} title="HTB write-ups are auth-gated — opens a search" className={btnSecondary}>
              HTB ↗
            </button>
          )}
          <span className="mx-1 text-faint">or</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fromUrl(url)}
            placeholder="paste a write-up URL…"
            className="mono min-w-0 flex-1 rounded-md border border-edge bg-ink/60 px-2 py-1 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
          />
          <button type="button" onClick={() => fromUrl(url)} disabled={working || !url.trim()} className="label rounded-md bg-signal/20 px-2.5 py-1 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40">
            Fetch
          </button>
        </div>

        {showToken && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveToken()}
              placeholder="Paste your HTB App Token (profile → settings) — stored locally, needs VIP"
              className="mono min-w-0 flex-1 rounded-md border border-edge bg-ink/60 px-2 py-1 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
            />
            <button type="button" onClick={saveToken} disabled={working || !tokenInput.trim()} className="label rounded-md bg-fg px-2.5 py-1 text-ink transition-colors hover:bg-fg/90 disabled:opacity-40">
              Save &amp; fetch
            </button>
          </div>
        )}

        {/* paste */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={
            isThm
              ? "…or paste the room's tasks here (Task 1 — Title, Task 2 — Title, …). Read locally — nothing is uploaded."
              : "…or paste the write-up text here. Read locally to extract the intended path — nothing is uploaded."
          }
          className="mono w-full resize-y rounded-md border border-edge bg-ink/60 px-2 py-1.5 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => extract(text, "pasted")} disabled={working || !text.trim()} className="label rounded-md bg-signal/20 px-2.5 py-1 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40">
            {working ? "Working…" : "Analyze"}
          </button>
          {status.kind === "error" && status.msg ? (
            <span className="text-xs text-detour">{status.msg}</span>
          ) : working ? (
            <span className="text-xs text-faint">{status.msg}</span>
          ) : (
            <span className="text-xs text-faint">Offline — your session stays on this machine.</span>
          )}
        </div>
      </div>
    </details>
  );
}
