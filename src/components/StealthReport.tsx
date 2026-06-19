import { useReport, activeSeq } from "../store/report";
import { AXIS_W } from "../lib/scale";
import { episodeNoise } from "../lib/metrics";
import { Section, tierColor, Chip } from "./ui";

const H = 70;
const BASE_Y = 52;
const MAX_BAR = 44;

export function StealthReport() {
  const s = useReport();
  const { report, timeline, metrics, scale, playheadMs } = s;
  const focus = activeSeq(s);
  const hovered = focus != null ? timeline.bySeq.get(focus) : null;

  const maxNoise = Math.max(...report.episodes.map(episodeNoise), 1);
  const loudSeqs = new Set(metrics.loud_moments.map((l) => l.seq));
  const stealth = Math.round(metrics.stealth_score);
  const noisePct = Math.round(100 - metrics.stealth_score);

  const loudList = metrics.loud_moments
    .slice(0, 4)
    .map((l) => ({ seq: l.seq, noise: l.noise, binary: report.episodes.find((e) => e.seq === l.seq)?.binary ?? "?" }));

  return (
    <Section
      title="Stealth & Noise"
      subtitle="noise on the wire vs the lab baseline"
      right={
        <span>
          Stealth{" "}
          <span className="font-semibold" style={{ color: tierColor(stealth) }}>
            {stealth}
          </span>{" "}
          / 100
        </span>
      }
    >
      {/* legend + overall noise — taught once, like the other charts */}
      <div className="mb-1.5 flex items-center gap-3 text-xs text-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: "var(--color-tool)" }} />
          steady
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: "var(--color-loud)" }} />
          loud moment
        </span>
        <span className="mono ml-auto" style={{ color: noisePct >= 50 ? "var(--color-loud)" : "var(--color-tool)" }}>
          noise {noisePct}% of baseline
        </span>
      </div>

      {/* noise on a true zero baseline; bar height ∝ loudness. No floating labels (they collided). */}
      <div className="relative" style={{ height: 96 }}>
        <svg viewBox={`0 0 ${AXIS_W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1={0} y1={BASE_Y} x2={AXIS_W} y2={BASE_Y} stroke="var(--color-edge)" vectorEffect="non-scaling-stroke" />
          {timeline.items.map(({ ep, t0, t1 }) => {
            const noise = episodeNoise(ep);
            if (noise <= 0) return null;
            const x = scale((t0 + t1) / 2);
            const h = (noise / maxNoise) * MAX_BAR;
            const loud = loudSeqs.has(ep.seq);
            const dim = focus != null && focus !== ep.seq;
            return (
              <g
                key={ep.seq}
                opacity={dim ? 0.3 : 1}
                className="cursor-pointer"
                onMouseEnter={() => s.hover(ep.seq)}
                onMouseLeave={() => s.hover(null)}
                onClick={() => s.select(s.selectedSeq === ep.seq ? null : ep.seq)}
              >
                <rect
                  x={x - 3}
                  y={BASE_Y - h}
                  width={6}
                  height={h}
                  rx={1}
                  fill={loud ? "var(--color-loud)" : "var(--color-tool)"}
                  stroke={focus === ep.seq ? "var(--color-fg)" : "none"}
                  strokeWidth={focus === ep.seq ? 1.5 : 0}
                />
                <title>{`#${ep.seq} ${ep.binary} — noise ${noise.toFixed(1)}`}</title>
              </g>
            );
          })}
          <line x1={scale(playheadMs)} y1={4} x2={scale(playheadMs)} y2={BASE_Y} stroke="var(--color-fg)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </svg>
      </div>

      {/* hover detail */}
      <div className="mt-2 min-h-[1.75rem]">
        {hovered ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-faint">#{hovered.ep.seq}</span>
            <span className="mono text-fg">{hovered.ep.binary}</span>
            {loudSeqs.has(hovered.ep.seq) && <Chip color="var(--color-loud)">loud</Chip>}
            <span className="mono text-xs text-faint">noise {episodeNoise(hovered.ep).toFixed(1)}</span>
          </div>
        ) : (
          <p className="text-xs text-faint">Hover a spike to inspect — or pick a loudest moment below to jump to it.</p>
        )}
      </div>

      {/* loudest moments — ranked, clickable, jumps to the command log */}
      {loudList.length > 0 ? (
        <div className="mt-2">
          <h3 className="label mb-1 text-faint">Loudest moments</h3>
          <div className="divide-y divide-edge/40">
            {loudList.map((l) => (
              <button
                key={l.seq}
                type="button"
                onClick={() => s.reveal(l.seq)}
                onMouseEnter={() => s.hover(l.seq)}
                onMouseLeave={() => s.hover(null)}
                className="grid w-full grid-cols-[2.6rem_1fr_3.5rem] items-center gap-2 px-1.5 py-1 text-left text-sm transition-colors hover:bg-panel-2/50"
                title={`Step ${l.seq} — click to inspect in the command log`}
              >
                <span className="mono text-xs text-faint">#{l.seq}</span>
                <span className="mono truncate text-fg">{l.binary}</span>
                <span className="justify-self-end">
                  <div className="h-1.5 w-12 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full" style={{ width: `${Math.round((l.noise / maxNoise) * 100)}%`, background: "var(--color-loud)" }} />
                  </div>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs text-faint">Quiet run — no standout noise against the lab baseline.</p>
      )}
    </Section>
  );
}
