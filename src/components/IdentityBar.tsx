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
import { LevelBar } from "./dither";
import { ditherMask, ditherTrack } from "../lib/dither";
import { AsciiField } from "./AsciiField";
import { HEADER_MASK } from "../lib/ascii";
import type { ReactNode } from "react";

/** A 0–100 score's quality word, tiered to match tierColor (Good ≥ 65, Average ≥ 40, else Poor). */
const tierWord = (v: number) => (v >= 65 ? "Good" : v >= 40 ? "Average" : "Poor");

/** A headline score (grade / stealth) tinted by its quality color — number, sub-line, a soft
 *  background band, and a dithered level bar along the bottom edge all carry the color so
 *  "good vs poor" reads at a glance. */
function ScoreReadout({ label, value, sub, color, level }: { label: string; value: ReactNode; sub: string; color: string; level: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-lg px-4 pb-[22px] pt-2 text-right"
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
      <div className="absolute inset-x-0 bottom-0">
        <LevelBar value={level} color={color} height={8} label={`${label} ${Math.round(level)} of 100`} />
      </div>
    </div>
  );
}

const LEVEL: Record<string, number> = { Easy: 1, Medium: 2, Hard: 3, Insane: 4 };

/** Difficulty as four dithered pips (Easy 1 … Insane 4) plus the word, both in the difficulty colour. */
export function DifficultyPips({ label, color }: { label: string; color: string }) {
  const lv = LEVEL[label] ?? 0;
  return (
    <span className="inline-flex items-center gap-[7px]">
      <span aria-hidden="true" className="inline-flex gap-0.5">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} data-on={n <= lv || undefined} className="block h-2.5 w-1.5" style={n <= lv ? { background: color, ...ditherMask() } : ditherTrack()} />
        ))}
      </span>
      <span className="label" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

/** The identity metadata line: difficulty │ OS │ retired/local, no boxes. */
function MetaLine({ target, retired }: { target: ReturnType<typeof targetOf>; retired: boolean }) {
  const parts: ReactNode[] = [];
  const diff = target.difficulty?.label;
  if (diff) parts.push(<DifficultyPips key="d" label={diff} color={DIFFICULTY_COLOR[diff] ?? "var(--color-muted)"} />);
  if (target.os) parts.push(<span key="os" className="label text-muted">{target.os}</span>);
  if (retired) parts.push(<span key="r" className="label">Retired</span>);
  if (target.platform === "local") parts.push(<span key="l" className="label">Local</span>);
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {parts.flatMap((p, i) => (i ? [<span key={`s${i}`} aria-hidden="true" className="h-[11px] w-px bg-edge-bright" />, p] : [p]))}
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
    <div className="relative py-1" data-shot="verdict">
      <AsciiField mask={HEADER_MASK} alpha={0.34} className="-top-[70px] left-[calc(50%-50vw)] h-[calc(100%+100px)] w-screen" />
      <div className="relative z-[1]">
        {/* identity + the headline grade */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <MachineAvatar target={target} size={88} />
            <div className="min-w-0">
              {/* platform attribution — which service this run is from, read before the name itself */}
              <div className="label text-faint">{platformLabel(target.platform)}</div>
              <h1 className="font-display text-5xl font-bold leading-none tracking-tight text-fg">{target.name}</h1>
              <div className="mt-2">
                <MetaLine target={target} retired={retired} />
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
                  level={metrics.stealth_score}
                />
                <ScoreReadout
                  label="Grade"
                  value={grade.letter}
                  sub={`${Math.round(grade.score)} / 100`}
                  color={gradeColor(grade.letter)}
                  level={grade.score}
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
    </div>
  );
}
