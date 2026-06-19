import { useEffect, useRef, useState } from "react";
import { loadPwnboxConfig, savePwnboxConfig, pullPwnbox, type PwnboxConfig } from "../lib/pwnbox";

type Sync = { kind: "idle" | "ok" | "error"; msg?: string; at?: number };

function Field({ label, value, onChange, placeholder, type = "text", width = "" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; width?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${width}`}>
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
 * Pwnbox SSH auto-pull — config + status. When enabled, polls the Rust `pull_pwnbox` command; pulled
 * exports land in ~/.watcher/sessions/ and the live bridge ingests them automatically.
 */
export function PwnboxSync() {
  const [cfg, setCfg] = useState<PwnboxConfig>(loadPwnboxConfig);
  const [open, setOpen] = useState(false);
  const [sync, setSync] = useState<Sync>({ kind: "idle" });
  const busy = useRef(false);

  const set = (patch: Partial<PwnboxConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    savePwnboxConfig(next);
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

  return (
    <div className="mb-5 rounded-lg border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => set({ enabled: !cfg.enabled })} className="flex items-center gap-2" title="Toggle auto-pull">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: cfg.enabled ? "var(--color-match)" : "var(--color-faint)" }} />
          <span className="label">Pwnbox sync</span>
        </button>
        {cfg.enabled && (
          <span className="text-xs" style={{ color: statusColor }}>
            {sync.msg ?? "starting…"}
            {sync.at ? ` · ${new Date(sync.at).toLocaleTimeString()}` : ""}
          </span>
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="label ml-auto text-faint transition-colors hover:text-fg">
          {open ? "Hide" : "Configure"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <Field label="host" value={cfg.host} onChange={(v) => set({ host: v })} placeholder="pwnbox ip / host" width="grow" />
            <Field label="user" value={cfg.user} onChange={(v) => set({ user: v })} placeholder="htb-user" />
            <Field label="port" type="number" value={cfg.port ? String(cfg.port) : ""} onChange={(v) => set({ port: v ? Number(v) : undefined })} placeholder="22" width="w-20" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Field label="key path (optional)" value={cfg.identity ?? ""} onChange={(v) => set({ identity: v })} placeholder="C:\\Users\\you\\.ssh\\htb_key" width="grow" />
            <Field label="remote export dir" value={cfg.remoteDir ?? ""} onChange={(v) => set({ remoteDir: v })} placeholder="~/.watcher-exports" width="grow" />
          </div>
          <p className="text-xs text-faint">
            In Pwnbox, run the agent with <span className="mono">--export ~/.watcher-exports/&lt;box&gt;.json</span>. The Watcher scp-pulls those here every 15s using your
            SSH key — directly, nothing through a third party.
          </p>
        </div>
      )}
    </div>
  );
}
