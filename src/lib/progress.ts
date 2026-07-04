import type { PlatformId, Target } from "../types/report";

export interface ProgressCard { id: string; ended_at: string; target: Target; grade: number; letter: string; coverage: number; breadth: number; methodology: number | null; rooted: boolean; demo: boolean; }
export interface ProgressPoint { id: string; date: number; label: string; grade: number; letter: string; coverage: number; breadth: number; methodology: number | null; rooted: boolean; platform: PlatformId; demo: boolean; }
export interface ProgressSummary { runs: number; rootedRate: number; bestGrade: number; medianGrade: number; platforms: string[]; }

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Date-sorted, demo-excluded progress points. Pure (parses fixed ISO strings). */
export function progressSeries(cards: ProgressCard[]): ProgressPoint[] {
  return cards
    .filter((c) => !c.demo)
    .map((c) => ({ id: c.id, date: Date.parse(c.ended_at), label: c.target.name, grade: c.grade, letter: c.letter, coverage: c.coverage, breadth: c.breadth, methodology: c.methodology, rooted: c.rooted, platform: c.target.platform, demo: c.demo }))
    .filter((p) => Number.isFinite(p.date))
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

export function progressSummary(points: ProgressPoint[]): ProgressSummary {
  const runs = points.length;
  const grades = points.map((p) => p.grade);
  const rooted = points.filter((p) => p.rooted).length;
  return {
    runs,
    rootedRate: runs === 0 ? 0 : (rooted / runs) * 100,
    bestGrade: runs === 0 ? 0 : Math.max(...grades),
    medianGrade: median(grades),
    platforms: [...new Set(points.map((p) => p.platform))],
  };
}

/** An SVG path over a value series scaled into [0,width]×[0,height] (y inverted). Each contiguous
 *  run of non-null values is its own subpath; nulls break the line (no bridging across gaps).
 *  Needs ≥2 non-null points total to draw anything. Pure/deterministic. */
export function progressPath(values: (number | null)[], width: number, height: number, min = 0, max = 100): string {
  const n = values.length;
  if (n < 2) return "";
  const span = max - min || 1;
  const pts: string[] = [];
  let drawn = 0;
  let inRun = false;
  values.forEach((v, i) => {
    if (v == null) { inRun = false; return; }
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / span) * height;
    pts.push(`${inRun ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
    inRun = true;
    drawn++;
  });
  return drawn >= 2 ? pts.join(" ") : "";
}

export interface ProgressDot { i: number; x: number; y: number; value: number }

/** Per-point (x,y) coordinates for the non-null values, in the same [0,width]×[0,height] scale
 *  `progressPath` draws its line in — for placing one clickable dot per run on the trend chart.
 *  Pure/deterministic; returns [] below 2 total points (nothing to plot against). */
export function progressDots(values: (number | null)[], width: number, height: number, min = 0, max = 100): ProgressDot[] {
  const n = values.length;
  if (n < 2) return [];
  const span = max - min || 1;
  const dots: ProgressDot[] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / span) * height;
    dots.push({ i, x, y, value: v });
  });
  return dots;
}
