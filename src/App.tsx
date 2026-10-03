import { type CSSProperties, type ReactNode } from "react";
import { useReport } from "./store/report";
import { PhaseAudit } from "./components/PhaseAudit";
import { IdentityBar } from "./components/IdentityBar";
import { Assessment } from "./components/Assessment";
import { SessionFacts } from "./components/SessionFacts";
import { TrimControl } from "./components/TrimControl";
import { Collapse, Section } from "./components/ui";
import { AttackTimeline } from "./components/AttackTimeline";
import { StealthReport } from "./components/StealthReport";
import { DeviationTimeline } from "./components/DeviationTimeline";
import { FrameworkAxes } from "./components/FrameworkAxes";
import { Findings } from "./components/Findings";
import { CommandReplay } from "./components/CommandReplay";
import { ReportDraft } from "./components/ReportDraft";
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
import { ScanEye } from "./components/icons";
import { ditherMask } from "./lib/dither";
import { StepStrip } from "./components/StepStrip";
import { DefenseRubric } from "./components/DefenseRubric";
import type { OneLesson } from "./lib/one-lesson";
import type { DefenseReport } from "./lib/defense/types";

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
function HeroLesson({ lesson: lessonProp, total: totalProp }: { lesson?: OneLesson | null; total?: number } = {}) {
  const { report, reveal } = useReport();
  const lesson = lessonProp !== undefined ? lessonProp : pickOneLesson(report);
  if (!lesson) return null;
  const p = lesson.pivot;
  const total = totalProp !== undefined ? totalProp : report.episodes.length;
  const body = (
    <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_290px] md:items-center">
      <div>
        <span className="label text-signal">The one lesson</span>
        <p className="mt-3 text-balance font-display text-[26px] font-bold leading-[1.08] tracking-[-0.03em] text-fg sm:text-[34px]">
          {p ? (
            <>
              The way forward opened at step {p.unlock_seq}. <span className="text-loud">You took it at step {p.acted_seq}.</span>
            </>
          ) : (
            lesson.text
          )}
        </p>
        {lesson.evidence_seq != null && <span className="label mt-3.5 inline-block text-signal">Replay step {lesson.evidence_seq} →</span>}
      </div>
      {p && total > 0 && <StepStrip unlock={p.unlock_seq} acted={p.acted_seq} total={total} />}
    </div>
  );
  const cls = "block w-full rounded-lg border border-edge bg-panel px-6 py-7 text-left";
  if (lesson.evidence_seq == null) {
    return (
      <div data-shot="one-lesson" className={cls}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" data-shot="one-lesson" onClick={() => reveal(lesson.evidence_seq!)} className={`${cls} transition-colors hover:border-edge-bright hover:bg-panel-2`} title={`Replay step ${lesson.evidence_seq}`}>
      {body}
    </button>
  );
}

/** Found/missed breakdown of the incident's artifacts — the defense analogue of the offense
 *  objective list, relabeled for coverage of what the analyst should have caught. */
function ArtifactBreakdown({ report }: { report: DefenseReport }) {
  const { incident, result } = report;
  const hitById = new Map(result.hits.map((h) => [h.artifact_id, h]));
  const found = result.hits.filter((h) => h.found).length;
  const total = result.hits.length;
  return (
    <Section
      title="Artifact coverage"
      subtitle="what the incident left behind vs. what the investigation caught"
      lead={{ value: found, unit: ` / ${total}`, caption: "artifacts found" }}
    >
      <div className="divide-y divide-edge/50">
        {incident.artifacts.map((a) => {
          const hit = hitById.get(a.id);
          const foundIt = !!hit?.found;
          return (
            <div key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-muted" title={a.label}>
                {a.label}
              </span>
              <span className="mono shrink-0 text-xs" style={{ color: foundIt ? "var(--color-match)" : "var(--color-skipped)" }}>
                {foundIt ? `found · step ${hit?.found_by_seq ?? "?"}` : "missed"}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** The defense (blue-team) debrief — mirrors the offense narrative's shape (facts, one lesson,
 *  ghost, grade) but sourced from a `DefenseReport`: the incident-artifact coverage stands in for
 *  objectives, and the 5-metric rubric (`DefenseRubric`) stands in for the offense grade panel. */
function DefenseDebrief({ report }: { report: DefenseReport }) {
  const total = report.result.hits.length;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <Rise i={2}>
        <HeroLesson lesson={report.lesson} total={total} />
      </Rise>

      {report.ghost.items.length ? (
        <Rise i={5} id="ghost">
          <Section
            title="You vs. the Ghost"
            lead={{
              value: Math.round((report.ghost.time_lost_ms ?? 0) / 60000),
              unit: " min",
              caption: `lost to late finds${report.ghost.human_wins ? ` · you beat the optimal line ${report.ghost.human_wins}×` : ""}`,
            }}
          >
            <GhostCard ghost={report.ghost} total={total} />
          </Section>
        </Rise>
      ) : null}

      <Rise i={6} id="grade">
        <Section title="Grade" subtitle="how your score breaks down — the defensive rubric">
          <DefenseRubric grade={report.grade} />
        </Section>
      </Rise>

      <Rise i={7}>
        <ArtifactBreakdown report={report} />
      </Rise>

      <Collapse title="Session window" subtitle="session facts">
        <SessionFacts session={report.session} totalMs={Date.parse(report.session.ended_at) - Date.parse(report.session.started_at)} />
      </Collapse>

      <footer className="flex items-center justify-between py-6 text-xs text-faint">
        <span className="mono">defense debrief · {report.session.uuid.slice(0, 8)}</span>
        <span>The Watcher — capture safely, process privately, coach honestly.</span>
      </footer>
    </div>
  );
}

export function App() {
  const { report, view, gateDismissed, onboardingOpen, openOnboarding, setOnboardingStep, sessionCards, defenseReport } = useReport();
  const { session } = report;
  const needsWriteup = report.golden_dag.length === 0 && !gateDismissed;
  const recording = isLiveRecording(report);

  const hasRealCapture = sessionCards.some((c) => !c.demo);
  const showNudge = !onboardingOpen && shouldShowNudge({ onboarded: true, hasRealCapture });

  const hasGhost = !!report.ghost?.items?.length;
  const num = { path: "01", audit: "02", ghost: "03", grade: hasGhost ? "04" : "03" };

  return (
    <div className="min-h-full">
      {onboardingOpen && <Onboarding />}
      {/* self-driving live-mode demo — only active on ?demo=live, otherwise renders nothing */}
      <DemoDriver />
      <header className="sticky top-0 z-10 bg-ink/90 backdrop-blur">
        <div className="border-b border-edge">
          <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-stretch justify-between gap-x-6 gap-y-2 px-5">
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

      {/* `main` spans the full viewport width and clips overflow — the only clipping ancestor for
          decorative full-bleed elements (e.g. IdentityBar's header AsciiField, which escapes the
          `max-w-6xl` container via `left-[calc(50%-50vw)]`/`w-screen`) so they still reach the
          viewport edges without ever causing a horizontal scrollbar. */}
      <main className="overflow-x-clip">
        <div className="mx-auto max-w-6xl px-5 py-5">
          {view === "history" ? (
            <History />
          ) : view === "progress" ? (
            <Progress />
          ) : defenseReport ? (
            <DefenseDebrief report={defenseReport} />
          ) : needsWriteup ? (
            <WriteupGate />
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-10">
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

              {/* The debrief spine is the four numbered beats (path → phases → ghost → grade); each
                  detail view is now docked directly beneath the beat it explains, instead of pooled in
                  one "Evidence & detail" drawer at the foot of the page. The views are already their own
                  <Section>s (titles previously hidden with srTitle for the tab bar) — surfaced here. */}

              {/* 3. what you'd do differently */}
              <Rise i={3} id="path">
                <PathComparison num={num.path} />
              </Rise>

              {/* └ findings — the evidence the run produced, behind the objectives above */}
              <Rise i={4} id="findings">
                <Section title="Findings" subtitle="the evidence your run produced — cross-referenced by the objectives above">
                  <Findings />
                </Section>
              </Rise>

              {/* 4. phase audit — the actionable per-phase spine (its own takeaway banner is suppressed,
                  since the hero above already leads with it) */}
              <Rise i={5} id="audit">
                <PhaseAudit hideTakeaway num={num.audit} />
              </Rise>

              {/* └ the attack timeline — how the phases above unfolded, command by command */}
              <Rise i={6} id="timeline">
                <AttackTimeline />
              </Rise>

              {/* 4b. you vs. the ghost — the optimal line from where you stood. Guarded so old reports
                  with no ghost data render nothing here. */}
              {report.ghost?.items?.length ? (
                <Rise i={7} id="ghost">
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

              {/* └ where the time went — the deviations behind the time the ghost lost above */}
              <Rise i={8} id="deviation">
                <DeviationTimeline />
              </Rise>

              {/* 4c. the grade — the explainable rubric verdict */}
              <Rise i={9} id="grade">
                <Assessment num={num.grade} />
              </Rise>

              {/* └ stealth & noise — the loudness behind the stealth dimension of the grade above */}
              <Rise i={10} id="stealth">
                <StealthReport />
              </Rise>

              {/* └ frameworks — the kill-chain/weakness coverage behind breadth & progression */}
              <Rise i={11} id="frameworks">
                <FrameworkAxes />
              </Rise>

              {/* the deliverable — the OSCP/CPTS-style report, drafted from the run and rendered here
                  (the same output as `npm run report`), so the report step is visible in-app. */}
              <Rise i={12} id="report">
                <ReportDraft />
              </Rise>

              {/* the raw record — the full command log, collapsed as the drill-down. It stays the
                  deep-link target: CommandReplay finds this #log wrapper, opens the <details> inside,
                  and centers the revealed row itself (see CommandReplay's reveal effect). */}
              <div id="log">
                <Collapse title="Command log" subtitle="the full command-by-command record — the deep-link target">
                  <CommandReplay />
                </Collapse>
              </div>

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
        </div>
      </main>
    </div>
  );
}
