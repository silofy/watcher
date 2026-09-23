import { ditherMask, ditherTrack } from "../lib/dither";

export type StepCellKind = "unlock" | "acted" | "gap" | "track";

/**
 * Buckets `total` steps into at most `maxCells` cells so the strip stays legible for long runs
 * (an episode-per-cell grid is unreadable past a few dozen steps). Cell `i` covers a contiguous
 * step range; it reads `acted` if the range contains the acted step (acted wins over unlock when
 * both land in the same cell), `unlock` if it contains the unlock step, `gap` if the range lies
 * strictly between the two, else `track`. When `total <= maxCells` each cell covers exactly one
 * step, matching the previous one-cell-per-step rendering.
 */
export function stepCells(unlock: number, acted: number, total: number, maxCells = 60): StepCellKind[] {
  const n = Math.max(1, total);
  const count = Math.min(maxCells, n);
  const cells: StepCellKind[] = [];
  for (let i = 0; i < count; i++) {
    const lo = Math.floor((i * n) / count) + 1;
    const hi = Math.floor(((i + 1) * n) / count);
    if (acted >= lo && acted <= hi) cells.push("acted");
    else if (unlock >= lo && unlock <= hi) cells.push("unlock");
    else if (lo > unlock && hi < acted) cells.push("gap");
    else cells.push("track");
  }
  return cells;
}

const CELL_STYLE = {
  unlock: { background: "var(--color-signal)" },
  acted: { background: "var(--color-loud)" },
  gap: { background: "var(--color-loud)", ...ditherMask() },
  track: ditherTrack(),
} as const satisfies Record<StepCellKind, object>;

/** The lesson's figure: a bucketed strip of cells: mint where it opened, coral dither for the wait, coral where you acted. */
export function StepStrip({ unlock, acted, total }: { unlock: number; acted: number; total: number }) {
  const cells = stepCells(unlock, acted, total);
  const big = "mt-1.5 block font-display text-[30px] font-bold leading-none tracking-[-0.03em]";
  return (
    <div role="img" aria-label={`Unlocked at step ${unlock}, acted at step ${acted}`}>
      <div className="label flex items-baseline justify-between">
        <span>
          Unlocked<b className={`${big} text-fg`}>Step {unlock}</b>
        </span>
        <span className="text-right">
          You acted<b className={`${big} text-loud`}>Step {acted}</b>
        </span>
      </div>
      <div className="mt-3 grid h-3.5 gap-0.5" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((kind, i) => (
          <i key={i} className="block" style={CELL_STYLE[kind]} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{acted - unlock} steps where the next move was already on the table</p>
    </div>
  );
}
