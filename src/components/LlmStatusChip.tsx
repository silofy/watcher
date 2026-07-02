import { useEffect, useRef, useState } from "react";
import {
  llmStatus,
  startOllama,
  pullModel,
  nextSetupStep,
  DEFAULT_MODEL,
  OLLAMA_DOWNLOAD_URL,
  getCoachMode,
  setCoachMode,
  CLOUD_LABEL,
  CLOUD_DEFAULT_MODEL,
  hasApiKey,
  setApiKey,
  clearApiKey,
  type CoachMode,
  type CloudName,
  type LlmRuntimeStatus,
} from "../lib/llm";
import { isDesktop, openExternal } from "../lib/net";

function errMsg(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

const OPTIONS: { mode: CoachMode; label: string; sub: string }[] = [
  { mode: "rules", label: "Rules-based", sub: "Deterministic · nothing runs" },
  { mode: "local", label: "Local (Ollama)", sub: "On your machine · offline" },
  { mode: "anthropic", label: "Claude", sub: "Cloud · leaves device" },
  { mode: "openai", label: "ChatGPT", sub: "Cloud · leaves device" },
  { mode: "gemini", label: "Gemini", sub: "Cloud · leaves device" },
  { mode: "openrouter", label: "OpenRouter", sub: "Cloud · leaves device" },
];

const CLOUD_NAMES: CloudName[] = ["anthropic", "openai", "gemini", "openrouter"];
const asCloud = (m: CoachMode): CloudName | null => (CLOUD_NAMES as string[]).includes(m) ? (m as CloudName) : null;

/**
 * Coaching-model selector — replaces the old on/off "Local AI" chip. Pick rules-based, a local Ollama
 * (guided setup), or a cloud model (Claude / ChatGPT / OpenRouter / Gemini). Cloud is a deliberate opt-in: it
 * carries a data-leaves-device warning and a note that commands are redacted before they're sent.
 */
export function LlmStatusChip() {
  const [status, setStatus] = useState<LlmRuntimeStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CoachMode>(getCoachMode());
  const [cloudReady, setCloudReady] = useState<Record<CloudName, boolean>>({ anthropic: false, openai: false, gemini: false, openrouter: false });
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState<null | "starting" | "pulling">(null);
  const [err, setErr] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const refresh = () => llmStatus().then(setStatus);
  useEffect(() => {
    refresh();
    for (const p of CLOUD_NAMES) hasApiKey(p).then((ok) => setCloudReady((r) => ({ ...r, [p]: ok })));
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const desktop = isDesktop();
  const ollamaStep = status ? nextSetupStep(status, { isDesktop: desktop, model: DEFAULT_MODEL }) : "needs-ollama";
  const cloud = asCloud(mode);

  // trigger label + status dot for the currently active mode
  const active =
    mode === "rules"
      ? { label: "rules", dot: "var(--color-faint)" }
      : mode === "local"
        ? ollamaStep === "ready"
          ? { label: "local", dot: "var(--color-match)" }
          : { label: "setup", dot: "var(--color-stuck)" }
        : cloudReady[cloud!]
          ? { label: CLOUD_LABEL[cloud!], dot: "var(--color-signal)" }
          : { label: `${CLOUD_LABEL[cloud!]} · key`, dot: "var(--color-stuck)" };

  function choose(m: CoachMode) {
    setMode(m);
    setCoachMode(m);
    setErr(null);
    setKeyDraft("");
  }

  async function localAction() {
    if (busy) return;
    setErr(null);
    if (ollamaStep === "needs-ollama") {
      setBusy("starting");
      const started = await startOllama();
      await refresh();
      setBusy(null);
      if (!started) setErr("Ollama isn't installed — get it below, then click again.");
    } else if (ollamaStep === "needs-model") {
      setBusy("pulling");
      try {
        await pullModel(DEFAULT_MODEL);
        await refresh();
      } catch (e) {
        setErr(errMsg(e, "Model download failed."));
      }
      setBusy(null);
    }
  }

  async function saveKey(p: CloudName) {
    const k = keyDraft.trim();
    if (!k) return;
    try {
      await setApiKey(p, k);
      setCloudReady((r) => ({ ...r, [p]: true }));
      setKeyDraft("");
      setErr(null);
    } catch (e) {
      setErr(errMsg(e, "Couldn't save the key."));
    }
  }

  async function removeKey(p: CloudName) {
    await clearApiKey(p);
    setCloudReady((r) => ({ ...r, [p]: false }));
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Coaching model"
        className="flex h-9 items-center gap-2 rounded-full border border-edge px-4 text-sm font-medium text-muted transition-colors hover:border-signal/60 hover:bg-panel-2 hover:text-fg"
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          {mode === "local" && ollamaStep === "ready" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-match opacity-50" />}
          <span className="relative h-2 w-2 rounded-full" style={{ background: active.dot }} />
        </span>
        <span>AI · {busy === "pulling" ? "downloading…" : busy === "starting" ? "starting…" : active.label}</span>
        <span className="text-faint transition-colors group-hover:text-signal">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-edge bg-panel p-2 text-left shadow-xl">
          <div className="label px-2 pb-1 pt-1 text-faint">Coaching model</div>

          {/* mode list */}
          <div className="space-y-0.5">
            {OPTIONS.map((o) => {
              const selected = o.mode === mode;
              const isCloud = asCloud(o.mode);
              return (
                <button
                  key={o.mode}
                  type="button"
                  onClick={() => choose(o.mode)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors ${selected ? "bg-panel-2" : "hover:bg-panel-2/60"}`}
                >
                  <span className="flex flex-col">
                    <span className="text-sm text-fg">{o.label}</span>
                    <span className="text-xs text-faint">{o.sub}</span>
                  </span>
                  {isCloud && cloudReady[isCloud] && <span className="text-xs text-match">✓ key</span>}
                  {selected && <span className="ml-2 text-signal">●</span>}
                </button>
              );
            })}
          </div>

          <div className="my-2 h-px bg-edge" />

          {/* contextual panel for the selected mode */}
          {mode === "rules" && (
            <p className="px-2 pb-1 text-xs leading-relaxed text-muted">Accurate but templated — steps come from the deterministic rules. No model runs; nothing leaves the device.</p>
          )}

          {mode === "local" && (
            <div className="px-2 pb-1 text-xs leading-relaxed">
              <p className="flex items-start gap-1.5 text-match">
                <span aria-hidden>⦿</span>
                <span>Runs on your machine via Ollama — fully offline. Commands go to the local model only.</span>
              </p>
              {desktop ? (
                ollamaStep === "ready" ? (
                  <p className="mt-1.5 text-faint">Ready — coaching steps are rewritten by <span className="mono">{DEFAULT_MODEL}</span>, tagged <span className="mono rounded bg-signal/20 px-1 text-signal">ai</span>.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={localAction} disabled={!!busy} className="label rounded bg-signal/20 px-2.5 py-1 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40">
                      {ollamaStep === "needs-model" ? `Download ${DEFAULT_MODEL} (~2GB)` : "Start Ollama"}
                    </button>
                    <a href={OLLAMA_DOWNLOAD_URL} onClick={(e) => { e.preventDefault(); openExternal(OLLAMA_DOWNLOAD_URL); }} className="text-signal hover:underline">Get Ollama ↗</a>
                  </div>
                )
              ) : (
                <p className="mt-1.5 text-faint">Open the desktop app to enable local AI.</p>
              )}
            </div>
          )}

          {cloud && (
            <div className="px-2 pb-1 text-xs leading-relaxed">
              <p className="flex items-start gap-1.5 text-stuck">
                <span aria-hidden>⚠</span>
                <span>Sends your commands off-device to {CLOUD_LABEL[cloud]}. This breaks the offline guarantee — IPs, creds, and flags are redacted first, but the rest leaves your machine.</span>
              </p>
              {!desktop ? (
                <p className="mt-1.5 text-faint">Cloud models need the desktop app.</p>
              ) : cloudReady[cloud] ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-faint">
                  <span>Key saved · model <span className="mono">{CLOUD_DEFAULT_MODEL[cloud]}</span>.</span>
                  <button type="button" onClick={() => removeKey(cloud)} className="text-detour hover:underline">Remove key</button>
                </div>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveKey(cloud)}
                    placeholder={`${CLOUD_LABEL[cloud]} API key`}
                    className="mono min-w-0 flex-1 rounded border border-edge bg-ink/60 p-1.5 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
                  />
                  <button type="button" onClick={() => saveKey(cloud)} disabled={!keyDraft.trim()} className="label rounded bg-signal/20 px-2.5 py-1 text-signal transition-colors hover:bg-signal/30 disabled:opacity-40">Save</button>
                  <span className="w-full text-faint">Stored locally on this machine, never in the app bundle.</span>
                </div>
              )}
            </div>
          )}

          {err && <p className="px-2 pt-1 text-xs text-detour">{err}</p>}
        </div>
      )}
    </div>
  );
}
