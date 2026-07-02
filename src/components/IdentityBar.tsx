import { useReport } from "../store/report";
import { MachineAvatar } from "./MachineAvatar";
import { tierColor } from "./ui";
import { machineOf, DIFFICULTY_COLOR } from "../lib/machine";
import { computeGrade, gradeColor } from "../lib/bridge/grade";
import { detectFlags } from "../lib/flags";
import { normalizeCoaching, stepText } from "../lib/coaching";

/**
 * A machine attribute chip. `filled` tints the whole chip by its color — used for the attributes that
 * carry a signal (difficulty, latest). Plain chips are quiet metadata (OS, retired), so the eye goes
 * to the meaningful ones instead of a flat row of identical pills.
 */
function Pill({ text, color, filled }: { text: string; color?: string; filled?: boolean }) {
  if (filled && color) {
    return (
      <span
        className="label rounded px-1.5 py-0.5 text-xs font-medium"
        style={{
          color,
          backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`,
          border: `1px solid color-mix(in oklch, ${color} 40%, transparent)`,
        }}
      >
        {text}
      </span>
    );
  }
  return <span className="label rounded border border-edge px-1.5 py-0.5 text-xs text-faint">{text}</span>;
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

/** A headline score (grade / stealth) tinted by its quality color — number, sub-line, and a soft
 *  background band all carry the color so "good vs poor" reads at a glance. */
function ScoreReadout({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div
      className="rounded-lg px-4 py-2 text-right"
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklch, ${color} 32%, var(--color-edge))`,
      }}
    >
      <div className="label text-faint">{label}</div>
      <div className="font-display text-5xl font-bold leading-none" style={{ color }}>
        {value}
      </div>
      <div className="label mt-1 tabular-nums" style={{ color }}>
        {sub}
      </div>
    </div>
  );
}

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
  const { report, timeline, metrics } = useReport();
  const { golden_dag, coaching } = report;
  const machine = machineOf(report);
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
          <MachineAvatar machine={machine} size={88} />
          <div className="min-w-0">
            <h1 className="font-display text-5xl font-bold leading-none tracking-tight text-fg">{machine.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {machine.difficulty && <Pill text={machine.difficulty} color={DIFFICULTY_COLOR[machine.difficulty]} filled />}
              {machine.os && <Pill text={machine.os} />}
              {machine.retired && <Pill text="Retired" />}
              {machine.local && <Pill text="Local" />}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* the two headline scores, each tinted by its quality tier */}
          <ScoreReadout
            label="Stealth"
            value={String(Math.round(metrics.stealth_score))}
            sub={`/100 · ${tierWord(metrics.stealth_score)}`}
            color={tierColor(metrics.stealth_score)}
          />
          <ScoreReadout
            label="Grade"
            value={grade.letter}
            sub={`${Math.round(grade.score)} / 100`}
            color={gradeColor(grade.letter)}
          />
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
