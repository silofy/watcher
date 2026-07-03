import type { CSSProperties, ReactNode } from "react";
import { useReport } from "./store/report";
import { PhaseAudit } from "./components/PhaseAudit";
import { IdentityBar } from "./components/IdentityBar";
import { SessionFacts } from "./components/SessionFacts";
import { TrimControl } from "./components/TrimControl";
import { Collapse } from "./components/ui";
import { DeepDive } from "./components/DeepDive";
import { GhostCard } from "./components/GhostCard";
import { PathComparison } from "./components/PathComparison";
import { Assessment } from "./components/Assessment";
import { History } from "./components/History";
import { Progress } from "./components/Progress";
import { Install } from "./components/Install";
import { WriteupGate } from "./components/WriteupGate";
import { LlmStatusChip } from "./components/LlmStatusChip";
import { PwnboxSync } from "./components/PwnboxSync";
import { AiBanner } from "./components/AiBanner";
import { LiveBridge } from "./components/LiveBridge";
import { DemoDriver } from "./components/DemoDriver";
import { LiveDashboard } from "./components/LiveDashboard";

function Rise({ i, className, id, children }: { i: number; className?: string; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={`rise ${id ? "scroll-mt-20" : ""} ${className ?? ""}`} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

function Tab({ id, label }: { id: "debrief" | "history" | "install" | "progress"; label: string }) {
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
      {/* self-driving live-mode demo — only active on ?demo=live, otherwise renders nothing */}
      <DemoDriver />
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
                <Tab id="progress" label="Progress" />
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
        ) : view === "progress" ? (
          <Progress />
        ) : needsWriteup ? (
          <WriteupGate />
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-6 lg:grid-cols-12 lg:items-start">
            {/* 1 — the verdict band: identity, did you root it, the grade + key numbers, the one lesson */}
            <Rise i={0} id="identity" className="lg:col-span-12">
              <IdentityBar />
            </Rise>
            {/* 1b — the Ops bento: live companion while recording, run-summary once resolved. Stays
                mounted across the flip so the hand-off is fluid; the accordions below hold the detail. */}
            <Rise i={1} id="summary" className="lg:col-span-12">
              <LiveDashboard />
            </Rise>
            {/* 2 — the spine: Lighthouse-style phase audit, one card per MITRE phase, actionable text */}
            <Rise i={2} id="audit" className="lg:col-span-12">
              <PhaseAudit />
            </Rise>

            {/* Details — path/assessment stay here for now (Task 2 moves them); the six timeline /
                stealth / deviation / frameworks / findings / log views live in one Deep dive panel. */}
            <div className="mt-1 flex items-center gap-3 lg:col-span-12">
              <span className="label text-faint">Details</span>
              <div className="h-px flex-1 bg-edge" />
              <span className="text-xs text-faint">tap to expand · one at a time</span>
            </div>
            <div className="flex flex-col gap-2 lg:col-span-12">
              <div id="path"><PathComparison /></div>
              <div id="bridge"><Assessment /></div>
              <DeepDive />
              {report.ghost?.items?.length ? (
                <Collapse name="debrief-details" title="You vs. the Ghost" subtitle="the optimal line from where you stood — wins first">
                  <GhostCard />
                </Collapse>
              ) : null}
              <Collapse name="debrief-details" title="Session window" subtitle="session facts · retroactively trim the report">
                <SessionFacts />
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
