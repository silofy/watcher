import { ditherMask, ditherTrack } from "../lib/dither";

/** The lesson's figure: one cell per step: mint where it opened, coral dither for the wait, coral where you acted. */
export function StepStrip({ unlock, acted, total }: { unlock: number; acted: number; total: number }) {
  const cells = Array.from({ length: total }, (_, i) => i + 1);
  const big = "mt-1.5 block font-display text-[30px] font-bold normal-case leading-none tracking-[-0.03em]";
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
      <div className="mt-3 grid h-3.5 gap-0.5" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {cells.map((i) => (
          <i
            key={i}
            className="block"
            style={
              i === unlock
                ? { background: "var(--color-signal)" }
                : i === acted
                  ? { background: "var(--color-loud)" }
                  : i > unlock && i < acted
                    ? { background: "var(--color-loud)", ...ditherMask() }
                    : ditherTrack()
            }
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{acted - unlock} steps where the next move was already on the table</p>
    </div>
  );
}
