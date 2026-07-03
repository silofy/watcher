import type { CSSProperties, ReactNode } from "react";
import { useReport } from "./store/report";
import { PhaseAudit } from "./components/PhaseAudit";
import { IdentityBar } from "./components/IdentityBar";
import { Assessment } from "./components/Assessment";
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
import { isLiveRecording } from "./lib/live";
import { normalizeCoaching, stepText } from "./lib/coaching";

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

/** The hero card — the single highest-value coaching takeaway, led big and unmissable at the top of
 *  the narrative. Same source `PhaseAudit` used for its own (now-suppressed) "Key takeaway" banner —
 *  see `hideTakeaway` there. Renders nothing when there's no coaching lead (e.g. an old report, or a
 *  live capture still in progress). */
function HeroLesson() {
  const { report } = useReport();
  const lead = normalizeCoaching(report.coaching?.next_steps)[0];
  if (!lead) return null;
  return (
    <div className="rounded-xl border border-signal/40 bg-signal/10 px-6 py-5">
      <span className="label text-signal">The one lesson</span>
      <p className="mt-2 text-xl font-semibold leading-snug text-fg sm:text-2xl">{stepText(lead)}</p>
    </div>
  );
}

export function App() {
  const { report, view, gateDismissed } = useReport();
  const { session } = report;
  const needsWriteup = report.golden_dag.length === 0 && !gateDismissed;
  const recording = isLiveRecording(report);

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
          <div className="mx-auto flex max-w-4xl flex-col gap-6">
            {/* 1. verdict band — identity + grade + stealth + rooted + platform, full width */}
            <Rise i={0} id="identity">
              <IdentityBar />
            </Rise>

            {/* live companion — the mid-run reference bento, shown only while the capture is underway.
                Once the run resolves this disappears and the narrative below is the whole picture. */}
            {recording && (
              <Rise i={1} id="summary">
                <LiveDashboard />
              </Rise>
            )}

            {/* 2. the one lesson — the hero takeaway, unmissable */}
            <Rise i={2}>
              <HeroLesson />
            </Rise>

            {/* 3. what you'd do differently */}
            <Rise i={3} id="path">
              <PathComparison />
            </Rise>

            {/* 4. phase audit — the actionable per-phase spine (its own takeaway banner is suppressed,
                since the hero above already leads with it) */}
            <Rise i={4} id="audit">
              <PhaseAudit hideTakeaway />
            </Rise>

            {/* 4b. you vs. the ghost — the optimal line from where you stood, visible in the main
                narrative (not buried in the collapsed drawer below). Guarded so old reports with no
                ghost data render nothing here. */}
            {report.ghost?.items?.length ? (
              <Rise i={5} id="ghost">
                <Section title="You vs. the Ghost" subtitle="the optimal line from where you stood — wins first">
                  <GhostCard />
                </Section>
              </Rise>
            ) : null}

            {/* 5. evidence & detail — the raw record, collapsed by default. `Collapse` is a native
                <details>: its children stay in the DOM (just visually hidden) even when closed, so the
                static export still carries every section's markup. */}
            <Collapse title="Evidence & detail" subtitle="the raw record — timeline, stealth, frameworks, log, findings">
              <div className="flex flex-col gap-6">
                <DeepDive />
                <Assessment />
              </div>
            </Collapse>

            {/* 6. session window */}
            <Collapse name="debrief-details" title="Session window" subtitle="session facts · retroactively trim the report">
              <SessionFacts />
              <TrimControl />
            </Collapse>

            <footer className="flex items-center justify-between py-6 text-xs text-faint">
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
