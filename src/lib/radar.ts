/**
 * Pure polar-to-cartesian geometry for the grade radar (see Assessment.tsx). Axes are evenly spaced
 * around the circle starting straight up (12 o'clock) and proceeding clockwise, so the chart reads
 * the same regardless of how many rubric dimensions are active — 6 for a v1 report, 8 for v2.
 */
export interface RadarGeometry {
  cx: number;
  cy: number;
  r: number;
}

export const RADAR_GEOMETRY: RadarGeometry = { cx: 120, cy: 115, r: 78 };

/**
 * Point on axis `i` of `n` evenly-spaced axes, at `frac` of the radius (0 = center, 1 = rim).
 * Axis 0 is straight up; axes proceed clockwise in increments of 2π/n.
 */
export function radarPoint(i: number, frac: number, n: number, geo: RadarGeometry = RADAR_GEOMETRY): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [geo.cx + Math.cos(angle) * geo.r * frac, geo.cy + Math.sin(angle) * geo.r * frac];
}
