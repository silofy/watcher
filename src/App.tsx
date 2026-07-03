import type { CSSProperties, ReactNode } from "react";
import { useReport } from "./store/report";
import { PhaseAudit } from "./components/PhaseAudit";
import { DebriefRail } from "./components/DebriefRail";
import { SessionFacts } from "./components/SessionFacts";
import { TrimControl } from "./components/TrimControl";
import { Collapse, Section } from "./components/ui";
import { DeepDive } from "./components/DeepDive";
import { GhostCard } from "./components/GhostCard";
import { PathComparison } from "./components/PathComparison";
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
            {/* Left rail — identity + rooted status, the grade + radar, key numbers, the ghost-mini.
                Sticky at lg: and up; on narrow widths this simply stacks above the main column. */}
            <Rise i={0} id="identity" className="lg:col-span-4">
              <DebriefRail />
            </Rise>

            {/* Main column — the scrollable narrative: the Ops bento (live companion / run-summary,
                stays mounted across the live→resolved flip) → Phase audit (leads with the single
                highest-value coaching takeaway, then the per-phase "what you'd do differently") →
                the intended-path comparison → you vs the Ghost → the Deep dive tabs → session window. */}
            <div className="flex flex-col gap-6 lg:col-span-8">
              <Rise i={1} id="summary">
                <LiveDashboard />
              </Rise>
              <Rise i={2} id="audit">
                <PhaseAudit />
              </Rise>
              <Rise i={3} id="path">
                <PathComparison />
              </Rise>
              {report.ghost?.items?.length ? (
                <Rise i={4} id="ghost">
                  <Section title="You vs. the Ghost" subtitle="the optimal line from where you stood — wins first">
                    <GhostCard />
                  </Section>
                </Rise>
              ) : null}
              <Rise i={5}>
                <DeepDive />
              </Rise>
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
