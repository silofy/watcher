import type { CSSProperties } from "react";

/**
 * Ordered (Bayer) dither: the texture vocabulary of the editorial-dark design. One rule everywhere:
 * dense dots = value reached, sparse grey dots = headroom. Same algorithm as the marketing site's
 * `ditherFill`, so the app and the site draw identical dots.
 */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

export const DITHER = { cell: 3, dot: 2, tile: 12, value: 0.9, track: 0.28, trackColor: "#3a3a40" } as const;

export function ditherOn(density: number, col: number, row: number): boolean {
  return density > (BAYER4[row % 4][col % 4] + 0.5) / 16;
}

export function ditherCells(density: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) if (ditherOn(density, col, row)) out.push([col, row]);
  return out;
}

/** A 12×12 SVG tile as a CSS url(). `color` must be a literal colour: CSS variables don't resolve inside data URIs. */
export function ditherTile(density: number, color = "#fff"): string {
  const { cell, dot, tile } = DITHER;
  const rects = ditherCells(density)
    .map(([c, r]) => `<rect x='${c * cell}' y='${r * cell}' width='${dot}' height='${dot}' fill='${color}'/>`)
    .join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>${rects}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Punch the element's own background into dots: it keeps its colour, one mask serves every colour. */
export function ditherMask(density: number = DITHER.value): CSSProperties {
  const t = ditherTile(density);
  const size = `${DITHER.tile}px ${DITHER.tile}px`;
  return { WebkitMaskImage: t, maskImage: t, WebkitMaskSize: size, maskSize: size };
}

/** The sparse grey headroom track behind a value. */
export function ditherTrack(density: number = DITHER.track): CSSProperties {
  return { backgroundImage: ditherTile(density, DITHER.trackColor), backgroundSize: `${DITHER.tile}px ${DITHER.tile}px` };
}

/** Density for pattern row `row` of `rows`, linear from `top` to `bottom`. */
export function gradientDensity(row: number, rows: number, top: number, bottom: number): number {
  if (rows <= 1) return top;
  return top + (bottom - top) * (row / (rows - 1));
}
