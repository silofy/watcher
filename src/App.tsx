import type { CSSProperties, ReactNode } from "react";
import { useReport } from "./store/report";
import { KpiBar } from "./components/KpiBar";
import { IdentityBar } from "./components/IdentityBar";
import { TrimControl } from "./components/TrimControl";
import { AttackTimeline } from "./components/AttackTimeline";
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
          <div className="grid grid-cols-1 gap-x-6 gap-y-7 lg:grid-cols-12 lg:items-start">
            {/* 1 — the verdict: who, did you root it, the one lesson, then the scorecard */}
            <Rise i={0} className="lg:col-span-12">
              <IdentityBar />
            </Rise>
            <Rise i={1} className="lg:col-span-12">
              <KpiBar />
            </Rise>
            {/* 2 — what did I do wrong: wasted time, dead-ends, stalls */}
            <Rise i={2} id="deviated" className="lg:col-span-12">
              <DeviationTimeline />
            </Rise>
            {/* 3 — what should I have done differently: intended path vs yours */}
            <Rise i={3} id="path" className="lg:col-span-12">
              <PathComparison />
            </Rise>
            {/* 4 — your grade + how to level up: the explainable rubric, skills, and playbook */}
            <Rise i={4} id="bridge" className="lg:col-span-12">
              <Assessment />
            </Rise>
            {/* 5 — how the run unfolded: the MITRE swimlane + techniques */}
            <Rise i={5} id="unfolded" className="lg:col-span-12">
              <AttackTimeline />
            </Rise>

            {/* appendix — reference + utilities, demoted below the story */}
            <div className="mt-2 flex items-center gap-3 lg:col-span-12">
              <span className="label text-faint">Details</span>
              <div className="h-px flex-1 bg-edge" />
            </div>
            <Rise i={6} id="stealth" className="lg:col-span-12">
              <StealthReport />
            </Rise>
            <Rise i={7} id="log" className="lg:col-span-12">
              <CommandReplay />
            </Rise>
            <Rise i={8} className="lg:col-span-12">
              <TrimControl />
            </Rise>

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
