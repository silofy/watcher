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
      <div className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-fg">Setting up The Watcher</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          What you're looking at is a <span className="text-fg">demo report</span> (the Uploadr box). Capturing your own runs is layered — start at the top and only go as far
          as you need. The one piece that's not optional is the <span className="text-fg">write-up</span> (step 3) — it's what the comparison half of the report is measured against —
          but you can simply paste it, no install.
        </p>
      </div>

      {/* the part that matters for feedback */}
      <div className="mb-5 rounded-lg border border-match/30 bg-match/[0.06] p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-match" aria-hidden>
            ◎
          </span>
          <h3 className="font-display text-base font-semibold text-fg">Just here to give feedback?</h3>
          <Req tone="none">no install</Req>
        </div>
        <p className="text-sm leading-relaxed text-muted">
          Then you're already set — explore this demo report end to end (the deviation timeline, the path graph, the coaching, the stealth chart) and tell me what's confusing,
          wrong, or missing. <span className="text-fg">Nothing below is needed to evaluate it.</span> Use the <span className="text-fg">Debrief</span> and{" "}
          <span className="text-fg">History</span> tabs to look around.
        </p>
      </div>

      <p className="mb-3 text-sm text-faint">To capture your own engagements instead of the demo, add the pieces below as needed:</p>

      <div className="space-y-3">
        <Tier
          n={1}
          title="Capture from your own terminal (over the VPN)"
          req={<Req tone="desktop">desktop app</Req>}
          unlocks="The main path: attack a box from your local Kali / WSL / PowerShell over HTB's OpenVPN, and every command lands in a live debrief."
        >
          <ol className="space-y-2">
            <Step>Run the desktop app (the Tauri build of this repo) — it polls <code>~/.watcher/sessions/</code> and renders the debrief.</Step>
            <Step>
              Connect to HTB's VPN, then start a watched shell:
              <div className="mt-1.5">
                <Code>watcher-capture --attach</Code>
              </div>
            </Step>
            <Step>Hack as normal — each finished command appears in ~1–4s. Type <code>exit</code> to stop. (Must run on the same machine as the app.)</Step>
          </ol>
        </Tier>

        <Tier
          n={2}
          title="Capture inside Pwnbox"
          req={<Req tone="desktop">desktop app + SSH</Req>}
          unlocks="Playing in the in-browser Pwnbox? It's a pixel stream, so run a small agent inside it and let the app pull the result over your own SSH key."
        >
          <ol className="space-y-2">
            <Step>
              Transfer the prebuilt agent into Pwnbox (<code>capture/dist/watcher-capture-linux-x86_64</code>), then <code>chmod +x</code> it and capture:
              <div className="mt-1.5">
                <Code>./watcher-capture --export ~/.watcher-exports/box.json --machine Checkpoint --os Windows</Code>
              </div>
            </Step>
            <Step>
              In the top bar, open <span className="text-fg">Pwnbox sync</span> → enter your Pwnbox SSH host / user / key (the "Connect via SSH" details HTB gives you) and enable
              it.
            </Step>
            <Step>It scp-pulls your exports every 15s — directly PC ↔ Pwnbox, nothing through a third party — and they show up in History.</Step>
          </ol>
        </Tier>

        <Tier
          n={3}
          title="Give it the write-up — the intended-path comparison"
          req={<Req tone="none">paste = no setup</Req>}
          unlocks="This powers half the report: coverage, “What you'd do differently”, and the golden-path graph all compare your route to the intended one — extracted from a write-up. Without it you still get your own deviations, time waste, stealth and techniques, but not the comparison. So it's not optional — only the way you supply it is."
        >
          <ol className="space-y-2">
            <Step>
              <span className="text-fg">Paste it (no install):</span> in <span className="text-fg">What you'd do differently</span> → <span className="text-fg">Reference path → Add write-up</span>, paste any
              write-up for the box (HTB official, 0xdf, IppSec notes). The local model extracts the intended steps and re-aligns your run against them.
            </Step>
            <Step>
              <span className="text-fg">Or auto-pull it:</span> the browser extension names the box the moment you spawn it and fetches the write-up for you — convenience, not a requirement. Load
              the <code>extension/</code> folder as an unpacked extension and register the native host (<code>extension/INSTALL.md</code>; Windows-first, needs the daemon built).
            </Step>
          </ol>
        </Tier>

        <Tier
          n={4}
          title="AI-refined coaching"
          req={<Req tone="desktop">optional · Ollama</Req>}
          unlocks="Sharpens each coaching step into specific, command-aware advice. Runs entirely on your machine — your session never leaves the device. Off, coaching is still solid, just rules-based."
        >
          <ol className="space-y-2">
            <Step>
              Install <a className="text-signal underline-offset-2 hover:underline" href="https://ollama.com" target="_blank" rel="noreferrer">Ollama</a> and pull a small model (e.g.{" "}
              <code>ollama pull llama3.2</code>).
            </Step>
            <Step>
              Click <span className="text-fg">Local AI · enable</span> in the top bar. When it goes green, AI-rewritten steps carry an <span className="mono rounded bg-signal/20 px-1 text-signal">ai</span> tag.
            </Step>
          </ol>
        </Tier>
      </div>

      <p className="mt-5 text-xs text-faint">
        Honest status: the report and the local-terminal capture are the most polished. Pwnbox sync and the extension/daemon work but are rougher and Windows-first. Feedback on
        any of it — especially the report itself — is what I'm after.
      </p>
    </div>
  );
}
