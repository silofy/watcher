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
          Add only the tiers you need — each works on its own. Everything runs on macOS, Linux, and Windows; the browser
          extension (Tier 3) is optional convenience, never a requirement.
        </p>
      </div>

      <div className="space-y-3">
        <Tier n={1} title="Capture your runs" req={<Req tone="desktop">desktop app · any OS</Req>} unlocks="Run a watched shell while you attack a box over OpenVPN — each command streams into the debrief live.">
          <Code>watcher-capture --attach --machine &lt;name&gt;</Code>
          <Step>Live, no extension — self-starts a session and streams each command as you run it. <code>exit</code> to stop. macOS / Linux / Windows.</Step>
          <Step>Already spawned the box with the extension? Plain <code>watcher-capture --attach</code> picks up its session (and the box identity) automatically.</Step>
        </Tier>

        <Tier n={2} title="Capture in Pwnbox" req={<Req tone="desktop">desktop app + SSH</Req>} unlocks="Pwnbox is a pixel stream — run the agent inside it, pull results over your own key (PC ↔ Pwnbox, no third party).">
          <Code>./watcher-capture --export ~/.watcher-exports/box.json --machine &lt;name&gt;</Code>
          <Step>Agent: <code>crates/capture/dist/watcher-capture-linux-x86_64</code> (<code>chmod +x</code>). Then top bar → <span className="text-fg">Pwnbox sync</span> → SSH host/user/key. scp-pulls every 15s into History.</Step>
        </Tier>

        <Tier n={3} title="Reference path — the comparison" req={<Req tone="none">paste, no install</Req>} unlocks="Powers coverage, “What you'd do differently”, and the golden-path graph. Without it: your own deviations, time, stealth and techniques — no comparison.">
          <Step><span className="text-fg">Paste:</span> <span className="text-fg">What you'd do differently → Reference path → Add write-up</span> (HTB / 0xdf / IppSec). Extracts the intended path locally — keyword fallback if Ollama is off.</Step>
          <Step><span className="text-fg">Or auto-pull:</span> load <code>extension/</code> unpacked + register the native host (<code>extension/INSTALL.md</code>) — names the box on spawn and fetches the write-up. Windows-first, needs the daemon built.</Step>
        </Tier>

        <Tier n={4} title="AI-refined coaching" req={<Req tone="advanced">optional · Ollama</Req>} unlocks="Rewrites coaching into command-aware advice. Fully local — session never leaves the device. Off = rules-based, still solid.">
          <Code>ollama pull llama3.2</Code>
          <Step>Then <span className="text-fg">Local AI · enable</span> in the top bar — refined steps carry an <span className="mono rounded bg-signal/20 px-1 text-signal">ai</span> tag.</Step>
        </Tier>
      </div>

      <p className="mt-4 text-xs text-faint">Status: report + local capture are solid; Pwnbox sync and the extension are rougher, Windows-first.</p>
    </div>
  );
}
