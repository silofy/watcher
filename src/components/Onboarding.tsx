import { useReport } from "../store/report";
import { ScanEye, ArrowUpRight } from "./icons";

const CAPTURE_CMD = "npm run capture -- --machine <box>";

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3.5">
      <span className="label flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 text-sm text-muted ring-1 ring-edge">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-semibold text-fg">{title}</h3>
        <div className="mt-1 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </section>
  );
}

export function Onboarding() {
  const { closeOnboarding, startLiveDemo } = useReport();

  const watchDemo = () => {
    closeOnboarding();
    startLiveDemo("abducted");
  };

  const copyCmd = () => {
    try {
      void navigator.clipboard?.writeText(CAPTURE_CMD);
    } catch {
      /* clipboard blocked — the command is visible to copy by hand */
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-7 px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-signal/15 text-signal">
              <ScanEye size={15} />
            </span>
            <span className="font-display text-lg font-semibold text-fg">Welcome to the Watcher</span>
          </div>
          <button type="button" onClick={closeOnboarding} className="label text-faint hover:text-muted">
            Skip
          </button>
        </header>

        <div className="space-y-6">
          <Step n="1" title="What it is">
            <p>
              A flight-data-recorder for your hacking practice. Record a run against any box, then get a
              graded debrief — read at once through <span className="text-fg">MITRE ATT&amp;CK</span>,{" "}
              <span className="text-fg">the Unified Kill Chain</span>, and <span className="text-fg">CWE</span>.
              Everything runs on your machine.
            </p>
          </Step>

          <Step n="2" title="See it work">
            <p>Watch a real run build command-by-command, then settle into the debrief.</p>
            <button
              type="button"
              onClick={watchDemo}
              className="label inline-flex items-center gap-1.5 rounded-md border border-signal/40 bg-signal/10 px-3 py-1.5 text-signal transition-colors hover:bg-signal/15"
            >
              ▶ Watch a demo (HTB Abducted)
            </button>
          </Step>

          <Step n="3" title="Capture your own run">
            <p>Record a box you're playing with one command, from the repo root:</p>
            <div className="mono flex items-center justify-between gap-3 overflow-x-auto rounded border border-edge bg-ink/60 px-2.5 py-1.5 text-xs text-fg">
              <span>{CAPTURE_CMD}</span>
              <button type="button" onClick={copyCmd} className="label shrink-0 text-faint hover:text-fg">
                copy
              </button>
            </div>
            <p className="text-faint">
              Other platforms: <code className="mono">--platform thm --target &lt;name&gt;</code>. Capture builds a
              small Rust agent the first time — run <code className="mono">npm run doctor</code> if you're unsure
              you're set up.
            </p>
          </Step>

          <Step n="4" title="Go further (optional)">
            <ul className="space-y-1.5">
              <li>
                <span className="text-fg">Reference path</span> — unlocks the write-up comparison and golden path.
              </li>
              <li>
                <span className="text-fg">AI coaching</span> — sharper wording, still local-first.
              </li>
              <li>
                <span className="text-fg">Web capture</span> (<code className="mono">--web</code> + Burp) — fold
                browser/HTTP attacks onto the same timeline; off by default, only for Burp workflows.
              </li>
            </ul>
            <p className="text-faint">Set these up anytime in the Install tab.</p>
          </Step>
        </div>

        <footer className="mt-auto flex items-center justify-end gap-4 border-t border-edge pt-5">
          <button type="button" onClick={closeOnboarding} className="label text-faint hover:text-muted">
            Skip
          </button>
          <button
            type="button"
            onClick={closeOnboarding}
            className="label inline-flex items-center gap-1 rounded-md bg-signal px-4 py-1.5 text-ink"
          >
            Done <ArrowUpRight size={12} />
          </button>
        </footer>
      </div>
    </div>
  );
}
