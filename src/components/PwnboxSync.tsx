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

/** A copy-to-clipboard command line — click to copy the exact command. */
function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        title="Click to copy"
        className="mono block w-full overflow-x-auto whitespace-pre rounded border border-edge bg-ink/60 px-2 py-1.5 pr-12 text-left text-[11px] text-fg transition-colors hover:border-edge-bright"
      >
        {children}
      </button>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
        {copied ? "copied" : "copy"}
      </span>
    </div>
  );
}

const AGENT = "watcher-capture-linux-x86_64";

/** The simple, no-config path: run the agent in Pwnbox, bring the file back, drop it on History. */
function SimpleSteps({ conn }: { conn: string }) {
  return (
    <ol className="space-y-3 text-xs text-muted">
      <li>
        <div className="mb-1">
          <span className="text-fg">1. Put the agent in Pwnbox.</span>{" "}
          <span className="text-faint">
            It's in your checkout at <span className="mono">crates/capture/dist/{AGENT}</span> — upload it with Pwnbox's file-transfer button, or scp it:
          </span>
        </div>
        <Cmd>{`scp crates/capture/dist/${AGENT} ${conn}:~/`}</Cmd>
      </li>
      <li>
        <div className="mb-1">
          <span className="text-fg">2. Capture your run</span> <span className="text-faint">— paste in the Pwnbox terminal, hack, then <span className="mono">exit</span>:</span>
        </div>
        <Cmd>{`chmod +x ${AGENT} && ./${AGENT} --export ~/box.json --machine <box>`}</Cmd>
      </li>
      <li>
        <span className="text-fg">3. Bring it back.</span>{" "}
        <span className="text-faint">
          Download <span className="mono">box.json</span> from Pwnbox, then drag it onto the <span className="text-fg">History</span> tab — it opens as a debrief. No keys,
          no config.
        </span>
      </li>
    </ol>
  );
}

/** The one extra command the optional live auto-pull needs: install your key (uses the password once). */
function KeyGuide({ conn }: { conn: string }) {
  return (
    <div className="space-y-1.5 text-xs text-muted">
      <div className="text-faint">The pull is non-interactive, so it needs key login. Enable it once — type your Pwnbox password when asked:</div>
      <Cmd>{`ssh-copy-id ${conn}`}</Cmd>
      <details>
        <summary className="cursor-pointer list-none text-faint hover:text-muted">Windows, or no ssh-copy-id? ▾</summary>
        <div className="mt-1 space-y-1">
          <div className="text-faint">No key yet? make one: <span className="mono text-muted">ssh-keygen -t ed25519</span></div>
          <Cmd>{`type $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh ${conn} "mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"`}</Cmd>
        </div>
      </details>
    </div>
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
  const [showAuto, setShowAuto] = useState(() => loadPwnboxConfig().enabled); // expand the SSH section only if already using it
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

  // the connection the copy-paste setup commands are built around (placeholder until entered)
  const conn = cfg.user && cfg.host ? `${cfg.user}@${cfg.host}` : "<user>@<host>";

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
        <span>Pwnbox sync{cfg.enabled ? " · on" : ""}</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-[25rem] rounded-lg border border-edge bg-panel p-3 text-left shadow-xl">
            {/* the simple, recommended path — no SSH config at all */}
            <div className="mb-1 flex items-baseline justify-between">
              <span className="label text-fg">Capture in Pwnbox</span>
              <span className="text-xs text-faint">the easy way</span>
            </div>
            <SimpleSteps conn={conn} />

            {/* optional: live auto-pull over SSH, collapsed so it doesn't dominate */}
            <div className="mt-3 border-t border-edge pt-2.5">
              <button type="button" onClick={() => setShowAuto((v) => !v)} className="label flex w-full items-center gap-1.5 text-faint transition-colors hover:text-muted">
                <span className={`transition-transform ${showAuto ? "rotate-90" : ""}`}>▸</span> Or auto-pull it live over SSH
                <span className="ml-auto font-normal normal-case tracking-normal text-faint">{cfg.enabled ? "on" : "optional"}</span>
              </button>

              {showAuto && (
                <div className="mt-2.5 space-y-3">
                  <div className="flex items-center gap-3">
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
                  <p className="text-xs leading-relaxed text-faint">
                    Skips the download — Watcher scp-pulls new exports straight into History every 15s. Run the agent with{" "}
                    <span className="mono text-muted">--export {cfg.remoteDir || "~/.watcher-exports"}/&lt;box&gt;.json</span>, then:
                  </p>
                  <Field label="Pwnbox SSH" value={target} onChange={onTarget} placeholder="username@hostname (from Pwnbox → Instance details)" />
                  <Field label="SSH key (optional)" value={cfg.identity ?? ""} onChange={(v) => set({ identity: v })} placeholder="~/.ssh/htb_key — blank uses your default key" />
                  <button type="button" onClick={() => setAdvanced((v) => !v)} className="label flex items-center gap-1.5 text-faint transition-colors hover:text-muted">
                    <span className={`transition-transform ${advanced ? "rotate-90" : ""}`}>▸</span> Advanced
                  </button>
                  {advanced && <Field label="Remote export dir" value={cfg.remoteDir ?? ""} onChange={(v) => set({ remoteDir: v })} placeholder="~/.watcher-exports" />}
                  <KeyGuide conn={conn} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
