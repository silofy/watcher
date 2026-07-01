import type { CSSProperties, ReactNode } from "react";
import { useReport } from "./store/report";
import { PhaseAudit } from "./components/PhaseAudit";
import { IdentityBar } from "./components/IdentityBar";
import { WriteupControl } from "./components/WriteupControl";
import { TrimControl } from "./components/TrimControl";
import { Collapse } from "./components/ui";
import { AttackTimeline } from "./components/AttackTimeline";
import { FrameworkAxes } from "./components/FrameworkAxes";
import { DeviationTimeline } from "./components/DeviationTimeline";
import { StealthReport } from "./components/StealthReport";
import { CommandReplay } from "./components/CommandReplay";
import { PathComparison } from "./components/PathComparison";
import { Assessment } from "./components/Assessment";
import { History } from "./components/History";
import { Install } from "./components/Install";
import { WriteupGate } from "./components/WriteupGate";
import { LlmStatusChip } from "./components/LlmStatusChip";
import { PwnboxSync } from "./components/PwnboxSync";
import { AiBanner } from "./components/AiBanner";
import { LiveBridge } from "./components/LiveBridge";

function Rise({ i, className, id, children }: { i: number; className?: string; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={`rise ${id ? "scroll-mt-20" : ""} ${className ?? ""}`} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

function Tab({ id, label }: { id: "debrief" | "history" | "install"; label: string }) {
  const { view, setView } = useReport();
  const active = view === id;
  return (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`label border-b-2 px-1 pb-1.5 pt-0.5 transition-colors ${
        active ? "border-signal text-fg" : "border-transparent text-faint hover:text-muted"
      }`}
    >
      {label}
    </button>
  );
}

export function App() {
  const { report, view, gateDismissed } = useReport();
  const { session } = report;
  const needsWriteup = report.golden_dag.length === 0 && !gateDismissed;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 bg-ink/90 backdrop-blur">
        <div className="border-b border-edge">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5">
            <div className="flex items-center gap-7 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-signal/15 text-signal">◎</span>
                <span className="font-display font-semibold tracking-tight text-fg">The Watcher</span>
              </div>
              <nav className="flex items-center gap-5">
                <Tab id="debrief" label="Debrief" />
                <Tab id="history" label="History" />
                <Tab id="install" label="Install" />
              </nav>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <PwnboxSync />
              <LlmStatusChip />
            </div>
          </div>
        </div>
        {/* AI transparency strip — present when the local model is refining coaching */}
        <AiBanner />
        {/* active machine — separate live content */}
        <LiveBridge />
      </header>

      <main className="mx-auto max-w-6xl px-5 py-5">
        {view === "install" ? (
          <Install />
        ) : view === "history" ? (
          <History />
        ) : needsWriteup ? (
          <WriteupGate />
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-6 lg:grid-cols-12 lg:items-start">
            {/* 1 — the verdict band: identity, did you root it, the grade + key numbers, the one lesson */}
            <Rise i={0} className="lg:col-span-12">
              <IdentityBar />
            </Rise>
            {/* the reference-path control — high-level, docked at the top so unlocking the comparison
                is a first-class action next to the takeaway, not buried in a details pane */}
            <Rise i={1} className="lg:col-span-12">
              <WriteupControl />
            </Rise>
            {/* 2 — the spine: Lighthouse-style phase audit, one card per MITRE phase, actionable text */}
            <Rise i={1} id="audit" className="lg:col-span-12">
              <PhaseAudit />
            </Rise>

            {/* Details — every supporting view, collapsed; opening one closes the others (accordion) */}
            <div className="mt-1 flex items-center gap-3 lg:col-span-12">
              <span className="label text-faint">Details</span>
              <div className="h-px flex-1 bg-edge" />
              <span className="text-xs text-faint">tap to expand · one at a time</span>
            </div>
            <div className="flex flex-col gap-2 lg:col-span-12">
              <div id="path"><PathComparison /></div>
              <div id="bridge"><Assessment /></div>
              <div id="unfolded"><AttackTimeline /></div>
              <div id="frameworks"><FrameworkAxes /></div>
              <div id="deviated"><DeviationTimeline /></div>
              <div id="stealth"><StealthReport /></div>
              <div id="log"><CommandReplay /></div>
              <Collapse name="debrief-details" title="Session window" subtitle="retroactively trim the report">
                <TrimControl />
              </Collapse>
            </div>

            <footer className="flex items-center justify-between py-6 text-xs text-faint lg:col-span-12">
              <span className="mono">
                schema v{report.schema_version} · {session.uuid.slice(0, 8)}
              </span>
              <span>The Watcher — capture safely, process privately, coach honestly.</span>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
