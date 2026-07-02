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

function Step({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <li className={`text-sm leading-relaxed text-muted [&_code]:mono [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-fg ${className}`}>{children}</li>;
}

function Tier({ n, title, req, unlocks, children }: { n: ReactNode; title: string; req: ReactNode; unlocks: string; children: ReactNode }) {
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
          Pick where you capture, then add the comparison and AI if you want. Everything runs on macOS, Linux, and Windows.
        </p>
      </div>

      {/* CAPTURE — the two options are alternatives: you hack on your own VM, or in Pwnbox */}
      <div className="mb-2.5 flex items-center gap-3">
        <span className="label text-muted">Capture — pick one</span>
        <div className="h-px flex-1 bg-edge" />
        <span className="text-xs text-faint">based on where you hack</span>
      </div>

      <div className="space-y-3">
        <Tier n="A" title="On your own machine" req={<Req tone="desktop">desktop app · any OS</Req>} unlocks="You attack over OpenVPN from your own Kali/Parrot/WSL. Run a watched shell — each command streams into the debrief live.">
          <Code>watcher-capture --attach --machine &lt;name&gt;</Code>
          <Step>Live — self-starts a session and streams each command as you run it. <code>exit</code> to stop. macOS / Linux / Windows.</Step>
          <Step>A second terminal running <code>watcher-capture --attach</code> on the same box asks whether to join the live session or start fresh — <code>--new</code> forces a new one.</Step>
          <Step>Pick the shell with <code>--shell bash</code> (or <code>pwsh</code>, <code>zsh</code>, …) — handy for git-bash / WSL on Windows; defaults to your login shell.</Step>
        </Tier>

        <div className="flex items-center gap-3 px-2 py-0.5">
          <div className="h-px flex-1 bg-edge/60" />
          <span className="label text-faint">or</span>
          <div className="h-px flex-1 bg-edge/60" />
        </div>

        <Tier n="B" title="In Pwnbox" req={<Req tone="desktop">desktop app</Req>} unlocks="You hack in HTB's cloud Pwnbox (a pixel stream). Run the agent inside it, then bring the export back. The basic flow needs no SSH keys.">
          <Step><span className="text-fg">1. Put the agent in Pwnbox.</span> It's in your checkout — upload it with Pwnbox's file-transfer button, or <code>scp</code> it up:</Step>
          <Code>scp crates/capture/dist/watcher-capture-linux-x86_64 &lt;user&gt;@&lt;host&gt;:~/</Code>
          <Step><span className="text-fg">2. Run it</span> in the Pwnbox terminal — hack, then <code>exit</code>:</Step>
          <Code>chmod +x watcher-capture-linux-x86_64 &amp;&amp; ./watcher-capture-linux-x86_64 --export ~/box.json --machine &lt;box&gt;</Code>
          <Step><span className="text-fg">3. Bring it back.</span> Download <code>box.json</code> from Pwnbox, then drag it onto the <span className="text-fg">History</span> tab — it opens as a debrief. No keys, no config.</Step>
          <Step className="pt-1.5"><span className="text-fg">Optional — live auto-pull.</span> Skip the download: Watcher <code>scp</code>-pulls every 15s straight into History. Top bar → <span className="text-fg">Pwnbox</span> → enable <span className="text-fg">Auto-pull</span>, paste <code>user@host</code>. The pull is key-based, so enable key login once (Pwnbox gives a password — this uses it one time):</Step>
          <Code>ssh-copy-id &lt;user&gt;@&lt;host&gt;</Code>
        </Tier>
      </div>

      {/* ADD-ONS — optional, and they stack on top of whichever capture you chose */}
      <div className="mb-2.5 mt-7 flex items-center gap-3">
        <span className="label text-muted">Add-ons — optional</span>
        <div className="h-px flex-1 bg-edge" />
        <span className="text-xs text-faint">stack on either capture</span>
      </div>

      <div className="space-y-3">
        <Tier n="+" title="Reference path — the comparison" req={<Req tone="none">1-click / paste</Req>} unlocks="Powers coverage, “What you'd do differently”, and the golden-path graph. Without it: your own deviations, time, stealth and techniques — no comparison.">
          <Step><span className="text-fg">Reference path → Load from:</span> <code>0xdf</code> auto-fetches free, <code>URL / paste</code> takes any write-up, <code>IppSec</code> opens his YouTube walkthrough. Extracts the intended path locally — keyword fallback if Ollama is off.</Step>
          <Step><span className="text-fg">HTB official (desktop):</span> click <code>HTB ⚙</code> and paste your HTB <span className="text-fg">App Token</span> to auto-pull the official write-up for a retired box. Needs HTB VIP; the token is stored only on your machine, never uploaded.</Step>
          <Step>Retired boxes have public write-ups; an active box has none, so the comparison stays off until it retires. Your own run is still graded in full.</Step>
        </Tier>

        <Tier n="+" title="AI-refined coaching" req={<Req tone="advanced">optional</Req>} unlocks="Rewrites each coaching step into command-aware advice (those carry an ai tag). Off = rules-based, still solid.">
          <Step><span className="text-fg">Local (Ollama):</span> pick it in the top-bar <span className="text-fg">AI</span> menu — one click downloads the model (~2&nbsp;GB), then coaching runs fully offline; your commands go to the local model only.</Step>
          <Step><span className="text-fg">Cloud (Claude / ChatGPT / OpenRouter / Gemini):</span> pick one and paste your API key. Stronger models, but your commands leave the device (IPs, creds, flags redacted first) — off by default, key stored only on your machine. OpenRouter routes to a namespaced model (default <code>openai/gpt-4o</code>).</Step>
        </Tier>
      </div>

      <p className="mt-4 text-xs text-faint">Status: report + local capture are solid; Pwnbox sync is rougher, Windows-first.</p>
    </div>
  );
}
