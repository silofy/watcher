import { useId, useRef } from "react";
import { useReport, activeSeq } from "../store/report";
import { AXIS_W } from "../lib/scale";
import { episodeNoise, NOISE_BASELINE } from "../lib/metrics";
import { Section, tierColor, Chip } from "./ui";
import { useAxisZoom } from "./useAxisZoom";
import { ZoomControls } from "./ZoomControls";
import { fmtClock } from "../lib/format";
import { ChevronDown } from "./icons";
import { GradientDitherPattern, LevelBar } from "./dither";
import { useWidth } from "./useWidth";
import { ditherMask } from "../lib/dither";

const H = 84;
const TOP = 10;
const BASE_Y = 74;

export function StealthReport() {
  const s = useReport();
  const { report, timeline, phaseWindows, metrics, playheadMs } = s;
  const focus = activeSeq(s);
  const hovered = focus != null ? timeline.bySeq.get(focus) : null;

  const { w0, w1, span, zx, zoomed, zoomOut, reset, sel, handlers } = useAxisZoom(timeline.totalMs);

  // the chart is drawn in AXIS_W × H user units stretched to its box (preserveAspectRatio="none"),
  // so the dither tile is converted per axis to stay 2px dots on screen
  const box = useRef<HTMLDivElement>(null);
  const pxW = useWidth(box, AXIS_W);
  const kx = AXIS_W / Math.max(1, pxW);
  const ky = H / 132;
  const gradRows = Math.ceil(H / (3 * ky));
  const gradId = `noise-${useId().replace(/:/g, "")}`;

  const loudSeqs = new Set(metrics.loud_moments.map((l) => l.seq));
  const stealth = Math.round(metrics.stealth_score);

  // cumulative noise "burn" over the run — the actual metric: Σ noise vs the lab baseline (400).
  let cum = 0;
  const pts = timeline.items.map(({ ep, t1 }) => {
    const n = episodeNoise(ep);
    cum += n;
    return { ms: t1, cum, n, seq: ep.seq, binary: ep.binary, loud: loudSeqs.has(ep.seq) };
  });
  const finalCum = cum;
  // anchored against this box's loud reference solve when present, else the global default
  const baseline = report.noise_baseline?.total ?? NOISE_BASELINE;
  const yMax = Math.max(finalCum, baseline) * 1.04;
  const yOf = (v: number) => BASE_Y - (v / yMax) * (BASE_Y - TOP);

  // rolling exposure: each command's noise decays over ~TAU, so quiet time lowers your CURRENT
  // exposure (what a defender with a fading memory still "sees"). Same noise units → same y-axis.
  const TAU = Math.max(timeline.totalMs / 8, 120_000);
  const events = pts.filter((p) => p.n > 0);
  const expPath = (() => {
    const times = new Set<number>();
    const STEPS = 90;
    for (let i = 0; i <= STEPS; i++) times.add((i / STEPS) * timeline.totalMs);
    for (const e of events) times.add(e.ms);
    let d = "";
    for (const t of [...times].sort((a, b) => a - b)) {
      let v = 0;
      for (const e of events) if (e.ms <= t) v += e.n * Math.exp(-(t - e.ms) / TAU);
      d += `${d ? " L" : "M"} ${zx(t).toFixed(1)} ${yOf(v).toFixed(1)}`;
    }
    return d;
  })();

  // stepped path (flat, then a vertical jump at each command) + a closed area under it
  let line = `M ${zx(0).toFixed(1)} ${yOf(0).toFixed(1)}`;
  let prev = 0;
  for (const p of pts) {
    const x = zx(p.ms).toFixed(1);
    line += ` L ${x} ${yOf(prev).toFixed(1)} L ${x} ${yOf(p.cum).toFixed(1)}`;
    prev = p.cum;
  }
  const lastX = pts.length ? zx(pts[pts.length - 1].ms) : 0;
  const area = `${line} L ${lastX.toFixed(1)} ${BASE_Y} L ${zx(0).toFixed(1)} ${BASE_Y} Z`;

  const loudPts = pts.filter((p) => p.loud);
  const ceilingY = yOf(baseline);

  const loudList = metrics.loud_moments
    .slice(0, 4)
    .map((l) => ({ seq: l.seq, noise: l.noise, binary: report.episodes.find((e) => e.seq === l.seq)?.binary ?? "?" }));
  const maxNoise = Math.max(...metrics.loud_moments.map((m) => m.noise), 1);

  return (
    <Section
      title="Stealth & Noise"
      subtitle="footprint over the run — cumulative builds, exposure decays"
      srTitle
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
      <ZoomControls zoomed={zoomed} w0={w0} w1={w1} zoomOut={zoomOut} reset={reset} />

      {/* legend + the headline number */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3" style={{ background: "var(--color-loud)", ...ditherMask() }} />
          cumulative noise
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2" style={{ borderColor: "var(--color-tool)" }} />
          rolling exposure
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t border-dashed" style={{ borderColor: "var(--color-loud)" }} />
          lab baseline (stealth 0)
        </span>
        <span className="mono ml-auto" style={{ color: finalCum >= baseline * 0.5 ? "var(--color-loud)" : "var(--color-tool)" }} title="how much of the noise budget you spent">
          {Math.round(finalCum)} / {Math.round(baseline)} budget spent
        </span>
      </div>

      {/* the burn-up: area climbs toward the ceiling; steep jumps = loud commands */}
      <div className="relative cursor-crosshair select-none overflow-hidden rounded-md border border-edge bg-ink/40" style={{ height: 132 }} {...handlers}>
        <div ref={box} className="absolute inset-0">
          <svg viewBox={`0 0 ${AXIS_W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <defs>
              <GradientDitherPattern id={gradId} color="var(--color-loud)" rows={gradRows} top={0.9} bottom={0.18} kx={kx} ky={ky} />
            </defs>
            {/* phase boundary separators — where in the run we are */}
            {phaseWindows.slice(1).map(({ phase, t0 }) => (
              <line key={`sep-${phase.mitre_tactic}`} x1={zx(t0)} y1={TOP} x2={zx(t0)} y2={BASE_Y} stroke="var(--color-edge)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ))}

            <line x1={0} y1={BASE_Y} x2={AXIS_W} y2={BASE_Y} stroke="var(--color-edge)" vectorEffect="non-scaling-stroke" />

            {/* the ceiling — if the curve reaches it, stealth is 0 */}
            <line x1={0} y1={ceilingY} x2={AXIS_W} y2={ceilingY} stroke="var(--color-loud)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />

            <path d={area} fill={`url(#${gradId})`} stroke="none" />
            <path d={line} fill="none" stroke="var(--color-loud)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

            {/* rolling exposure — rises at loud moments, decays while you stay quiet */}
            <path d={expPath} fill="none" stroke="var(--color-tool)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.95} />

            {/* per-command hit areas keep hover/click working on the line chart */}
            {timeline.items.map(({ ep, gapStart, t1 }) => (
              <rect
                key={ep.seq}
                x={zx(gapStart)}
                y={TOP}
                width={Math.max(1, zx(t1) - zx(gapStart))}
                height={BASE_Y - TOP}
                fill={focus === ep.seq ? "color-mix(in oklch, var(--color-fg) 8%, transparent)" : "transparent"}
                className="cursor-pointer"
                onMouseEnter={() => s.hover(ep.seq)}
                onMouseLeave={() => s.hover(null)}
                onClick={() => s.select(s.selectedSeq === ep.seq ? null : ep.seq)}
              />
            ))}

            {sel && (
              <rect x={Math.min(sel[0], sel[1]) * AXIS_W} y={TOP} width={Math.abs(sel[1] - sel[0]) * AXIS_W} height={BASE_Y - TOP} fill="color-mix(in oklch, var(--color-signal) 18%, transparent)" stroke="var(--color-signal)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            )}

            <line x1={zx(playheadMs)} y1={TOP} x2={zx(playheadMs)} y2={BASE_Y} stroke="var(--color-fg)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          </svg>
        </div>

        {/* loud-jump markers + labels (HTML, crisp). Only the loud moments, so no collisions. */}
        <div className="pointer-events-none absolute inset-0">
          {loudPts.map((p) => {
            const left = (zx(p.ms) / AXIS_W) * 100;
            if (left < -2 || left > 102) return null;
            const top = (yOf(p.cum) / H) * 100;
            const right = left > 82;
            return (
              <div key={p.seq} className="absolute" style={{ left: `${left}%`, top: `${top}%` }}>
                <span className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: "var(--color-loud)" }} />
                <span className="mono absolute whitespace-nowrap text-xs text-loud" style={{ transform: right ? "translate(-100%, -150%)" : "translate(-50%, -150%)" }}>
                  {p.binary}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* axis — ticks track the zoom window */}
      <div className="mono mt-1 flex justify-between text-xs text-faint">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmtClock(w0 + f * span)}</span>
        ))}
      </div>

      {/* hover detail — the command under the cursor and its contribution */}
      <div className="mt-2 min-h-[1.75rem]">
        {hovered ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-faint">#{hovered.ep.seq}</span>
            <span className="mono text-fg">{hovered.ep.binary}</span>
            {loudSeqs.has(hovered.ep.seq) && <Chip color="var(--color-loud)">loud</Chip>}
            <span className="mono text-xs text-faint">+{episodeNoise(hovered.ep).toFixed(1)} noise</span>
          </div>
        ) : (
          <p className="text-xs text-faint">Hover the curve to inspect a command — or pick a loudest moment below to jump to it.</p>
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
                className="grid w-full grid-cols-[2.6rem_7rem_1fr] items-center gap-2 px-1.5 py-[7px] text-left text-sm transition-colors hover:bg-panel-2/50"
                title={`Step ${l.seq} — click to inspect in the command log`}
              >
                <span className="mono text-xs text-faint">#{l.seq}</span>
                <span className="mono truncate text-fg">{l.binary}</span>
                <span className="min-w-0">
                  <LevelBar value={l.noise} max={maxNoise} color="var(--color-loud)" height={8} label={`${l.binary} noise`} />
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-1 text-xs text-faint">Quiet run — no standout noise against the lab baseline.</p>
      )}

      {/* what the baseline actually is — a named loud reference solve, not a magic number */}
      {report.noise_baseline && (
        <details className="group mt-2 rounded-lg border border-edge bg-panel-2/30">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
            <ChevronDown className="text-faint transition-transform group-open:rotate-180" />
            <span className="label text-faint">Why {Math.round(baseline)}?</span>
            <span className="text-xs text-muted">· the loud reference solve that equals stealth 0</span>
          </summary>
          <div className="border-t border-edge px-3 py-2">
            <p className="mb-2 text-xs text-faint">
              Stealth = 100 − 100 × (your Σ noise ÷ this). It's the noise of owning this box the <span className="text-muted">loud</span> way — anchored per box, not a global constant.
            </p>
            <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              {report.noise_baseline.reference.map((r) => (
                <div key={r.label} className="grid grid-cols-[1fr_3rem] items-baseline gap-2 text-sm">
                  <span className="mono truncate text-muted">{r.label}</span>
                  <span className="mono text-right text-xs text-faint">{r.noise.toFixed(1)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between border-t border-edge pt-1.5 text-sm">
              <span className="label text-faint">total = stealth 0</span>
              <span className="mono text-fg">{report.noise_baseline.total.toFixed(1)}</span>
            </div>
          </div>
        </details>
      )}
    </Section>
  );
}
