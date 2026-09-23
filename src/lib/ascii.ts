/** The site's drifting ASCII texture, ported: a sine-interference field mapped onto a density ramp. */
export const ASCII_RAMP = [" ", "·", ".", ":", "-", "+", "=", "o", "x", "*", "#", "%", "@"] as const;

export function asciiField(nx: number, ny: number, t: number): number {
  const x = nx * 9;
  const y = ny * 5;
  let v = Math.sin(x + t) + Math.sin(y * 1.3 - t * 0.7) + Math.sin((x + y) * 0.8 + t * 0.5) + Math.sin(Math.hypot(x - 4.5, y - 2) * 1.6 - t);
  v = 0.5 + 0.5 * (v / 4);
  return Math.max(0, Math.min(1, v)) ** 1.3;
}

export function asciiChar(v: number): string {
  return ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(v * ASCII_RAMP.length))];
}

/** Header: only the outer side margins, fading to nothing toward the bottom. */
export const HEADER_MASK = (nx: number, ny: number): number => {
  const s = Math.abs(nx - 0.5) * 2;
  return s < 0.42 ? 0 : ((s - 0.42) / 0.58) ** 1.2 * (1 - ny * 0.9);
};

/** Empty states: a frame of texture around the box edges, clear in the middle. */
export const EMPTY_MASK = (nx: number, ny: number): number => {
  const r = Math.hypot((nx - 0.5) * 2.2, (ny - 0.5) * 3.2);
  return r < 1.1 ? 0 : Math.min(1, (r - 1.1) * 1.4);
};
