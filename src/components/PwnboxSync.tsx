import { useEffect, useRef, useState } from "react";
import { loadPwnboxConfig, savePwnboxConfig, pullPwnbox, parseSshTarget, formatSshTarget, type PwnboxConfig } from "../lib/pwnbox";

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
 * Pwnbox SSH auto-pull — a header control that lives with the active machine, not buried in History.
 * Mounted persistently so it keeps polling the Rust `pull_pwnbox` command regardless of the open view;
 * pulled exports land in ~/.watcher/sessions/ and the live bridge ingests them automatically.
 */
export function PwnboxSync() {
  const [cfg, setCfg] = useState<PwnboxConfig>(loadPwnboxConfig);
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
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
        title="Pwnbox SSH auto-pull — sync a session you're playing in Pwnbox"
        className={`flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors ${
          cfg.enabled ? "border-match/40 bg-match/10 text-match" : "border-edge text-muted hover:border-signal/60 hover:bg-panel-2 hover:text-fg"
        }`}
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          {cfg.enabled && sync.kind === "ok" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-match opacity-50" />}
          <span className="relative h-2 w-2 rounded-full" style={{ background: dot }} />
        </span>
        <span>Pwnbox sync{cfg.enabled ? " · on" : ""}</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-[22rem] rounded-lg border border-edge bg-panel p-3 text-left shadow-xl">
            <div className="mb-2.5 flex items-center gap-3">
              <button type="button" onClick={() => set({ enabled: !cfg.enabled })} className="flex items-center gap-2" title="Toggle auto-pull">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: dot }} />
                <span className="label text-fg">Auto-pull {cfg.enabled ? "on" : "off"}</span>
              </button>
              {cfg.enabled && (
                <span className="text-xs" style={{ color: statusColor }}>
                  {sync.msg ?? "starting…"}
                  {sync.at ? ` · ${new Date(sync.at).toLocaleTimeString()}` : ""}
                </span>
              )}
            </div>

            <div className="space-y-3">
              <Field label="Pwnbox SSH" value={target} onChange={onTarget} placeholder="htb-user@10.10.14.5" />
              <Field label="SSH key (optional)" value={cfg.identity ?? ""} onChange={(v) => set({ identity: v })} placeholder="~/.ssh/htb_key — blank uses your default key" />

              <button type="button" onClick={() => setAdvanced((v) => !v)} className="label flex items-center gap-1.5 text-faint transition-colors hover:text-muted">
                <span className={`transition-transform ${advanced ? "rotate-90" : ""}`}>▸</span> Advanced
              </button>
              {advanced && (
                <Field label="Remote export dir" value={cfg.remoteDir ?? ""} onChange={(v) => set({ remoteDir: v })} placeholder="~/.watcher-exports" />
              )}

              <p className="text-xs leading-relaxed text-faint">
                In Pwnbox, add <span className="mono text-muted">--export {cfg.remoteDir || "~/.watcher-exports"}/&lt;box&gt;.json</span> to the agent. Watcher pulls new exports over
                your own SSH connection every 15s — nothing goes through a third party.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
