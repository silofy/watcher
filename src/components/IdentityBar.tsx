import { useReport } from "../store/report";
import { MachineAvatar } from "./MachineAvatar";
import { tierColor } from "./ui";
import { DIFFICULTY_COLOR } from "../lib/machine";
import { targetOf, platformLabel } from "../lib/platform";
import { computeGrade, gradeColor } from "../lib/bridge/grade";
import { isLiveRecording } from "../lib/live";
import { fmtDuration } from "../lib/format";
import { WriteupControl } from "./WriteupControl";
import { AnimatedNumber } from "./AnimatedNumber";
import type { ReactNode } from "react";

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

/** A 0–100 score's quality word, tiered to match tierColor (Good ≥ 65, Average ≥ 40, else Poor). */
const tierWord = (v: number) => (v >= 65 ? "Good" : v >= 40 ? "Average" : "Poor");

/** A headline score (grade / stealth) tinted by its quality color — number, sub-line, and a soft
 *  background band all carry the color so "good vs poor" reads at a glance. */
function ScoreReadout({ label, value, sub, color }: { label: string; value: ReactNode; sub: string; color: string }) {
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

/** The pills row — difficulty/OS/retired/local, reused by both variants below. */
function AttributePills({ target, retired }: { target: ReturnType<typeof targetOf>; retired: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {target.difficulty?.label && <Pill text={target.difficulty.label} color={DIFFICULTY_COLOR[target.difficulty.label]} filled />}
      {target.os && <Pill text={target.os} />}
      {retired && <Pill text="Retired" />}
      {target.platform === "local" && <Pill text="Local" />}
    </div>
  );
}

/**
 * The machine "about" header — identity + the headline scores, over the writeup-reference accordion.
 * The full-width verdict band: a wide `justify-between` row with an 88px avatar + platform label +
 * `text-5xl` name on the left, and the two headline `ScoreReadout` cards (Stealth, Grade) on the right.
 */
export function IdentityBar() {
  const { report, timeline, metrics } = useReport();
  const target = targetOf(report);
  // Target (schema v1.2) doesn't carry `retired` — read it straight off the raw session.machine block.
  const retired = report.session.machine?.retired ?? false;

  // live capture: the debrief is UNDERWAY, not a verdict — surface where you are, not a premature grade
  const recording = isLiveRecording(report);
  const cmdCount = report.episodes.filter((e) => e.binary).length;
  const currentPhase = report.phases.at(-1)?.label ?? "Recon";
  const grade = computeGrade(report);

  return (
    <div className="py-1">
      {/* identity + the headline grade */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <MachineAvatar target={target} size={88} />
          <div className="min-w-0">
            {/* platform attribution — which service this run is from, read before the name itself */}
            <div className="label text-faint">{platformLabel(target.platform)}</div>
            <h1 className="font-display text-5xl font-bold leading-none tracking-tight text-fg">{target.name}</h1>
            <div className="mt-2">
              <AttributePills target={target} retired={retired} />
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {recording ? (
            /* live: a status block instead of a premature verdict — where you are, right now */
            <div
              className="rounded-lg border px-4 py-2 text-right"
              style={{
                borderColor: "color-mix(in oklch, var(--color-loud) 32%, var(--color-edge))",
                backgroundColor: "color-mix(in oklch, var(--color-loud) 12%, transparent)",
              }}
            >
              <div className="label flex items-center justify-end gap-1.5" style={{ color: "var(--color-loud)" }}>
                <span className="animate-pulse">●</span> Recording
              </div>
              <div className="font-display text-3xl font-bold leading-none text-fg">{currentPhase}</div>
              <div className="label mt-1 tabular-nums text-faint">
                <AnimatedNumber value={cmdCount} /> cmd{cmdCount === 1 ? "" : "s"} · {fmtDuration(timeline.totalMs)}
              </div>
            </div>
          ) : (
            /* finished: the two headline scores, each tinted by its quality tier */
            <>
              <ScoreReadout
                label="Stealth"
                value={<AnimatedNumber value={Math.round(metrics.stealth_score)} />}
                sub={`/100 · ${tierWord(metrics.stealth_score)}`}
                color={tierColor(metrics.stealth_score)}
              />
              <ScoreReadout
                label="Grade"
                value={grade.letter}
                sub={`${Math.round(grade.score)} / 100`}
                color={gradeColor(grade.letter)}
              />
            </>
          )}
        </div>
      </div>

      {/* writeup reference — a minimal accordion under a divider (flags/metrics now live in the run
          summary bento below, so the old verdict band was pure duplication) */}
      <div className="mt-4 border-t border-edge">
        <WriteupControl />
      </div>
    </div>
  );
}
