import { DITHER, ditherCells, ditherMask, ditherOn, ditherTrack, gradientDensity } from "../lib/dither";

/** The one quantity bar: sparse grey track, dense dots up to the value, square ends. */
export function LevelBar({
  value,
  max = 100,
  color,
  height = 8,
  label,
  className = "",
}: {
  value: number;
  max?: number;
  color: string;
  height?: number;
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={`relative w-full ${className}`}
      style={{ height, ...ditherTrack() }}
    >
      <div className="absolute inset-y-0 left-0" style={{ width: `${Math.round(pct * 10) / 10}%`, background: color, ...ditherMask() }} />
    </div>
  );
}

/** A flat-density SVG pattern. `kx`/`ky` = user units per screen px (1 when the SVG is drawn 1:1). */
export function DitherPattern({ id, color, density = DITHER.value, kx = 1, ky = 1 }: { id: string; color: string; density?: number; kx?: number; ky?: number }) {
  const { cell, dot, tile } = DITHER;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={tile * kx} height={tile * ky}>
      {ditherCells(density).map(([c, r]) => (
        <rect key={`${c}-${r}`} x={c * cell * kx} y={r * cell * ky} width={dot * kx} height={dot * ky} fill={color} />
      ))}
    </pattern>
  );
}

/** A vertical-gradient pattern spanning `rows` cell rows: density `top` at row 0, `bottom` at the last. */
export function GradientDitherPattern({
  id,
  color,
  rows,
  top,
  bottom,
  kx = 1,
  ky = 1,
}: {
  id: string;
  color: string;
  rows: number;
  top: number;
  bottom: number;
  kx?: number;
  ky?: number;
}) {
  const { cell, dot, tile } = DITHER;
  const rects = [];
  for (let r = 0; r < rows; r++) {
    const d = gradientDensity(r, rows, top, bottom);
    for (let c = 0; c < 4; c++) {
      if (ditherOn(d, c, r)) rects.push(<rect key={`${c}-${r}`} x={c * cell * kx} y={r * cell * ky} width={dot * kx} height={dot * ky} fill={color} />);
    }
  }
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" x={0} y={0} width={tile * kx} height={rows * cell * ky}>
      {rects}
    </pattern>
  );
}
