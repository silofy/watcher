import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
import { WriteupGate } from "./components/WriteupGate";
import { LlmStatusChip } from "./components/LlmStatusChip";
import { PwnboxSync } from "./components/PwnboxSync";
import { AiBanner } from "./components/AiBanner";
import { LiveBridge } from "./components/LiveBridge";
import { DemoDriver } from "./components/DemoDriver";
import { LiveDashboard } from "./components/LiveDashboard";
import { Onboarding } from "./components/Onboarding";
import { isLiveRecording } from "./lib/live";
import { pickOneLesson } from "./lib/one-lesson";
import { shouldShowNudge } from "./lib/onboarding";
import { ArrowUpRight, ScanEye } from "./components/icons";
import { ditherMask } from "./lib/dither";

function Rise({ i, className, id, children }: { i: number; className?: string; id?: string; children: ReactNode }) {
  return (
    <div id={id} className={`rise ${id ? "scroll-mt-20" : ""} ${className ?? ""}`} style={{ "--i": i } as CSSProperties}>
      {children}
    </div>
  );
}

function Tab({ id, label }: { id: "debrief" | "history" | "progress"; label: string }) {
  const { view, setView } = useReport();
  const active = view === id;
  return (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`label -mb-px flex items-center border-b-2 px-0.5 text-xs tracking-[0.12em] transition-colors ${
        active ? "border-signal font-semibold text-fg" : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

/** The hero card — the single most impactful, evidence-backed takeaway, led big and unmissable at
 *  the top of the narrative. Sourced from `pickOneLesson`, which prioritizes a Ghost late-pivot, a
 *  methodology miss, a rabbit hole, or the first actionable coaching step over a generic recap stat
 *  (see one-lesson.ts for the priority order). Renders nothing when none of those apply — e.g. a
 *  clean run, an old report, or a live capture still in progress — rather than show an empty or
 *  recap-only hero. `PhaseAudit`'s own "Key takeaway" banner stays suppressed via `hideTakeaway`. */
function HeroLesson() {
  const { report, reveal } = useReport();
  const lesson = pickOneLesson(report);
  if (!lesson) return null;
  const body = (
    <>
      <span className="label text-signal">The one lesson</span>
      <p className="mt-2 text-xl font-semibold leading-snug text-fg sm:text-2xl">{lesson.text}</p>
      {lesson.evidence_seq != null && (
        <span className="label mt-2 flex items-center gap-0.5 text-signal/70">
          jump to step {lesson.evidence_seq} <ArrowUpRight size={12} />
        </span>
      )}
    </>
  );
  if (lesson.evidence_seq == null) {
    return (
      <div data-shot="one-lesson" className="rounded-xl border border-signal/40 bg-signal/10 px-6 py-5">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-shot="one-lesson"
      onClick={() => reveal(lesson.evidence_seq!)}
      className="w-full rounded-xl border border-signal/40 bg-signal/10 px-6 py-5 text-left transition-colors hover:bg-signal/15"
      title={`jump to step #${lesson.evidence_seq}`}
    >
      {body}
    </button>
  );
}

export function App() {
  const { report, view, gateDismissed, revealNonce, onboardingOpen, openOnboarding, setOnboardingStep, sessionCards } = useReport();
  const { session } = report;
  const needsWriteup = report.golden_dag.length === 0 && !gateDismissed;
  const recording = isLiveRecording(report);

  const hasRealCapture = sessionCards.some((c) => !c.demo);
  const showNudge = !onboardingOpen && shouldShowNudge({ onboarded: true, hasRealCapture });

  // The Evidence drawer starts closed; a deep-link reveal (a "step N ↗" click from PhaseAudit,
  // coaching, or GhostCard) must force it open so DeepDive's log-tab-and-scroll effect has a
  // visible panel to scroll — otherwise the scroll is a no-op inside a closed <details>.
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // `revealNonce` is global on the store and never resets on session switch (App mounts once,
  // with no key), so it stays > 0 for the tab's whole life once any reveal has fired. Force-closed
  // on every session change so a fresh (or re-opened) report never inherits a prior session's
  // force-opened drawer.
  useEffect(() => {
    setEvidenceOpen(false);
  }, [report.session.uuid]);

  // Open only on a genuine reveal within the current session — i.e. an actual increment of
  // `revealNonce`, not merely a render where it happens to already be > 0 (initial mount, or a
  // session switch that leaves the nonce unchanged from before).
  const lastRevealNonce = useRef(revealNonce);
  useEffect(() => {
    const prev = lastRevealNonce.current;
    lastRevealNonce.current = revealNonce;
    if (revealNonce > 0 && revealNonce !== prev) setEvidenceOpen(true);
  }, [revealNonce]);

  const hasGhost = !!report.ghost?.items?.length;
  const num = { path: "01", audit: "02", ghost: "03", grade: hasGhost ? "04" : "03" };

  return (
    <div className="min-h-full">
      {onboardingOpen && <Onboarding />}
      {/* self-driving live-mode demo — only active on ?demo=live, otherwise renders nothing */}
      <DemoDriver />
      <header className="sticky top-0 z-10 bg-ink/90 backdrop-blur">
        <div className="border-b border-edge">
          <div className="mx-auto flex min-h-16 max-w-6xl items-stretch justify-between gap-6 px-5">
            <div className="flex items-stretch gap-7">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-signal/15 text-signal">
                  <ScanEye size={13} />
                </span>
                <span className="font-display font-semibold tracking-tight text-fg">The Watcher</span>
              </div>
              <nav className="flex items-stretch gap-7">
                <Tab id="debrief" label="Debrief" />
                <Tab id="history" label="History" />
                <Tab id="progress" label="Progress" />
              </nav>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              {showNudge ? (
                <button
                  type="button"
                  onClick={() => { setOnboardingStep(1); openOnboarding(); }}
                  className="group inline-flex items-center gap-2 rounded-[3px] border border-signal/45 px-3 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-signal transition-colors hover:border-signal hover:bg-signal/5"
                  title="Finish setup — capture your first run"
                >
                  <span aria-hidden="true" className="setup-lamp inline-block h-2 w-2 bg-signal" style={ditherMask()} />
                  Finish setup
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              ) : (
                <button type="button" onClick={openOnboarding} className="label text-faint hover:text-muted">
                  Setup guide
                </button>
              )}
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
        {view === "history" ? (
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
              <PathComparison num={num.path} />
            </Rise>

            {/* 4. phase audit — the actionable per-phase spine (its own takeaway banner is suppressed,
                since the hero above already leads with it) */}
            <Rise i={4} id="audit">
              <PhaseAudit hideTakeaway num={num.audit} />
            </Rise>

            {/* 4b. you vs. the ghost — the optimal line from where you stood, visible in the main
                narrative (not buried in the collapsed drawer below). Guarded so old reports with no
                ghost data render nothing here. */}
            {report.ghost?.items?.length ? (
              <Rise i={5} id="ghost">
                <Section
                  title="You vs. the Ghost"
                  num={num.ghost}
                  lead={{
                    value: Math.round((report.ghost.time_lost_ms ?? 0) / 60000),
                    unit: " min",
                    caption: `lost to late pivots${report.ghost.human_wins ? ` · you beat the optimal line ${report.ghost.human_wins}×` : ""}`,
                  }}
                >
                  <GhostCard />
                </Section>
              </Rise>
            ) : null}

            {/* 4c. the grade — visible in the main narrative (not buried in the collapsed drawer
                below), since a verdict this load-bearing shouldn't need a click to see. */}
            <Rise i={6} id="grade">
              <Assessment num={num.grade} />
            </Rise>

            {/* 5. evidence & detail — the raw record, collapsed by default. `Collapse` is a native
                <details>: its children stay in the DOM (just visually hidden) even when closed, so the
                static export still carries every section's markup. */}
            <Collapse
              title="Evidence & detail"
              subtitle="the raw record — timeline, stealth, frameworks, log, findings"
              open={evidenceOpen}
              onToggle={setEvidenceOpen}
              summaryDataShot="evidence-drawer-summary"
            >
              <DeepDive />
            </Collapse>

            {/* 6. session window */}
            <Collapse title="Session window" subtitle="session facts · retroactively trim the report">
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
