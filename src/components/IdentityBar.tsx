import { useReport } from "../store/report";
import { MachineAvatar } from "./MachineAvatar";
import { tierColor } from "./ui";
import { machineOf, DIFFICULTY_COLOR } from "../lib/machine";
import { computeGrade, gradeColor } from "../lib/bridge/grade";
import { detectFlags } from "../lib/flags";
import { normalizeCoaching, stepText } from "../lib/coaching";
import { fmtDuration } from "../lib/format";

function Pill({ text, color }: { text: string; color?: string }) {
  return (
    <span
      className="label rounded border border-edge px-1.5 py-0.5 text-xs"
      style={color ? { color, borderColor: `color-mix(in oklch, ${color} 40%, var(--color-edge))` } : undefined}
    >
      {text}
    </span>
  );
}

function Stat({ label, value, rating, color }: { label: string; value: string; rating?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label text-xs">{label}</span>
      <span className="mono text-sm tabular-nums" style={color ? { color } : undefined}>
        {value}
        {rating && <span className="ml-1.5 text-xs font-medium">{rating}</span>}
      </span>
    </div>
  );
}

/** A 0–100 score's quality word, tiered to match tierColor (Good ≥ 65, Average ≥ 40, else Poor). */
const tierWord = (v: number) => (v >= 65 ? "Good" : v >= 40 ? "Average" : "Poor");

function FlagStat({ label, state, at }: { label: string; state: "yes" | "no" | "unknown"; at?: string }) {
  const v =
    state === "yes"
      ? { t: "✓ Captured", c: "var(--color-match)" }
      : state === "no"
        ? { t: "○ Not captured", c: "var(--color-faint)" }
        : { t: "—", c: "var(--color-faint)" };
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label text-xs">{label}</span>
      <span className="mono text-sm" style={{ color: v.c }}>
        {v.t}
        {state === "yes" && at && <span className="text-faint"> · {at}</span>}
      </span>
    </div>
  );
}

/** The machine "about" header — identity, flags/tasks, session context, and the key takeaway. */
export function IdentityBar() {
  const { report, timeline, sessionCards, activeId, metrics } = useReport();
  const { golden_dag, coaching } = report;
  const machine = machineOf(report);
  const card = sessionCards.find((c) => c.id === activeId);
  const first = normalizeCoaching(coaching.next_steps)[0];
  const narrative = first ? stepText(first) : undefined;

  // verdict numbers folded in from the old KPI bar — grade + the quality metrics
  const grade = computeGrade(report);
  const tw = metrics.time_waster;
  const lost = Math.round(((tw.detour_ms + tw.stuck_ms + tw.loop_ms) / Math.max(1, tw.t_active_ms)) * 100);
  const lostColor = lost >= 30 ? "var(--color-detour)" : lost >= 15 ? "var(--color-tool)" : "var(--color-match)";

  // Flags — telemetry-derived milestones (reading a flag file), independent of any write-up.
  const flags = detectFlags(report.episodes);
  const hasSteps = report.episodes.length > 0;
  const userStep = flags.user ?? flags.system; // rooting implies user-level access
  const userState: "yes" | "no" | "unknown" = userStep != null ? "yes" : hasSteps ? "no" : "unknown";
  const systemState: "yes" | "no" | "unknown" = flags.system != null ? "yes" : hasSteps ? "no" : "unknown";
  // when (how far into the session) a flag was captured — far more meaningful than a step index
  const flagAt = (seq: number | null) => {
    if (seq == null) return undefined;
    const m = Math.round((timeline.bySeq.get(seq)?.t1 ?? 0) / 60_000);
    return m < 1 ? "early" : `${m}m in`;
  };
  // Tasks come from the intended-path objectives (needs a write-up reference).
  const hasRef = golden_dag.length > 0;
  const tasksDone = golden_dag.filter((o) => o.user_satisfied_by_seq != null).length;
  const tasksPct = golden_dag.length ? (tasksDone / golden_dag.length) * 100 : 0;

  return (
    <div className="py-1">
      {/* identity + the headline grade */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <MachineAvatar machine={machine} size={64} />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold leading-none tracking-tight text-fg">{machine.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {machine.difficulty && <Pill text={machine.difficulty} color={DIFFICULTY_COLOR[machine.difficulty]} />}
              {machine.os && <Pill text={machine.os} />}
              {machine.retired && <Pill text="Retired" />}
              {machine.local && <Pill text="Local" />}
              {card?.isLatest && <Pill text="Latest" color="var(--color-signal)" />}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <Stat label="Total time" value={fmtDuration(timeline.totalMs)} />
          <div className="text-right">
            <div className="font-display text-5xl font-bold leading-none" style={{ color: gradeColor(grade.letter) }}>
              {grade.letter}
            </div>
            <div className="label mt-1 tabular-nums text-faint">{Math.round(grade.score)} / 100</div>
          </div>
        </div>
      </div>

      {/* flags on the left, the quality metrics right-aligned — one verdict band */}
      <div className="my-3.5 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-y border-edge py-3">
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <FlagStat label="User flag" state={userState} at={flagAt(userStep)} />
          <FlagStat label="System flag" state={systemState} at={flagAt(flags.system)} />
        </div>
        <div className="flex flex-wrap items-end justify-end gap-x-7 gap-y-3">
          <Stat label="Objectives" value={hasRef ? `${tasksDone}/${golden_dag.length}` : "—"} color={hasRef ? tierColor(tasksPct) : undefined} />
          <Stat label="Time lost" value={`${lost}%`} color={lostColor} />
          <Stat label="Stealth" value={`${Math.round(metrics.stealth_score)}/100`} rating={tierWord(metrics.stealth_score)} color={tierColor(metrics.stealth_score)} />
          <Stat label="Techniques" value={String(metrics.technique_breadth)} />
        </div>
      </div>

      {/* the lesson — the heart of the debrief */}
      {narrative && (
        <div className="mt-3.5 rounded-lg bg-signal/10 px-3.5 py-3">
          <span className="label text-signal">Key takeaway</span>
          <p className="mt-1 text-base leading-relaxed text-fg">{narrative}</p>
        </div>
      )}
    </div>
  );
}
