import { useEffect, useRef, useState } from "react";
import { loadPwnboxConfig, savePwnboxConfig, pullPwnbox, parseSshTarget, formatSshTarget, type PwnboxConfig } from "../lib/pwnbox";
import { useReport } from "../store/report";
import { ChevronDown } from "./icons";

type Sync = { kind: "idle" | "ok" | "error"; msg?: string; at?: number };

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mono rounded border border-edge bg-ink/60 px-2 py-1 text-xs text-fg placeholder:text-faint focus:border-signal focus:outline-none"
      />
    </label>
  );
}

/**
 * Pwnbox header control. The dropdown is deliberately minimal — three plain steps and a link to the
 * full commands in Setup — so it reads at a glance instead of dumping CLI. The optional live auto-pull
 * (SSH) is a compact toggle; when on it keeps polling the Rust `pull_pwnbox` command and the live
 * bridge ingests what lands. The step-by-step commands live in the Setup tab, which has room for them.
 */
export function PwnboxSync() {
  const setView = useReport((s) => s.setView);
  const [cfg, setCfg] = useState<PwnboxConfig>(loadPwnboxConfig);
  const [open, setOpen] = useState(false);
  const [showConfig, setShowConfig] = useState(false); // the SSH connection fields, hidden until you want them
  const [target, setTarget] = useState(() => formatSshTarget(loadPwnboxConfig()));
  const [sync, setSync] = useState<Sync>({ kind: "idle" });
  const busy = useRef(false);

  const set = (patch: Partial<PwnboxConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    savePwnboxConfig(next);
  };

  // the single connection field parses "user@host:port" into the three stored parts
  const onTarget = (v: string) => {
    setTarget(v);
    const { user, host, port } = parseSshTarget(v);
    set({ user, host, port });
  };

  const openSetup = () => {
    setOpen(false);
    setView("install");
  };

  useEffect(() => {
    if (!cfg.enabled || !cfg.host || !cfg.user) return;
    let active = true;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const pulled = await pullPwnbox(cfg);
        if (active) setSync({ kind: "ok", at: Date.now(), msg: pulled.length ? `pulled ${pulled.length} new` : "up to date" });
      } catch (e) {
        if (active) setSync({ kind: "error", at: Date.now(), msg: String(e).slice(0, 140) });
      } finally {
        busy.current = false;
      }
    };
    tick();
    const h = setInterval(tick, 15_000);
    return () => {
      active = false;
      clearInterval(h);
    };
  }, [cfg.enabled, cfg.host, cfg.user, cfg.port, cfg.identity, cfg.remoteDir]);

  const statusColor = sync.kind === "error" ? "var(--color-detour)" : sync.kind === "ok" ? "var(--color-match)" : "var(--color-faint)";
  const dot = cfg.enabled ? statusColor : "var(--color-faint)";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Capture a session you're running in Pwnbox"
        className={`flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
          cfg.enabled ? "border-match/40 bg-match/10 text-match" : "border-edge text-muted hover:border-signal/60 hover:bg-panel-2 hover:text-fg"
        }`}
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          {cfg.enabled && sync.kind === "ok" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-match opacity-50" />}
          <span className="relative h-2 w-2 rounded-full" style={{ background: dot }} />
        </span>
        <span>Pwnbox{cfg.enabled ? " · live" : ""}</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-[20rem] rounded-lg border border-edge bg-panel p-3 text-left shadow-xl">
            <div className="mb-2 label text-fg">Capture in Pwnbox</div>

            {/* three plain steps — no commands, so it reads at a glance */}
            <ol className="space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="text-faint">1.</span>
                <span>Run the <span className="text-fg">Watcher agent</span> in your Pwnbox terminal.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-faint">2.</span>
                <span>Download the export file it writes.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-faint">3.</span>
                <span>Drag it onto the <span className="text-fg">History</span> tab — it opens as a debrief.</span>
              </li>
            </ol>

            <button type="button" onClick={openSetup} className="mt-3 w-full rounded-md bg-signal/15 px-3 py-1.5 text-xs font-medium text-signal transition-colors hover:bg-signal/25">
              Full setup &amp; commands →
            </button>

            {/* optional live auto-pull — one compact toggle, config hidden until wanted */}
            <div className="mt-3 border-t border-edge pt-2.5">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => set({ enabled: !cfg.enabled })} className="flex items-center gap-2" title="Auto-pull exports over SSH">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
                  <span className="label text-muted">Auto-pull over SSH</span>
                </button>
                <span className="text-xs" style={{ color: cfg.enabled ? statusColor : "var(--color-faint)" }}>
                  {cfg.enabled ? sync.msg ?? "starting…" : "off"}
                </span>
              </div>

              {cfg.enabled && (
                <button type="button" onClick={() => setShowConfig((v) => !v)} className="mt-2 label flex items-center gap-1.5 text-faint transition-colors hover:text-muted">
                  <ChevronDown className={`transition-transform ${showConfig ? "rotate-180" : ""}`} /> Connection
                </button>
              )}
              {cfg.enabled && showConfig && (
                <div className="mt-2 space-y-2.5">
                  <Field label="Pwnbox SSH" value={target} onChange={onTarget} placeholder="username@hostname" />
                  <Field label="SSH key (optional)" value={cfg.identity ?? ""} onChange={(v) => set({ identity: v })} placeholder="~/.ssh/htb_key — blank = default key" />
                  <p className="text-xs text-faint">
                    Needs key login (uses your Pwnbox password once) — see <button type="button" onClick={openSetup} className="text-signal hover:underline">Setup</button>.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
