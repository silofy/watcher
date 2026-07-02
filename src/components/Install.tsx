import type { ReactNode } from "react";

function Code({ children }: { children: ReactNode }) {
  return <div className="mono overflow-x-auto rounded border border-edge bg-ink/60 px-2.5 py-1.5 text-xs text-fg">{children}</div>;
}

function Req({ tone, children }: { tone: "none" | "desktop" | "advanced"; children: ReactNode }) {
  const c = tone === "none" ? "var(--color-match)" : tone === "desktop" ? "var(--color-signal)" : "var(--color-stuck)";
  return (
    <span className="label inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs" style={{ color: c, background: `color-mix(in oklch, ${c} 14%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {children}
    </span>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <li className="text-sm leading-relaxed text-muted [&_code]:mono [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-fg">{children}</li>;
}

function Tier({ n, title, req, unlocks, children }: { n: number; title: string; req: ReactNode; unlocks: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-edge bg-panel p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2.5">
        <span className="readout flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 text-sm text-muted ring-1 ring-edge">{n}</span>
        <h3 className="font-display text-base font-semibold text-fg">{title}</h3>
        {req}
      </div>
      <p className="mb-3 pl-[2.1rem] text-sm text-faint">{unlocks}</p>
      <div className="space-y-2.5 pl-[2.1rem]">{children}</div>
    </section>
  );
}

export function Install() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h2 className="font-display text-2xl font-semibold text-fg">Setup</h2>
        <p className="mt-1.5 text-sm text-muted">
          Add only the tiers you need — each works on its own. Everything runs on macOS, Linux, and Windows.
        </p>
      </div>

      <div className="space-y-3">
        <Tier n={1} title="Capture your runs" req={<Req tone="desktop">desktop app · any OS</Req>} unlocks="Run a watched shell while you attack a box over OpenVPN — each command streams into the debrief live.">
          <Code>watcher-capture --attach --machine &lt;name&gt;</Code>
          <Step>Live — self-starts a session and streams each command as you run it. <code>exit</code> to stop. macOS / Linux / Windows.</Step>
          <Step>A second terminal running <code>watcher-capture --attach</code> on the same box asks whether to join the live session or start fresh — <code>--new</code> forces a new one.</Step>
          <Step>Pick the shell with <code>--shell bash</code> (or <code>pwsh</code>, <code>zsh</code>, …) — handy for git-bash / WSL on Windows; defaults to your login shell.</Step>
        </Tier>

        <Tier n={2} title="Capture in Pwnbox" req={<Req tone="desktop">desktop app + SSH</Req>} unlocks="Pwnbox is a pixel stream — run the agent inside it, pull results over your own key (PC ↔ Pwnbox, no third party).">
          <Code>./watcher-capture --export ~/.watcher-exports/box.json --machine &lt;name&gt;</Code>
          <Step>The agent is <code>crates/capture/dist/watcher-capture-linux-x86_64</code>. <code>scp</code> it up, <code>chmod +x</code>, run it in Pwnbox.</Step>
          <Step>Pwnbox gives you a <span className="text-fg">password</span>, but the pull is key-based — so enable key login once with <code>ssh-copy-id &lt;user&gt;@&lt;host&gt;</code> (uses that password one time).</Step>
          <Step>Then top bar → <span className="text-fg">Pwnbox sync</span> — paste <code>user@host</code>, flip <span className="text-fg">Auto-pull on</span>. It scp-pulls every 15s into History. The panel has copy-paste commands for all of this.</Step>
        </Tier>

        <Tier n={3} title="Reference path — the comparison" req={<Req tone="none">1-click / paste</Req>} unlocks="Powers coverage, “What you'd do differently”, and the golden-path graph. Without it: your own deviations, time, stealth and techniques — no comparison.">
          <Step><span className="text-fg">Reference path → Load from:</span> <code>0xdf</code> auto-fetches free, <code>URL / paste</code> takes any write-up, <code>IppSec</code> opens a search. Extracts the intended path locally — keyword fallback if Ollama is off.</Step>
          <Step><span className="text-fg">HTB official (desktop):</span> click <code>HTB ⚙</code> and paste your HTB <span className="text-fg">App Token</span> to auto-pull the official write-up for a retired box. Needs HTB VIP; the token is stored only on your machine, never uploaded.</Step>
          <Step>Retired boxes have public write-ups; an active box has none, so the comparison stays off until it retires. Your own run is still graded in full.</Step>
        </Tier>

        <Tier n={4} title="AI-refined coaching" req={<Req tone="advanced">optional</Req>} unlocks="Rewrites each coaching step into command-aware advice (those carry an ai tag). Off = rules-based, still solid.">
          <Step><span className="text-fg">Local (Ollama):</span> pick it in the top-bar <span className="text-fg">AI</span> menu — one click downloads the model (~2&nbsp;GB), then coaching runs fully offline; your commands go to the local model only.</Step>
          <Step><span className="text-fg">Cloud (Claude / ChatGPT / Gemini):</span> pick one and paste your API key. Stronger models, but your commands leave the device (IPs, creds, flags redacted first) — off by default, key stored only on your machine.</Step>
        </Tier>
      </div>

      <p className="mt-4 text-xs text-faint">Status: report + local capture are solid; Pwnbox sync is rougher, Windows-first.</p>
    </div>
  );
}
