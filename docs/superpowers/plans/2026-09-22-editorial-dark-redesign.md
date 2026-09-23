# Editorial Dark Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle The Watcher app into the marketing site's editorial language in dark (neutral black, Hanken headlines, mono eyebrows, flat hairline surfaces, a data-driven Bayer-dither vocabulary) and cut the Debrief's text load (lesson hero, numbered sections led by one figure, route bar, phase stat cells, Ghost pivot strip).

**Architecture:** Presentation-only. Tokens and type change in `src/index.css` (mirrored in `src/lib/scale.ts`). A small pure dither library (`src/lib/dither.ts`) feeds three React primitives (`LevelBar`, `DitherPattern`, `GradientDitherPattern`); every bar in the app uses the one rule "dense = value, sparse = headroom". New logic (Ghost headline, route steps, phase stats, lesson pivot, ASCII field) lives in pure, unit-tested helpers; components only render them.

**Tech Stack:** React 18, TypeScript 5.6, Tailwind v4 (`@theme` tokens), zustand 5, Vite 6, Vitest 2 (node env, `renderToStaticMarkup` for component tests).

**Spec:** `docs/superpowers/specs/2026-09-22-editorial-dark-redesign-design.md` (read it first). Visual reference: `docs/superpowers/specs/2026-09-22-editorial-dark-reference/` (`watcher-preview.js`, `watcher-hier.js`), throwaway DOM patches that show the target look. Do not copy their DOM-patching approach.

## Global Constraints

- Presentation only: no metric, grade, pipeline, or schema change. The single data addition is the optional `OneLesson.pivot` (Task 11).
- Tokens: ink `#0b0b0c`, panel `#111113`, panel-2 `#18181b`, edge `#232326`, edge-bright `#34343a`, fg `#ededee`, muted `#a0a3aa`, faint `#80848c`, signal/match/manual `#2fe6b0`, signal-dim `#22b58a`, tool `oklch(0.8 0.085 292)`, alt `oklch(0.84 0.1 201)`. All other legend hues unchanged.
- Fonts: Hanken Grotesk (display + body), Spline Sans Mono (eyebrows, numbers-in-code). Saira is removed.
- Radii: 3px for `rounded-md/lg/xl/2xl`. `rounded-full` stays only for dots.
- Dither: Bayer 4×4 `[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]`, cell 3px, dot 2px, tile 12px in **screen px**; value density 0.9, track density 0.28 in `#3a3a40`.
- Dither is **not** used on: the radar fill, chips/tags, legend dots, selection/hover/brush rects, the timeline episode ribbon, text, icons.
- Copy on the redesigned surfaces: plain statements with numbers, no em-dash asides, no quips.
- Semantic colours come from data maps (`DIFFICULTY_COLOR`, `tierColor`, `gradeColor`, `ACTOR_COLORS`), never from `getComputedStyle`.
- Tests: SSR renders read the store's **initial** snapshot (`useReport.setState` has no effect in `renderToStaticMarkup`), so test new components through props and pure helpers.
- Gate after every task: `npm test` (466 passing at branch point, plus the new tests) and `npm run typecheck` both green.
- Commit after every task, message ending with:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/index.css` | modify | tokens, radii, type utilities (moved into `@layer components`), lamp animation, `overflow-x: clip` |
| `src/lib/scale.ts` | modify | SVG mirror of the changed legend colours |
| `src/main.tsx`, `package.json` | modify | drop Saira |
| `src/lib/dither.ts` | create | pure Bayer maths: cells, data-URI tiles, CSS mask/track styles, gradient density |
| `src/components/dither.tsx` | create | `LevelBar`, `DitherPattern`, `GradientDitherPattern` |
| `src/components/useWidth.ts` | create | ResizeObserver width hook for 1:1 SVGs |
| `src/components/ui.tsx` | modify | `Section` (`num`, `lead`, subtitle → info tip), flat `Panel`, `Collapse` eyebrow, new `Tag`, `TallyKey` |
| `src/App.tsx` | modify | 64px header, tabs, Finish-setup button, Install tab removed, section numbers, Ghost section lead, lesson hero |
| `src/store/report.ts` | modify | `View` loses `"install"` |
| `src/components/Install.tsx` | modify | `Install` → `InstallReference` (body only) |
| `src/components/Onboarding.tsx` | modify | capture step gains "All setup options"; export `StepCapture` |
| `src/components/PwnboxSync.tsx`, `LlmStatusChip.tsx` | modify | 3px corners; Pwnbox "setup" opens the wizard |
| `src/components/IdentityBar.tsx` | modify | metadata line + `DifficultyPips`, score tiles with `LevelBar`, header ASCII field |
| `src/components/Assessment.tsx` | modify | 8px `LevelBar` metric bars, `num` + lead |
| `src/lib/phase-stats.ts` | create | pure phase stat cells + lead |
| `src/components/PhaseAudit.tsx` | modify | `PhaseLevel`, stat cells, tags, General row, `num` + lead |
| `src/lib/route.ts` | create | pure route steps + counts |
| `src/components/PathComparison.tsx` | modify | route bar, change list, collapsible map, `num` + lead |
| `src/lib/ghost/headline.ts` | create | pure Ghost headline, verdict counts, detail line |
| `src/components/PivotStrip.tsx` | create | the Ghost strip chart + readout |
| `src/components/GhostCard.tsx` | modify | headline + tally + strip |
| `src/lib/one-lesson.ts` | modify | `OneLesson.pivot` |
| `src/components/StepStrip.tsx` | create | lesson hero figure |
| `src/components/StealthReport.tsx` | modify | gradient-dither area, full-width loudest bars |
| `src/lib/ascii.ts` | create | pure ASCII field maths + masks |
| `src/components/AsciiField.tsx` | create | canvas renderer |
| `src/components/Progress.tsx` | modify | empty-state ASCII |

---

### Task 1: Tokens, type, radii

**Files:**
- Modify: `src/index.css`, `src/lib/scale.ts:14-19,53-59`, `src/main.tsx:3`, `package.json`
- Test: `tests/theme-tokens.test.ts`

**Interfaces:**
- Produces: CSS custom properties per Global Constraints; `.label`, `.font-display`, `.readout` live in `@layer components` so Tailwind utilities (e.g. `label text-signal`) override them.

- [ ] **Step 1: Write the failing test**

```ts
// tests/theme-tokens.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACTOR_COLORS, ALIGNMENT_COLORS, DETOUR_COLOR } from "../src/lib/scale";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing --color-${name}`);
  return m[1].trim();
};
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("editorial-dark tokens", () => {
  it("uses the neutral-black ground and the mint signal", () => {
    expect(token("ink")).toBe("#0b0b0c");
    expect(token("signal")).toBe("#2fe6b0");
  });

  it("keeps eyebrow (faint) and secondary (muted) text at >= 4.5:1 on the ground", () => {
    expect(contrast(token("faint"), token("ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("muted"), token("ink"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps scale.ts's SVG legend in sync with the CSS tokens", () => {
    expect(ACTOR_COLORS.machine_bound).toBe(token("tool"));
    expect(ACTOR_COLORS.human_active).toBe(token("manual"));
    expect(ALIGNMENT_COLORS.match).toBe(token("match"));
    expect(ALIGNMENT_COLORS.alternative).toBe(token("alt"));
    expect(DETOUR_COLOR).toBe(token("detour"));
  });

  it("drops Saira and flattens radii to 3px", () => {
    expect(css).not.toMatch(/Saira/);
    expect(css).toMatch(/--radius-lg:\s*3px/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/theme-tokens.test.ts`
Expected: FAIL (`expected 'oklch(0.15 0.04 286)' to be '#0b0b0c'`).

- [ ] **Step 3: Update `src/index.css`**

In `@theme`, replace the font and colour lines with:

```css
  /* type: Hanken Grotesk (display + body) · Spline Sans Mono (eyebrows, readouts) */
  --font-display: "Hanken Grotesk Variable", "Hanken Grotesk", system-ui, sans-serif;
  --font-sans: "Hanken Grotesk Variable", "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "Spline Sans Mono Variable", "Spline Sans Mono", ui-monospace, monospace;

  /* neutral-black ground (editorial dark) */
  --color-ink: #0b0b0c;
  --color-panel: #111113;
  --color-panel-2: #18181b;
  --color-edge: #232326;
  --color-edge-bright: #34343a;
  --color-fg: #ededee;
  --color-muted: #a0a3aa;
  --color-faint: #80848c;

  /* the one signal: mint */
  --color-signal: #2fe6b0;
  --color-signal-dim: #22b58a;

  /* actor-mode instrument legend */
  --color-tool: oklch(0.8 0.085 292);
  --color-manual: #2fe6b0;
  --color-stuck: oklch(0.78 0.129 25);
  --color-detour: oklch(0.66 0.16 29);
  --color-idle: oklch(0.5 0.03 250);

  /* alignment / verdict accents */
  --color-match: #2fe6b0;
  --color-alt: oklch(0.84 0.1 201);
  --color-skipped: oklch(0.6 0.045 250);
  --color-loud: oklch(0.7 0.16 30);
  --color-flag: oklch(0.83 0.143 85);
  --color-web: oklch(0.75 0.14 230);

  /* flat editorial surfaces */
  --radius-md: 3px;
  --radius-lg: 3px;
  --radius-xl: 3px;
  --radius-2xl: 3px;
```

Rewrite the header comment above `@theme` to describe "editorial dark: neutral black ground, one mint signal, the actor legend unchanged; Hanken Grotesk + Spline Sans Mono", and remove **every** other mention of Saira in `index.css` (e.g. the `.label` comment); the test asserts the file no longer contains the word.

Wrap the "instrument vocabulary" block (`.font-display`, `.label`, `.mono`, `.tnum`, `.rule`, `.rule-y`, `.readout`, `.ticks*`) in `@layer components { … }` and change three rules inside it:

```css
  .font-display {
    font-family: var(--font-display);
    letter-spacing: -0.02em;
  }

  /* mono eyebrow: small, wide-tracked uppercase Spline Mono */
  .label {
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-weight: 500;
    font-size: 0.65625rem; /* 10.5px */
    color: var(--color-faint);
  }

  .readout {
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1;
  }
```

After the `html, body, #root` rule add:

```css
/* decorative fields bleed to the viewport edges; never let them cause a horizontal scrollbar */
html {
  overflow-x: clip;
}
```

Before the `prefers-reduced-motion` block add the Finish-setup lamp:

```css
@keyframes lamp {
  50% {
    opacity: 0.35;
  }
}
.setup-lamp {
  animation: lamp 1.8s ease-in-out infinite;
}
```

and inside the existing `@media (prefers-reduced-motion: reduce)` block add `.setup-lamp { animation: none; }`.

- [ ] **Step 4: Mirror the legend in `src/lib/scale.ts`**

```ts
export const ACTOR_COLORS: Record<ActorMode, string> = {
  machine_bound: "oklch(0.8 0.085 292)", // tool (lavender)
  human_active: "#2fe6b0", // manual (mint)
  think_pause: "oklch(0.78 0.129 25)", // stuck (coral)
  idle: "oklch(0.5 0.03 250)", // walked away
};
```

and in `ALIGNMENT_COLORS` set `match: "#2fe6b0"` and `alternative: "oklch(0.84 0.1 201)"`. Update the comment above `ACTOR_COLORS` from "OKLCH instrument legend" to "Instrument legend".

- [ ] **Step 5: Drop Saira**

Delete `import "@fontsource-variable/saira";` from `src/main.tsx`, then run `npm uninstall @fontsource-variable/saira`.

- [ ] **Step 6: Run the test, the suite and typecheck**

Run: `npx vitest run tests/theme-tokens.test.ts && npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Look at it**

Run `npm run dev`, open http://localhost:5173. Expected: neutral black, mint accents, Hanken headlines, mono eyebrows, 3px corners, no layout breakage.

- [ ] **Step 8: Commit**

```bash
git add src/index.css src/lib/scale.ts src/main.tsx package.json package-lock.json tests/theme-tokens.test.ts
git commit -m "theme: editorial-dark tokens, Hanken + mono eyebrows, 3px radii, drop Saira"
```

---

### Task 2: Dither library (pure)

**Files:**
- Create: `src/lib/dither.ts`
- Test: `src/lib/dither.test.ts`

**Interfaces:**
- Produces:
  - `BAYER4: readonly (readonly number[])[]`
  - `DITHER: { cell: 3; dot: 2; tile: 12; value: 0.9; track: 0.28; trackColor: "#3a3a40" }`
  - `ditherOn(density: number, col: number, row: number): boolean`
  - `ditherCells(density: number): Array<[col: number, row: number]>`
  - `ditherTile(density: number, color?: string): string` returns a CSS `url("data:image/svg+xml,…")`
  - `ditherMask(density?: number): CSSProperties` (mask over the element's own background)
  - `ditherTrack(density?: number): CSSProperties` (sparse grey background)
  - `gradientDensity(row: number, rows: number, top: number, bottom: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/dither.test.ts
import { describe, it, expect } from "vitest";
import { ditherCells, ditherOn, ditherTile, ditherMask, ditherTrack, gradientDensity, DITHER } from "./dither";

describe("Bayer dither", () => {
  it("lights cells in threshold order", () => {
    expect(ditherCells(0)).toHaveLength(0);
    expect(ditherCells(0.28)).toHaveLength(4); // the sparse track
    expect(ditherCells(0.5)).toHaveLength(8);
    expect(ditherCells(0.9)).toHaveLength(14); // the dense value
    expect(ditherCells(1)).toHaveLength(16);
  });

  it("wraps rows and columns past the 4x4 matrix", () => {
    expect(ditherOn(0.5, 4, 4)).toBe(ditherOn(0.5, 0, 0));
  });

  it("encodes a 12px SVG tile with one 2px dot per lit cell", () => {
    const url = ditherTile(0.5, "#fff");
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(url.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain("width='12'");
    expect(svg.match(/<rect /g)).toHaveLength(8);
    expect(svg).toContain("width='2' height='2'");
  });

  it("builds mask and track styles at the 12px tile size", () => {
    expect(ditherMask().maskSize).toBe("12px 12px");
    expect(ditherMask().WebkitMaskImage).toBe(ditherTile(DITHER.value));
    expect(ditherTrack().backgroundImage).toBe(ditherTile(DITHER.track, DITHER.trackColor));
  });

  it("interpolates a gradient from top to bottom", () => {
    expect(gradientDensity(0, 11, 0.9, 0.2)).toBeCloseTo(0.9);
    expect(gradientDensity(10, 11, 0.9, 0.2)).toBeCloseTo(0.2);
    expect(gradientDensity(5, 11, 0.9, 0.2)).toBeCloseTo(0.55);
    expect(gradientDensity(0, 1, 0.9, 0.2)).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/dither.test.ts`
Expected: FAIL ("Failed to resolve import ./dither").

- [ ] **Step 3: Implement**

```ts
// src/lib/dither.ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/dither.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/dither.ts src/lib/dither.test.ts
git commit -m "dither: pure Bayer tile/mask/track helpers"
```

---

### Task 3: Dither primitives (`LevelBar`, `DitherPattern`, `GradientDitherPattern`) + `useWidth`

**Files:**
- Create: `src/components/dither.tsx`, `src/components/useWidth.ts`
- Test: `tests/dither-components.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`ditherMask`, `ditherTrack`, `ditherCells`, `ditherOn`, `gradientDensity`, `DITHER`).
- Produces:
  - `LevelBar(props: { value: number; max?: number; color: string; height?: number; label: string; className?: string })`: `role="meter"`, sparse track plus dense value.
  - `DitherPattern(props: { id: string; color: string; density?: number; kx?: number; ky?: number })`: an SVG `<pattern>`; `kx`/`ky` convert screen px to user units (1 for 1:1 SVGs).
  - `GradientDitherPattern(props: { id: string; color: string; rows: number; top: number; bottom: number; kx?: number; ky?: number })`
  - `useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/dither-components.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LevelBar, DitherPattern, GradientDitherPattern } from "../src/components/dither";

describe("LevelBar", () => {
  it("is an accessible meter with the value as a percentage width", () => {
    const html = renderToStaticMarkup(<LevelBar value={86} color="red" label="Stealth" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="86"');
    expect(html).toContain('aria-label="Stealth"');
    expect(html).toContain("width:86%");
    expect(html).toContain("mask-image:url(");
  });

  it("clamps to the track and honours max", () => {
    expect(renderToStaticMarkup(<LevelBar value={140} color="red" label="x" />)).toContain("width:100%");
    expect(renderToStaticMarkup(<LevelBar value={5} max={10} color="red" label="x" />)).toContain("width:50%");
  });
});

describe("SVG dither patterns", () => {
  it("draws one rect per lit cell, scaled to user units", () => {
    const html = renderToStaticMarkup(
      <svg>
        <DitherPattern id="p" color="red" density={0.5} kx={2} ky={1} />
      </svg>,
    );
    expect(html.match(/<rect /g)).toHaveLength(8);
    expect(html).toContain('width="24"'); // 12px tile × kx 2
  });

  it("thins a gradient from top to bottom", () => {
    const html = renderToStaticMarkup(
      <svg>
        <GradientDitherPattern id="g" color="red" rows={8} top={1} bottom={0} />
      </svg>,
    );
    const ys = [...html.matchAll(/y="(\d+)"/g)].map((m) => Number(m[1]));
    const top = ys.filter((y) => y < 12).length;
    const bottom = ys.filter((y) => y >= 12).length;
    expect(top).toBeGreaterThan(bottom);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/dither-components.test.tsx`
Expected: FAIL (cannot resolve `../src/components/dither`).

- [ ] **Step 3: Implement the primitives**

```tsx
// src/components/dither.tsx
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
```

```ts
// src/components/useWidth.ts
import { useEffect, useState, type RefObject } from "react";

/** The element's rendered width in px, kept current with a ResizeObserver. `fallback` is used for
 *  SSR/static export and until the first measurement. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.getBoundingClientRect().width) || fallback);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}
```

- [ ] **Step 4: Run it to verify it passes, then the gate**

Run: `npx vitest run tests/dither-components.test.tsx && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dither.tsx src/components/useWidth.ts tests/dither-components.test.tsx
git commit -m "dither: LevelBar, DitherPattern, GradientDitherPattern, useWidth"
```

---

### Task 4: Section, Panel, Collapse, Tag, TallyKey

**Files:**
- Modify: `src/components/ui.tsx:10-90` (Section), `:99-141` (Collapse), `:191-224` (Panel); append `Tag`, `TallyKey`
- Test: `tests/ui-primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Section` gains `num?: string` and `lead?: SectionLead`, where `export interface SectionLead { value: ReactNode; unit?: string; caption: string; color?: string }`. `subtitle` now renders as an info tip (screen-reader text plus a `title` tooltip), not visible prose.
  - `Tag(props: { color?: string; border?: string; className?: string; children: ReactNode })`
  - `TallyKey(props: { items: { label: string; count: number; color: string }[] })`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/ui-primitives.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Section, Tag, TallyKey } from "../src/components/ui";

describe("Section", () => {
  it("numbers the eyebrow and leads with one figure", () => {
    const html = renderToStaticMarkup(
      <Section title="Phase audit" num="02" lead={{ value: 3, unit: "/3", caption: "phases at full efficiency" }}>
        <p>body</p>
      </Section>,
    );
    expect(html).toMatch(/02<\/span>Phase audit/);
    expect(html).toContain(">3<");
    expect(html).toContain("/3");
    expect(html).toContain("phases at full efficiency");
  });

  it("keeps the subtitle for screen readers and as a tooltip, not as visible prose", () => {
    const html = renderToStaticMarkup(
      <Section title="Grade" subtitle="the explainable rubric">
        <p>x</p>
      </Section>,
    );
    expect(html).toContain('class="sr-only">the explainable rubric');
    expect(html).toContain('title="the explainable rubric"');
  });
});

describe("Tag and TallyKey", () => {
  it("renders a hairline mono tag in its colour", () => {
    const html = renderToStaticMarkup(<Tag color="var(--color-signal)">Clean</Tag>);
    expect(html).toContain("uppercase");
    expect(html).toContain("color:var(--color-signal)");
  });

  it("lists only non-zero counts", () => {
    const html = renderToStaticMarkup(
      <TallyKey items={[{ label: "Matched", count: 20, color: "a" }, { label: "Skipped", count: 0, color: "b" }]} />,
    );
    expect(html).toContain("Matched");
    expect(html).not.toContain("Skipped");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/ui-primitives.test.tsx`
Expected: FAIL (`Tag` is not exported; no `02</span>Phase audit`).

- [ ] **Step 3: Implement in `src/components/ui.tsx`**

Add near the top, after the imports:

```tsx
export interface SectionLead {
  value: ReactNode;
  unit?: string;
  caption: string;
  color?: string;
}

/** A section's single lead figure: one big number and a short caption, read before any detail. */
function Lead({ lead }: { lead: SectionLead }) {
  return (
    <div className="flex items-baseline gap-3 pb-3.5 pt-0.5">
      <span className="font-display text-[40px] font-bold leading-none tracking-[-0.035em] tabular-nums" style={{ color: lead.color ?? "var(--color-fg)" }}>
        {lead.value}
        {lead.unit && <small className="ml-0.5 text-[0.5em] font-semibold tracking-normal text-muted">{lead.unit}</small>}
      </span>
      <span className="text-[13px] leading-snug text-muted">{lead.caption}</span>
    </div>
  );
}

/** A subtitle demoted to help: an "i" with the text as tooltip + screen-reader text. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center">
      <span aria-hidden="true" title={text} className="cursor-help select-none rounded-full border border-edge-bright px-[5px] font-mono text-[10px] leading-4 text-faint">
        i
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
```

In `Section`, add `num` and `lead` to the destructured props and the prop type (`num?: string; lead?: SectionLead;`), then replace the three element builders:

```tsx
  const titleEl = title && (
    <h2 className={`label ${srTitle ? "sr-only" : ""}`}>
      {num && <span className="mr-3 text-signal">{num}</span>}
      {title}
    </h2>
  );
  const subEl = subtitle && <InfoTip text={subtitle} />;
  const rightEl = right && <div className="text-xs text-muted">{right}</div>;
```

In the non-collapsible return, render the lead between the header and the rule:

```tsx
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-4 pb-2">
          <div className="flex items-baseline gap-2.5">
            {titleEl}
            {subEl}
          </div>
          {rightEl}
        </header>
      )}
      {lead && <Lead lead={lead} />}
      <div className="h-px bg-edge" />
      <div className="pt-3">{children}</div>
```

and change the boxed class from `rounded border border-edge bg-panel px-4 py-3` to `rounded-md border border-edge px-4 py-3`.

In `Collapse`, replace the `<h2 …>{title}</h2>` and the subtitle span with:

```tsx
        <h2 className="label">{title}</h2>
        {subtitle && <InfoTip text={subtitle} />}
```

In `Panel`, change the section class to `relative rounded-lg border border-edge …` (drop `bg-panel`) and its `<h2>` class to `label`.

Append:

```tsx
/** A flat hairline tag: mono, uppercase, bordered in a tint of its own colour. Replaces tinted pills. */
export function Tag({ color = "var(--color-muted)", border, className = "", children }: { color?: string; border?: string; className?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border px-[7px] py-1 font-mono text-[10.5px] font-medium uppercase leading-none tracking-[0.1em] ${className}`}
      style={{ color, borderColor: border ?? `color-mix(in oklch, ${color} 40%, transparent)` }}
    >
      {children}
    </span>
  );
}

/** A tally legend: colour square, bold count, label. Zero counts are omitted. */
export function TallyKey({ items }: { items: { label: string; count: number; color: string }[] }) {
  return (
    <div className="label mt-2 flex flex-wrap gap-[18px]">
      {items
        .filter((i) => i.count > 0)
        .map((i) => (
          <span key={i.label} className="inline-flex items-center">
            <i aria-hidden="true" className="mr-[7px] inline-block h-2 w-2" style={{ background: i.color }} />
            <b className="mr-[5px] font-semibold text-fg">{i.count}</b>
            {i.label}
          </span>
        ))}
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes, then the gate**

Run: `npx vitest run tests/ui-primitives.test.tsx && npm test && npm run typecheck`
Expected: PASS. `tests/render.test.tsx` still finds "explainable rubric" (now in the sr-only span).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui.tsx tests/ui-primitives.test.tsx
git commit -m "ui: numbered Section with lead figure, subtitles as info tips, flat Panel, Tag, TallyKey"
```

---

### Task 5: Header (64px, tabs, Finish setup) and one setup entry point

**Files:**
- Modify: `src/App.tsx:36-50` (Tab), `:130-166` (header), `:173-176` (view switch), imports
- Modify: `src/store/report.ts:170` (`View`)
- Modify: `src/components/Install.tsx:35-43` (`Install` → `InstallReference`)
- Modify: `src/components/Onboarding.tsx:219-284` (StepCapture), imports
- Modify: `src/components/PwnboxSync.tsx:51-54,88`, `src/components/LlmStatusChip.tsx:138`
- Test: `tests/setup-entry.test.tsx`

**Interfaces:**
- Consumes: `ditherMask` (Task 2).
- Produces: `export function InstallReference()` in `Install.tsx`; `export function StepCapture()` in `Onboarding.tsx`; `View = "debrief" | "history" | "progress"`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/setup-entry.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { StepCapture } from "../src/components/Onboarding";

describe("setup has one entry point: the wizard", () => {
  it("has no Install tab", () => {
    expect(renderToStaticMarkup(<App />)).not.toMatch(/>Install</);
  });

  it("carries every Install-page section inside the wizard's capture step", () => {
    const html = renderToStaticMarkup(<StepCapture />);
    for (const s of ["All setup options", "On your own machine", "In Pwnbox", "live auto-pull", "Reference path", "AI-refined coaching"]) {
      expect(html).toContain(s);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/setup-entry.test.tsx`
Expected: FAIL (`StepCapture` is not exported; `>Install<` is present).

- [ ] **Step 3: Turn the Install page into a reference block**

In `src/components/Install.tsx`, replace lines 35–43 (the `Install` signature, the `max-w-3xl` wrapper and the intro block) so the component starts:

```tsx
/** The full setup reference (capture options, Pwnbox, reference path, AI). Lives inside the
 *  onboarding wizard's capture step: setup has one entry point. */
export function InstallReference() {
  return (
    <div>
      {/* CAPTURE — the two options are alternatives: you hack on your own VM, or in Pwnbox */}
```

Keep everything after that unchanged; the final closing `</div>` now closes this outer `<div>`.

- [ ] **Step 4: Put it in the wizard**

In `src/components/Onboarding.tsx`: add `import { InstallReference } from "./Install";`, add `ChevronDown` to the `./icons` import (or add `import { ChevronDown } from "./icons";`), change `function StepCapture()` to `export function StepCapture()`, and append this as the last child of StepCapture's outer `<div className="space-y-5">`:

```tsx
      <details className="group/all border-t border-edge pt-4">
        <summary className="label flex cursor-pointer list-none items-center gap-2 text-muted [&::-webkit-details-marker]:hidden">
          <ChevronDown size={12} className="transition-transform group-open/all:rotate-180" />
          All setup options
        </summary>
        <div className="mt-4">
          <InstallReference />
        </div>
      </details>
```

- [ ] **Step 5: Remove the Install view**

- `src/store/report.ts:170`: `type View = "debrief" | "history" | "progress";`
- `src/App.tsx`: delete the `Install` import, the `<Tab id="install" label="Install" />` line, and the `view === "install" ? (<Install />) :` branch so the switch starts at `view === "history"`. Change `Tab`'s `id` type to `"debrief" | "history" | "progress"`.
- `src/components/PwnboxSync.tsx:51-54`: take `openOnboarding` and `setOnboardingStep` from `useReport()` where `setView` is read today, and make `openSetup`:

```tsx
  const openSetup = () => {
    setOpen(false);
    setOnboardingStep(1);
    openOnboarding();
  };
```

Remove `setView` from that destructure if nothing else in the file uses it.

- [ ] **Step 6: Header height, tabs, buttons**

`src/App.tsx`, `Tab`:

```tsx
    <button
      type="button"
      onClick={() => setView(id)}
      className={`label -mb-px flex items-center border-b-2 px-0.5 text-xs tracking-[0.12em] transition-colors ${
        active ? "border-signal font-semibold text-fg" : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
```

Header rows (lines 132–140):

```tsx
          <div className="mx-auto flex min-h-16 max-w-6xl items-stretch justify-between gap-6 px-5">
            <div className="flex items-stretch gap-7">
              <div className="flex items-center gap-2">
```

(the existing logo/title children stay), and the nav:

```tsx
              <nav className="flex items-stretch gap-7">
```

Finish-setup button: import `ditherMask` from `./lib/dither`, then replace the button:

```tsx
                <button
                  type="button"
                  onClick={() => { setOnboardingStep(1); openOnboarding(); }}
                  className="group inline-flex items-center gap-2 rounded-[3px] border border-signal/45 px-3 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-signal transition-colors hover:border-signal hover:bg-signal/5"
                  title="Finish setup — capture your first run"
                >
                  <span aria-hidden="true" className="setup-lamp inline-block h-2 w-2 bg-signal" style={ditherMask()} />
                  Finish setup
                  <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
```

Delete the now-unused `ArrowUpRight` import only if nothing else in `App.tsx` uses it.

`PwnboxSync.tsx:88` and `LlmStatusChip.tsx:138`: change the chip button's `rounded-full` to `rounded-md` (leave the `h-2 w-2 rounded-full` status dots alone).

- [ ] **Step 7: Run it to verify it passes, then the gate**

Run: `npx vitest run tests/setup-entry.test.tsx && npm test && npm run typecheck`
Expected: PASS. (`tests/capture-docs.test.ts` still reads `src/components/Install.tsx`; the capture command text is unchanged.)

- [ ] **Step 8: Look at it**

`npm run dev`: 64px header; DEBRIEF bright/semibold with a mint bar sitting on the header's bottom rule; no Install tab; Finish setup has a pulsing dithered lamp; Pwnbox's setup link opens the wizard on the capture step, which ends with "All setup options".

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/store/report.ts src/components/Install.tsx src/components/Onboarding.tsx src/components/PwnboxSync.tsx src/components/LlmStatusChip.tsx tests/setup-entry.test.tsx
git commit -m "header: 64px bar, clearer tabs, dithered Finish-setup lamp; setup lives only in the wizard"
```

---

### Task 6: Identity metadata line and score tiles

**Files:**
- Modify: `src/components/IdentityBar.tsx:9-33` (Pill), `:41-58` (ScoreReadout), `:61-71` (AttributePills), `:99-101`, `:126-137`
- Test: `tests/identity.test.tsx`

**Interfaces:**
- Consumes: `LevelBar` (Task 3), `ditherMask`/`ditherTrack` (Task 2).
- Produces: `export function DifficultyPips({ label, color }: { label: string; color: string })`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/identity.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { DifficultyPips } from "../src/components/IdentityBar";

describe("identity metadata", () => {
  it("lights one pip per difficulty level", () => {
    expect(renderToStaticMarkup(<DifficultyPips label="Easy" color="c" />).match(/data-on="true"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<DifficultyPips label="Hard" color="c" />).match(/data-on="true"/g)).toHaveLength(3);
    expect(renderToStaticMarkup(<DifficultyPips label="Insane" color="c" />).match(/data-on="true"/g)).toHaveLength(4);
  });

  it("gives both score tiles a level meter", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('aria-label="Stealth');
    expect(html).toContain('aria-label="Grade');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/identity.test.tsx`
Expected: FAIL (`DifficultyPips` is not exported).

- [ ] **Step 3: Implement**

Add imports: `import { LevelBar } from "./dither";` and `import { ditherMask, ditherTrack } from "../lib/dither";`.

Replace `Pill` and `AttributePills` with:

```tsx
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
```

Replace `<AttributePills target={target} retired={retired} />` with `<MetaLine target={target} retired={retired} />`.

`ScoreReadout`: add `level: number` to the props and replace the component body:

```tsx
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
```

Pass `level={metrics.stealth_score}` to the Stealth readout and `level={grade.score}` to the Grade readout.

- [ ] **Step 4: Run it to verify it passes, then the gate**

Run: `npx vitest run tests/identity.test.tsx && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/IdentityBar.tsx tests/identity.test.tsx
git commit -m "identity: metadata line with dithered difficulty pips; score tiles carry a level bar"
```

---

### Task 7: Grade section and section numbering

**Files:**
- Modify: `src/components/Assessment.tsx:62-68` (signature/live), `:93-97` (Section), `:189-191` (bar)
- Modify: `src/App.tsx:196-228` (pass `num` to the four sections)
- Test: `tests/debrief-sections.test.tsx`

**Interfaces:**
- Consumes: `Section` `num`/`lead` (Task 4), `LevelBar` (Task 3).
- Produces: `Assessment({ num }: { num?: string })`. App numbering: path `01`, audit `02`, ghost `03` (when present), grade next.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/debrief-sections.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";

describe("debrief sections", () => {
  const html = renderToStaticMarkup(<App />);

  it("leads the grade with its letter and score", () => {
    expect(html).toMatch(/weighted across \d rubric metrics/);
  });

  it("draws every rubric metric as a level meter", () => {
    expect((html.match(/role="meter"/g) ?? []).length).toBeGreaterThanOrEqual(8); // 6+ metrics + 2 score tiles
  });

  it("numbers the sections in reading order", () => {
    const i01 = html.indexOf(">01<");
    const i02 = html.indexOf(">02<");
    expect(i01).toBeGreaterThan(-1);
    expect(i02).toBeGreaterThan(i01);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/debrief-sections.test.tsx`
Expected: FAIL (no "weighted across").

- [ ] **Step 3: Implement**

`Assessment.tsx`: import `LevelBar` from `./dither`; change the signature to `export function Assessment({ num }: { num?: string } = {})`; pass `num={num}` to both `<Section dataShot="grade" …>` elements; on the finished-grade Section add:

```tsx
      num={num}
      lead={{ value: grade.letter, unit: ` · ${grade.score.toFixed(1)}`, caption: `weighted across ${n} rubric metrics`, color: gc }}
```

Replace the bar (lines 189–191):

```tsx
                  <div className="min-w-0">
                    <LevelBar value={c.raw} color={barColor} height={8} label={RUBRIC_LABELS[k]} />
                  </div>
```

The radar keeps its solid fill (no change).

`App.tsx`, before the `return` in `App()`:

```tsx
  const hasGhost = !!report.ghost?.items?.length;
  const num = { path: "01", audit: "02", ghost: "03", grade: hasGhost ? "04" : "03" };
```

and pass `num={num.path}` to `<PathComparison />`, `num={num.audit}` to `<PhaseAudit hideTakeaway />`, `num={num.grade}` to `<Assessment />`. `PathComparison` and `PhaseAudit` accept `num` from Tasks 8 and 9; until then add the optional prop to their signatures now (`{ num }: { num?: string } = {}`) and forward it to their `Section`.

- [ ] **Step 4: Run it to verify it passes, then the gate**

Run: `npx vitest run tests/debrief-sections.test.tsx && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Assessment.tsx src/components/PathComparison.tsx src/components/PhaseAudit.tsx src/App.tsx tests/debrief-sections.test.tsx
git commit -m "grade: 8px dithered metric bars and a letter-led section; number the debrief sections"
```

---

### Task 8: Phase audit (levels, stat cells, tags)

**Files:**
- Create: `src/lib/phase-stats.ts`
- Test: `src/lib/phase-stats.test.ts`
- Modify: `src/components/PhaseAudit.tsx` (delete `ScoreRing` 22–47; `PhaseCard` 199–230; `GeneralCard` 308–330; `PhaseAudit` 341–372)

**Interfaces:**
- Consumes: `Tag` (Task 4), `LevelBar` (Task 3), `tierColor`, `fmtDuration`.
- Produces:
  - `phaseStats(p: Pick<PhaseAudit, "coverage" | "wasted_ms">): { objectives: { reached: number; total: number } | null; lost: string; lostIsZero: boolean }`
  - `phaseLead(phases: Pick<PhaseAudit, "efficiency">[]): { full: number; total: number }`
  - `WASTE_FLOOR_MS = 30_000` (the same threshold `summaryLine` uses)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/phase-stats.test.ts
import { describe, it, expect } from "vitest";
import { phaseStats, phaseLead } from "./phase-stats";
import { fmtDuration } from "./format";

const cov = (satisfied: number, total: number) => ({ satisfied, total, pct: total ? (satisfied / total) * 100 : 0 });

describe("phaseStats", () => {
  it("reports objectives reached and zero loss under the waste floor", () => {
    expect(phaseStats({ coverage: cov(9, 10), wasted_ms: 12_000 })).toEqual({ objectives: { reached: 9, total: 10 }, lost: "0m", lostIsZero: true });
  });

  it("formats real loss and omits objectives when there is no reference", () => {
    const s = phaseStats({ coverage: cov(0, 0), wasted_ms: 95_000 });
    expect(s.objectives).toBeNull();
    expect(s.lost).toBe(fmtDuration(95_000));
    expect(s.lostIsZero).toBe(false);
  });
});

describe("phaseLead", () => {
  it("counts phases at full efficiency", () => {
    expect(phaseLead([{ efficiency: 100 }, { efficiency: 100 }, { efficiency: 72 }])).toEqual({ full: 2, total: 3 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/phase-stats.test.ts`
Expected: FAIL (cannot resolve `./phase-stats`).

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/phase-stats.ts
import type { PhaseAudit } from "./audits";
import { fmtDuration } from "./format";

/** Below this, time lost is noise: the same floor `summaryLine` uses for "no time wasted". */
export const WASTE_FLOOR_MS = 30_000;

export interface PhaseStats {
  objectives: { reached: number; total: number } | null;
  lost: string;
  lostIsZero: boolean;
}

/** A phase's summary sentence as two figures: objectives reached, and time lost. */
export function phaseStats(p: Pick<PhaseAudit, "coverage" | "wasted_ms">): PhaseStats {
  const zero = p.wasted_ms < WASTE_FLOOR_MS;
  return {
    objectives: p.coverage.total > 0 ? { reached: p.coverage.satisfied, total: p.coverage.total } : null,
    lost: zero ? "0m" : fmtDuration(p.wasted_ms),
    lostIsZero: zero,
  };
}

export function phaseLead(phases: Pick<PhaseAudit, "efficiency">[]): { full: number; total: number } {
  return { full: phases.filter((p) => p.efficiency >= 100).length, total: phases.length };
}
```

Run: `npx vitest run src/lib/phase-stats.test.ts`. Expected: PASS.

- [ ] **Step 4: Rebuild the phase rows in `PhaseAudit.tsx`**

Imports: add `Tag` to the `./ui` import; `import { LevelBar } from "./dither";`; `import { phaseStats, phaseLead } from "../lib/phase-stats";`.

Delete `ScoreRing` and add:

```tsx
/** The phase's efficiency: a big number over a dithered level bar ("—" when the phase has no score). */
function PhaseLevel({ value }: { value: number | null }) {
  const col = value == null ? "var(--color-faint)" : tierColor(value);
  return (
    <div className="flex h-14 w-14 shrink-0 flex-col justify-center gap-[5px]">
      <span className="font-display text-[22px] font-bold leading-none tracking-[-0.03em] tabular-nums" style={{ color: col }}>
        {value ?? "—"}
      </span>
      <LevelBar value={value ?? 0} color={col} height={6} label={value == null ? "no phase score" : `efficiency ${value} of 100`} />
    </div>
  );
}

function Stat({ label, tone, children }: { label: string; tone?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-16 flex-col items-end gap-[5px]">
      <span className="label text-[10px]">{label}</span>
      <b className="font-display text-lg font-bold leading-none tracking-[-0.02em] tabular-nums" style={{ color: tone ?? "var(--color-fg)" }}>
        {children}
      </b>
    </div>
  );
}

function StatCells({ p }: { p: PhaseAuditT }) {
  const s = phaseStats(p);
  return (
    <div className="mr-2 hidden items-start gap-7 sm:flex">
      {s.objectives && (
        <Stat label="Objectives">
          {s.objectives.reached}
          <small className="text-[0.72em] font-semibold text-muted">/{s.objectives.total}</small>
        </Stat>
      )}
      <Stat label="Time lost" tone={s.lostIsZero ? "var(--color-muted)" : "var(--color-loud)"}>
        {s.lost}
      </Stat>
    </div>
  );
}
```

(add `type ReactNode` to the React import).

In `PhaseCard`: change `<details className="rise rounded-lg border border-edge bg-panel">` to `<details className="rise rounded-lg border border-edge">`, give the `<summary>` a `title={line}`, and replace its first three children:

```tsx
        <PhaseLevel value={p.efficiency} />
        <div className="flex min-w-0 flex-1 items-center justify-between gap-6">
          <span className="font-display text-sm font-semibold text-fg">{p.label}</span>
          <StatCells p={p} />
        </div>
        <div className="flex min-w-[140px] shrink-0 items-center justify-end gap-2.5">
          {clean ? (
            <Tag color="var(--color-signal)">
              <Check size={11} /> Clean
            </Tag>
          ) : p.insights.length > 0 ? (
            <Tag color="var(--color-muted)" border="var(--color-edge-bright)">
              <span className="text-fg">{p.insights.length}</span> to improve
            </Tag>
          ) : missed > 0 ? (
            <Tag color="var(--color-skipped)">{missed} missed</Tag>
          ) : (
            <Tag color="var(--color-muted)" border="var(--color-edge-bright)">
              <span className="text-fg">{p.manual.length}</span> to check
            </Tag>
          )}
          <ChevronDown className="text-faint transition-transform [details[open]_&]:rotate-180" />
        </div>
```

In `GeneralCard`, replace lines 310–323 (the `<details>` opening tag through `</summary>`) with:

```tsx
    <details className="rise rounded-lg border border-edge">
      <summary className="flex cursor-pointer list-none items-center gap-3.5 px-4 py-3" title="Cross-cutting: not tied to a single phase">
        <PhaseLevel value={null} />
        <div className="flex min-w-0 flex-1 items-center justify-between gap-6">
          <span className="font-display text-sm font-semibold text-fg">General</span>
          <span className="label mr-2">Cross-cutting</span>
        </div>
        <div className="flex min-w-[140px] shrink-0 items-center justify-end gap-2.5">
          <Tag color="var(--color-muted)" border="var(--color-edge-bright)">
            <span className="text-fg">{items.length}</span> to improve
          </Tag>
          <ChevronDown className="text-faint transition-transform [details[open]_&]:rotate-180" />
        </div>
      </summary>
```

The body (`<div className="border-t border-edge px-4 py-3">` onward) stays unchanged.

In `PhaseAudit`: change the signature to `({ hideTakeaway = false, num }: { hideTakeaway?: boolean; num?: string } = {})`, compute `const pl = phaseLead(phases);`, and on the Section add:

```tsx
      num={num}
      lead={pl.total ? { value: pl.full, unit: `/${pl.total}`, caption: "phases at full efficiency" } : undefined}
```

- [ ] **Step 5: Gate**

Run: `npm test && npm run typecheck`
Expected: PASS (render test still finds "Phase audit").

- [ ] **Step 6: Look at it**

`npm run dev`: each row reads `[100 over a bar]  Discovery  ……  OBJECTIVES 9/10  TIME LOST 0m  [1 TO IMPROVE]`; Execution shows the mint `✓ CLEAN`; stat columns line up across rows; General shows `—` over an empty track and `CROSS-CUTTING`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/phase-stats.ts src/lib/phase-stats.test.ts src/components/PhaseAudit.tsx
git commit -m "phase audit: level bars replace rings; summary sentence becomes stat cells; flat tags"
```

---

### Task 9: 01, What you'd do differently (route bar, change list, collapsible map)

**Files:**
- Create: `src/lib/route.ts`
- Test: `src/lib/route.test.ts`
- Modify: `src/components/PathComparison.tsx` (remove `Count`, `statusOf`; replace the summary box and the graph block)

**Interfaces:**
- Consumes: `Tag`, `TallyKey` (Task 4), `ditherMask`, `ditherTrack` (Task 2), `humanizeObjective` (`lib/audits`).
- Produces:
  - `type RouteStatus = "match" | "alternative" | "out_of_order" | "skipped"`
  - `interface RouteStep { objective: string; status: RouteStatus; seq: number | null; suggestion: string | null; binary: string | null }`
  - `routeSteps(golden: GoldenObjective[], episodes: Episode[]): RouteStep[]`
  - `routeCounts(steps: RouteStep[]): Record<RouteStatus, number>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/route.test.ts
import { describe, it, expect } from "vitest";
import { routeSteps, routeCounts } from "./route";
import type { Episode, GoldenObjective } from "../types/report";

const obj = (objective: string, seq: number | null, satisfied_by = ["tool"]): GoldenObjective =>
  ({ objective, tactic: "TA0007", satisfied_by, user_satisfied_by_seq: seq }) as GoldenObjective;
const ep = (seq: number, alignment?: string, binary = "nmap") => ({ seq, alignment, binary }) as unknown as Episode;

describe("routeSteps", () => {
  const steps = routeSteps(
    [obj("enumerate_services", 1), obj("audit_share_permissions", null, ["smbmap"]), obj("get_foothold", 3), obj("read_config", 2)],
    [ep(1, "match"), ep(2, "out_of_order"), ep(3, "alternative", "nc")],
  );

  it("keeps the write-up's order and classifies each objective", () => {
    expect(steps.map((s) => s.status)).toEqual(["match", "skipped", "alternative", "out_of_order"]);
  });

  it("carries the fix: the suggested tool for a skip, the binary used for an alternative", () => {
    expect(steps[1]).toMatchObject({ seq: null, suggestion: "smbmap" });
    expect(steps[2]).toMatchObject({ seq: 3, binary: "nc" });
  });

  it("treats an unaligned or detour step as matched (same as the old statusOf)", () => {
    expect(routeSteps([obj("x", 7)], [ep(7, "detour")])[0].status).toBe("match");
    expect(routeSteps([obj("x", 7)], [ep(7, undefined)])[0].status).toBe("match");
  });

  it("counts statuses", () => {
    expect(routeCounts(steps)).toEqual({ match: 1, alternative: 1, out_of_order: 1, skipped: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/route.test.ts`
Expected: FAIL (cannot resolve `./route`).

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/route.ts
import type { Episode, GoldenObjective } from "../types/report";

export type RouteStatus = "match" | "alternative" | "out_of_order" | "skipped";

export interface RouteStep {
  objective: string;
  status: RouteStatus;
  /** the step that satisfied it, or null when skipped */
  seq: number | null;
  /** the write-up's first tool for it: the "try …" fix for a skip */
  suggestion: string | null;
  /** the binary you actually used (for an alternative method) */
  binary: string | null;
}

/** The write-up's objectives in intended order, each classified against your run. */
export function routeSteps(golden: GoldenObjective[], episodes: Episode[]): RouteStep[] {
  const bySeq = new Map(episodes.map((e) => [e.seq, e]));
  return golden.map((o) => {
    const seq = o.user_satisfied_by_seq ?? null;
    const e = seq == null ? undefined : bySeq.get(seq);
    const a = e?.alignment;
    const status: RouteStatus = seq == null ? "skipped" : a === "alternative" || a === "out_of_order" ? a : "match";
    return { objective: o.objective, status, seq, suggestion: o.satisfied_by[0] ?? null, binary: e?.binary ?? null };
  });
}

export function routeCounts(steps: RouteStep[]): Record<RouteStatus, number> {
  const out: Record<RouteStatus, number> = { match: 0, alternative: 0, out_of_order: 0, skipped: 0 };
  for (const s of steps) out[s.status]++;
  return out;
}
```

Run: `npx vitest run src/lib/route.test.ts`. Expected: PASS.

- [ ] **Step 4: Rebuild the section in `PathComparison.tsx`**

Imports: `import { useState, type ReactNode } from "react";`, `Tag`, `TallyKey` from `./ui`, `import { ditherMask, ditherTrack } from "../lib/dither";`, `import { routeSteps, routeCounts, type RouteStep, type RouteStatus } from "../lib/route";`. Delete `Count` and `statusOf`.

Add:

```tsx
const ROUTE: Record<RouteStatus, { color: string; label: string }> = {
  match: { color: "var(--color-match)", label: "Matched" },
  alternative: { color: "var(--color-alt)", label: "Alt method" },
  out_of_order: { color: "var(--color-stuck)", label: "Out of order" },
  skipped: { color: "var(--color-skipped)", label: "Skipped" },
};
const ROUTE_ORDER: RouteStatus[] = ["match", "alternative", "out_of_order", "skipped"];

/** The intended path as one row of cells: where your route differed, at a glance. */
function RouteBar({ steps }: { steps: RouteStep[] }) {
  const counts = routeCounts(steps);
  return (
    <div>
      <div className="grid h-[22px] gap-[3px]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <span
            key={s.objective}
            title={`${humanizeObjective(s.objective)} · ${ROUTE[s.status].label}${s.seq != null ? ` · step ${s.seq}` : ""}`}
            style={s.status === "skipped" ? { ...ditherTrack(0.3), border: "1px dashed var(--color-skipped)" } : { background: ROUTE[s.status].color, ...ditherMask() }}
          />
        ))}
      </div>
      <div className="label mt-[7px] flex justify-between">
        <span>Write-up step 1</span>
        <span>Step {steps.length}</span>
      </div>
      <TallyKey items={ROUTE_ORDER.map((k) => ({ label: ROUTE[k].label, count: counts[k], color: ROUTE[k].color }))} />
    </div>
  );
}

function fixText(s: RouteStep): ReactNode {
  if (s.status === "skipped")
    return s.suggestion ? (
      <>
        Never attempted · try <code className="mono ml-1 text-signal">{s.suggestion}</code>
      </>
    ) : (
      "Never attempted"
    );
  if (s.status === "out_of_order") return `Done at step ${s.seq}, earlier than the write-up's order`;
  return (
    <>
      Done at step {s.seq} with <code className="mono ml-1 text-signal">{s.binary ?? "another tool"}</code>
    </>
  );
}

/** Only the deviations, one ruled row each: the section's actual answer. */
function ChangeList({ steps }: { steps: RouteStep[] }) {
  const dev = steps.filter((s) => s.status !== "match");
  return (
    <div>
      <div className="label mb-2.5">Change next time</div>
      {dev.length === 0 ? (
        <p className="border-y border-edge py-3 text-[15px] font-semibold text-signal">You followed the intended path. Nothing to change.</p>
      ) : (
        <ul className="border-b border-edge">
          {dev.map((s) => (
            <li key={s.objective} className="grid grid-cols-[110px_minmax(0,1fr)_auto] items-center gap-4 border-t border-edge py-3">
              <span className="justify-self-start">
                <Tag color={ROUTE[s.status].color}>{ROUTE[s.status].label}</Tag>
              </span>
              <span className="text-[15px] font-semibold text-fg">{humanizeObjective(s.objective)}</span>
              <span className="text-[13px] text-muted">{fixText(s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

In `PathComparison`: `export function PathComparison({ num }: { num?: string } = {})`; add `const [mapOpen, setMapOpen] = useState(false);` and `const steps = routeSteps(golden, report.episodes);`; delete `epBySeq`, `skipped`, `outOfOrder`, `alt`, `deviations`, `matched`. On the Section add `num={num}` and `lead={golden.length && !recording ? { value: coverage, unit: "%", caption: "of the write-up's path followed" } : undefined}`. Replace the entire final `<>…</>` branch (the summary box, `<PathGraph />` and its legend) with:

```tsx
        <div className="flex flex-col gap-[22px]">
          <RouteBar steps={steps} />
          <ChangeList steps={steps} />
          <button
            type="button"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((o) => !o)}
            className="flex h-11 w-full items-center justify-center rounded-[3px] border border-edge-bright font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-muted hover:bg-panel hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {mapOpen ? "Hide path map ↑" : "Show full path map ↓"}
          </button>
          {mapOpen && (
            <div>
              <PathGraph />
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                {LEGEND.map(([icon, label, c]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span style={{ color: c }}>{icon}</span>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
```

Remove the `Section` `subtitle` (the route bar makes it redundant), or keep it; either way it renders as an info tip.

- [ ] **Step 5: Gate**

Run: `npm test && npm run typecheck`
Expected: PASS. `render.test.tsx`'s "never attempted" is now satisfied by the change list.

- [ ] **Step 6: Look at it**

`npm run dev`: `01 WHAT YOU'D DO DIFFERENTLY` → `95%` → a 21-cell route bar with a dashed gap → `20 MATCHED · 1 SKIPPED` → `SKIPPED · Audit share permissions · Never attempted · try smbmap` → a full-width 44px "SHOW FULL PATH MAP ↓" that opens the map at full size.

- [ ] **Step 7: Commit**

```bash
git add src/lib/route.ts src/lib/route.test.ts src/components/PathComparison.tsx
git commit -m "path: route bar + change list lead the section; node map collapses behind a full-width toggle"
```

---

### Task 10: 03, You vs. the Ghost (headline, tally, pivot strip)

**Files:**
- Create: `src/lib/ghost/headline.ts`, `src/components/PivotStrip.tsx`
- Test: `src/lib/ghost/headline.test.ts`, `tests/pivot-strip.test.tsx`
- Modify: `src/components/GhostCard.tsx:55-117`, `src/App.tsx:216-222`

**Interfaces:**
- Consumes: `DitherPattern` (Task 3), `useWidth` (Task 3), `Tag`, `TallyKey` (Task 4), `ditherMask` (Task 2), `humanizeObjective`.
- Produces:
  - `type GhostHeadline = { kind: "pivots"; count: number; total: number; unlockSeq: number; lastSeq: number } | { kind: "clean"; total: number }`
  - `ghostHeadline(items: GhostItem[]): GhostHeadline` (largest late-pivot group by `unlock_seq`, earliest on ties)
  - `verdictCounts(items: GhostItem[]): Record<GhostVerdict, number>`
  - `ghostDetail(it: GhostItem): string`
  - `VERDICT: Record<GhostVerdict, { color: string; label: string }>`, `VERDICT_ORDER: GhostVerdict[]`
  - `PivotStrip(props: { items: GhostItem[]; total: number; notes: Map<string, string>; onReveal: (seq: number) => void })`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/ghost/headline.test.ts
import { describe, it, expect } from "vitest";
import { ghostHeadline, verdictCounts, ghostDetail } from "./headline";
import type { GhostItem } from "../../types/report";

const late = (objective: string, unlock_seq: number, actual_seq: number, lag_ms = 0): GhostItem => ({ objective, verdict: "late_pivot", unlock_seq, actual_seq, lag_ms });

describe("ghostHeadline", () => {
  it("names the largest group of late pivots and where it ended", () => {
    const items: GhostItem[] = [
      { objective: "a", verdict: "ahead", unlock_seq: 1, actual_seq: 1 },
      late("b", 1, 5),
      late("c", 5, 11),
      late("d", 5, 13),
      late("e", 5, 30),
      { objective: "f", verdict: "skipped", unlock_seq: 1, actual_seq: null },
    ];
    expect(ghostHeadline(items)).toEqual({ kind: "pivots", count: 3, total: 6, unlockSeq: 5, lastSeq: 30 });
  });

  it("breaks ties toward the earliest unlock", () => {
    expect(ghostHeadline([late("x", 9, 12), late("y", 4, 6)])).toMatchObject({ unlockSeq: 4, lastSeq: 6 });
  });

  it("reports a clean run when nothing pivoted late", () => {
    expect(ghostHeadline([{ objective: "a", verdict: "on_time", unlock_seq: 1, actual_seq: 2 }])).toEqual({ kind: "clean", total: 1 });
  });
});

describe("verdictCounts / ghostDetail", () => {
  it("counts every verdict", () => {
    expect(verdictCounts([late("b", 1, 5), late("c", 5, 11)]).late_pivot).toBe(2);
  });

  it("describes each verdict in one plain line", () => {
    expect(ghostDetail(late("b", 5, 20, 540_000))).toBe("Open from step 5, done at step 20 · 9 min later");
    expect(ghostDetail({ objective: "f", verdict: "skipped", unlock_seq: 1, actual_seq: null })).toBe("Open from step 1, never attempted");
    expect(ghostDetail({ objective: "o", verdict: "on_time", unlock_seq: 3, actual_seq: 4 })).toBe("Done at step 4, as soon as it opened");
  });
});
```

```tsx
// tests/pivot-strip.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PivotStrip } from "../src/components/PivotStrip";
import type { GhostItem } from "../src/types/report";

const items: GhostItem[] = [
  { objective: "enumerate_services", verdict: "ahead", unlock_seq: 1, actual_seq: 1 },
  { objective: "read_rclone_config", verdict: "late_pivot", unlock_seq: 5, actual_seq: 15, lag_ms: 60_000 },
  { objective: "audit_share_permissions", verdict: "skipped", unlock_seq: 1, actual_seq: null },
];

describe("PivotStrip", () => {
  const html = renderToStaticMarkup(<PivotStrip items={items} total={30} notes={new Map()} onReveal={() => {}} />);

  it("draws one focusable row per objective with a readable label", () => {
    expect(html.match(/role="listitem"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html).toContain("Read rclone config");
  });

  it("fills late-pivot and skipped spans with dither patterns", () => {
    expect(html).toMatch(/fill="url\(#[^)]*late\)"/);
    expect(html).toMatch(/fill="url\(#[^)]*skip\)"/);
  });

  it("puts each row's explanation in its accessible name", () => {
    expect(html).toContain("Late pivot. Open from step 5, done at step 15 · 1 min later");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/ghost/headline.test.ts tests/pivot-strip.test.tsx`
Expected: FAIL (cannot resolve `./headline`, `../src/components/PivotStrip`).

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/ghost/headline.ts
import type { GhostItem, GhostVerdict } from "../../types/report";

export type GhostHeadline = { kind: "pivots"; count: number; total: number; unlockSeq: number; lastSeq: number } | { kind: "clean"; total: number };

export const VERDICT_ORDER: GhostVerdict[] = ["ahead", "off_path_win", "on_time", "late_pivot", "skipped"];

export const VERDICT: Record<GhostVerdict, { color: string; label: string }> = {
  ahead: { color: "var(--color-signal)", label: "Ahead" },
  off_path_win: { color: "var(--color-alt)", label: "Off-path win" },
  on_time: { color: "var(--color-muted)", label: "On time" },
  late_pivot: { color: "var(--color-loud)", label: "Late pivot" },
  skipped: { color: "var(--color-skipped)", label: "Skipped" },
};

/** The pattern, not one sentence per row: the largest group of late pivots sharing an unlock step. */
export function ghostHeadline(items: GhostItem[]): GhostHeadline {
  const late = items.filter((i) => i.verdict === "late_pivot" && i.unlock_seq != null);
  if (!late.length) return { kind: "clean", total: items.length };
  const groups = new Map<number, number>();
  for (const i of late) groups.set(i.unlock_seq!, (groups.get(i.unlock_seq!) ?? 0) + 1);
  let unlockSeq = -1;
  let count = 0;
  for (const [seq, n] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (n > count) {
      unlockSeq = seq;
      count = n;
    }
  }
  const lastSeq = Math.max(...late.filter((i) => i.unlock_seq === unlockSeq).map((i) => i.actual_seq ?? 0));
  return { kind: "pivots", count, total: items.length, unlockSeq, lastSeq };
}

export function verdictCounts(items: GhostItem[]): Record<GhostVerdict, number> {
  const out: Record<GhostVerdict, number> = { ahead: 0, off_path_win: 0, on_time: 0, late_pivot: 0, skipped: 0 };
  for (const i of items) out[i.verdict]++;
  return out;
}

/** One plain line per objective, shown on hover/focus (a model narration replaces it when present). */
export function ghostDetail(it: GhostItem): string {
  switch (it.verdict) {
    case "late_pivot":
      return `Open from step ${it.unlock_seq}, done at step ${it.actual_seq}${it.lag_ms ? ` · ${Math.round(it.lag_ms / 60000)} min later` : ""}`;
    case "skipped":
      return `Open from step ${it.unlock_seq ?? "?"}, never attempted`;
    case "on_time":
      return `Done at step ${it.actual_seq}, as soon as it opened`;
    default:
      return `Done at step ${it.actual_seq}, before the optimal line expected it`;
  }
}
```

- [ ] **Step 4: Implement `PivotStrip`**

```tsx
// src/components/PivotStrip.tsx
import { useId, useMemo, useRef, useState } from "react";
import type { GhostItem } from "../types/report";
import { humanizeObjective } from "../lib/audits";
import { VERDICT, ghostDetail } from "../lib/ghost/headline";
import { DitherPattern } from "./dither";
import { Tag } from "./ui";
import { useWidth } from "./useWidth";

const RH = 26; // row height: room for the staircase to read
const LBL = 200; // label column
const TOP = 24; // step axis
const TIP_W = 300;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * You vs. the Ghost as one picture: a row per objective on a step axis. A late pivot is a ring where
 * it unlocked, a coral dithered span, and a tick where you acted, so a run of them reads as a
 * staircase. Drawn 1:1 in px (no viewBox scaling) so the dither dots stay 2px.
 */
export function PivotStrip({ items, total, notes, onReveal }: { items: GhostItem[]; total: number; notes: Map<string, string>; onReveal: (seq: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref, 720);
  const uid = useId().replace(/:/g, "");
  const [hot, setHot] = useState<number | null>(null);
  const rows = useMemo(() => [...items].sort((a, b) => (a.actual_seq ?? 1e9) - (b.actual_seq ?? 1e9) || (a.unlock_seq ?? 0) - (b.unlock_seq ?? 0)), [items]);
  const span = Math.max(1, total);
  const x = (s: number) => LBL + ((s - 0.5) / span) * (W - LBL - 10);
  const H = TOP + rows.length * RH + 4;
  const ticks = Array.from({ length: span }, (_, i) => i + 1).filter((t) => t === 1 || t % 5 === 0);
  const lateId = `${uid}-late`;
  const skipId = `${uid}-skip`;

  const it = hot == null ? null : rows[hot];
  let tip: { left: number; top: number } | null = null;
  if (it && hot != null) {
    const end = it.actual_seq != null ? x(it.actual_seq) : x(span);
    const fits = end + 14 + TIP_W <= W;
    tip = { left: fits ? end + 14 : Math.max(LBL, end - 14 - TIP_W), top: TOP + hot * RH + RH / 2 };
  }

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" role="list" aria-label="Objectives against the optimal line">
        <defs>
          <DitherPattern id={lateId} color="var(--color-loud)" />
          <DitherPattern id={skipId} color="var(--color-skipped)" density={0.3} />
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP - 6} y2={H} stroke="var(--color-edge)" />
            <text x={x(t)} y={TOP - 10} textAnchor="middle" fontSize={10.5} fill="var(--color-faint)" className="mono">
              {t}
            </text>
          </g>
        ))}
        <text x={0} y={TOP - 10} fontSize={10.5} letterSpacing="0.12em" fill="var(--color-faint)" className="mono">
          OBJECTIVE · STEP →
        </text>
        {rows.map((r, i) => {
          const y = TOP + i * RH;
          const cy = y + RH / 2;
          const v = VERDICT[r.verdict];
          const on = hot === i;
          const can = r.actual_seq != null;
          return (
            <g
              key={r.objective}
              role="listitem"
              tabIndex={0}
              aria-label={`${humanizeObjective(r.objective)}: ${v.label}. ${ghostDetail(r)}`}
              className={`outline-none ${can ? "cursor-pointer" : ""}`}
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => setHot(i)}
              onBlur={() => setHot(null)}
              onClick={() => can && onReveal(r.actual_seq!)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && can) onReveal(r.actual_seq!);
              }}
            >
              <rect x={-10} y={y + 1} width={W + 10} height={RH - 2} fill={on ? "var(--color-panel-2)" : "transparent"} />
              {on && <rect x={-10} y={y + 1} width={2} height={RH - 2} fill={v.color} />}
              <text x={0} y={cy + 4} fontSize={13} fill={r.verdict === "late_pivot" ? "var(--color-fg)" : "var(--color-muted)"}>
                {truncate(humanizeObjective(r.objective), 26)}
              </text>
              <Marks r={r} cy={cy} x={x} end={span} lateFill={`url(#${lateId})`} skipFill={`url(#${skipId})`} />
            </g>
          );
        })}
      </svg>
      {it && tip && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-[300px] -translate-y-1/2 rounded-[3px] border border-edge-bright bg-panel-2 px-[13px] py-[11px] shadow-[0_10px_30px_rgba(0,0,0,.55)]"
          style={{ left: tip.left, top: tip.top }}
        >
          <Tag color={VERDICT[it.verdict].color}>{VERDICT[it.verdict].label}</Tag>
          <b className="mt-2 block text-[15px] font-semibold leading-tight text-fg">{humanizeObjective(it.objective)}</b>
          <p className="mt-1 text-[13px] leading-snug text-muted">{notes.get(it.objective) ?? ghostDetail(it)}</p>
          {it.actual_seq != null && <span className="mt-[9px] block font-mono text-[10px] uppercase tracking-[0.14em] text-signal">Click to replay step {it.actual_seq}</span>}
        </div>
      )}
    </div>
  );
}

function Marks({ r, cy, x, end, lateFill, skipFill }: { r: GhostItem; cy: number; x: (s: number) => number; end: number; lateFill: string; skipFill: string }) {
  const u = r.unlock_seq ?? null;
  const a = r.actual_seq ?? null;
  const ring = (at: number) => <circle cx={x(at)} cy={cy} r={4} fill="var(--color-ink)" stroke="var(--color-muted)" strokeWidth={1.2} />;
  if (r.verdict === "late_pivot" && u != null && a != null) {
    return (
      <>
        <rect x={x(u)} y={cy - 5} width={Math.max(2, x(a) - x(u))} height={10} fill={lateFill} />
        {ring(u)}
        <rect x={x(a) - 1.5} y={cy - 8} width={3} height={16} fill="var(--color-loud)" />
      </>
    );
  }
  if (r.verdict === "skipped") {
    const u0 = u ?? 1;
    return (
      <>
        <rect x={x(u0)} y={cy - 5} width={Math.max(2, x(end) - x(u0))} height={10} fill={skipFill} />
        {ring(u0)}
        <text x={x(end) + 4} y={cy + 4} fontSize={13} fill="var(--color-skipped)">
          ×
        </text>
      </>
    );
  }
  if (a == null) return null;
  const c = VERDICT[r.verdict].color;
  return (
    <>
      <rect x={x(a) - 1.5} y={cy - 8} width={3} height={16} fill={c} />
      {(r.verdict === "ahead" || r.verdict === "off_path_win") && <circle cx={x(a)} cy={cy} r={4} fill={c} />}
    </>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/ghost/headline.test.ts tests/pivot-strip.test.tsx`
Expected: PASS.

- [ ] **Step 6: Rewrite `GhostCard`'s body**

Keep the `narrated` state and the `narrateGhost` effect as they are. Add imports: `import { ghostHeadline, verdictCounts, VERDICT, VERDICT_ORDER } from "../lib/ghost/headline";`, `import { PivotStrip } from "./PivotStrip";`, `import { TallyKey } from "./ui";`, `import { ditherMask } from "../lib/dither";`; add `const total = useReport((s) => s.report.episodes.length);`. Replace everything from `const wins = …` to the end of the component's JSX with:

```tsx
  const head = ghostHeadline(items);
  const counts = verdictCounts(items);

  return (
    <div className="flex flex-col gap-[18px]" data-shot="ghost">
      <p className="max-w-[60ch] text-[17px] font-semibold leading-snug text-fg">
        {head.kind === "pivots" ? (
          <>
            {head.count} of {head.total} objectives were reachable from <span className="text-loud">step {head.unlockSeq}</span>. You worked through them one at a time until step{" "}
            {head.lastSeq}.
          </>
        ) : (
          "You stayed on the optimal line."
        )}
      </p>
      <div>
        <div className="flex h-2.5 gap-0.5" aria-hidden="true">
          {VERDICT_ORDER.filter((k) => counts[k]).map((k) => (
            <i key={k} style={{ flex: counts[k], background: VERDICT[k].color, ...ditherMask() }} />
          ))}
        </div>
        <TallyKey items={VERDICT_ORDER.map((k) => ({ label: VERDICT[k].label, count: counts[k], color: VERDICT[k].color }))} />
      </div>
      <PivotStrip items={items} total={total} notes={narrated} onReveal={reveal} />
    </div>
  );
```

Remove imports that become unused (`Chip`, `verdictMeta`, `fmtMinutes`) and delete the `ai` tag markup with the old list.

In `App.tsx`, replace the Ghost Section opening tag:

```tsx
                <Section
                  title="You vs. the Ghost"
                  num={num.ghost}
                  lead={{
                    value: Math.round((report.ghost.time_lost_ms ?? 0) / 60000),
                    unit: " min",
                    caption: `lost to late pivots${report.ghost.human_wins ? ` · you beat the optimal line ${report.ghost.human_wins}×` : ""}`,
                  }}
                >
```

- [ ] **Step 7: Gate**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Look at it**

`npm run dev` on the Abducted demo: `03 YOU VS. THE GHOST` → `133 min` → "15 of 21 objectives were reachable from step 5 …" → tally → a staircase of coral spans from step 5. Hovering a row shows the readout beside the span's end (flipping left near the edge); Tab moves through rows; Enter replays the step.

- [ ] **Step 9: Commit**

```bash
git add src/lib/ghost/headline.ts src/lib/ghost/headline.test.ts src/components/PivotStrip.tsx tests/pivot-strip.test.tsx src/components/GhostCard.tsx src/App.tsx
git commit -m "ghost: one computed headline + tally + pivot strip replace the per-objective sentences"
```

---

### Task 11: The one lesson as hero

**Files:**
- Modify: `src/lib/one-lesson.ts:7-31`
- Test: `src/lib/one-lesson-pivot.test.ts`
- Create: `src/components/StepStrip.tsx`
- Modify: `src/App.tsx:58-91` (`HeroLesson`)

**Interfaces:**
- Consumes: `ditherMask`, `ditherTrack` (Task 2).
- Produces: `OneLesson.pivot?: { unlock_seq: number; acted_seq: number }`; `StepStrip(props: { unlock: number; acted: number; total: number })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/one-lesson-pivot.test.ts
import { describe, it, expect } from "vitest";
import { pickOneLesson } from "./one-lesson";
import type { WatcherReport } from "../types/report";

const withGhost = (items: unknown[]) => ({ ghost: { items } }) as unknown as WatcherReport;

describe("pickOneLesson pivot", () => {
  it("exposes the worst late pivot's unlock and action steps", () => {
    const lesson = pickOneLesson(
      withGhost([
        { objective: "a", verdict: "late_pivot", unlock_seq: 5, actual_seq: 11, lag_ms: 1000 },
        { objective: "b", verdict: "late_pivot", unlock_seq: 5, actual_seq: 30, lag_ms: 9000 },
      ]),
    );
    expect(lesson?.pivot).toEqual({ unlock_seq: 5, acted_seq: 30 });
    expect(lesson?.evidence_seq).toBe(30);
  });

  it("omits the pivot when a step is missing", () => {
    const lesson = pickOneLesson(withGhost([{ objective: "a", verdict: "late_pivot", unlock_seq: null, actual_seq: 9, lag_ms: 1 }]));
    expect(lesson?.pivot).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/one-lesson-pivot.test.ts`
Expected: FAIL (`expected undefined to deeply equal { unlock_seq: 5, acted_seq: 30 }`).

- [ ] **Step 3: Implement**

In `src/lib/one-lesson.ts`, extend the interface:

```ts
export interface OneLesson {
  text: string;
  evidence_seq: number | null;
  /** present for a Ghost late pivot: where the way forward opened, and where you took it */
  pivot?: { unlock_seq: number; acted_seq: number };
}
```

and change the late-pivot `return`:

```ts
    const pivot = worst.unlock_seq != null && worst.actual_seq != null ? { unlock_seq: worst.unlock_seq, acted_seq: worst.actual_seq } : undefined;
    return { text, evidence_seq: worst.actual_seq ?? worst.unlock_seq ?? null, ...(pivot ? { pivot } : {}) };
```

Run: `npx vitest run src/lib/one-lesson-pivot.test.ts`. Expected: PASS.

- [ ] **Step 4: The figure**

```tsx
// src/components/StepStrip.tsx
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
```

- [ ] **Step 5: The hero**

In `App.tsx`, import `StepStrip` and replace `HeroLesson`:

```tsx
function HeroLesson() {
  const { report, reveal } = useReport();
  const lesson = pickOneLesson(report);
  if (!lesson) return null;
  const p = lesson.pivot;
  const total = report.episodes.length;
  const body = (
    <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_290px] md:items-end">
      <div>
        <span className="label text-signal">The one lesson</span>
        <p className="mt-3 text-balance font-display text-[34px] font-bold leading-[1.08] tracking-[-0.03em] text-fg">
          {p ? (
            <>
              The way forward opened at step {p.unlock_seq}. <span className="text-loud">You took it at step {p.acted_seq}.</span>
            </>
          ) : (
            lesson.text
          )}
        </p>
        {lesson.evidence_seq != null && <span className="label mt-3.5 inline-block text-signal">Replay step {lesson.evidence_seq} →</span>}
      </div>
      {p && total > 0 && <StepStrip unlock={p.unlock_seq} acted={p.acted_seq} total={total} />}
    </div>
  );
  const cls = "block w-full border-y border-edge py-7 text-left";
  if (lesson.evidence_seq == null) {
    return (
      <div data-shot="one-lesson" className={cls}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" data-shot="one-lesson" onClick={() => reveal(lesson.evidence_seq!)} className={`${cls} transition-colors hover:bg-panel/60`} title={`Replay step ${lesson.evidence_seq}`}>
      {body}
    </button>
  );
}
```

Remove `ArrowUpRight` from the imports if nothing else uses it.

- [ ] **Step 6: Gate**

Run: `npm test && npm run typecheck`
Expected: PASS (render test still finds "The one lesson").

- [ ] **Step 7: Commit**

```bash
git add src/lib/one-lesson.ts src/lib/one-lesson-pivot.test.ts src/components/StepStrip.tsx src/App.tsx
git commit -m "lesson: hero headline from structured pivot steps, with a step-strip figure"
```

---

### Task 12: Stealth (gradient area, full-width loudest moments)

**Files:**
- Modify: `src/components/StealthReport.tsx:91-94` (legend swatch), `:111-124` (chart), `:196-215` (loudest list)

**Interfaces:**
- Consumes: `GradientDitherPattern`, `LevelBar` (Task 3), `useWidth` (Task 3), `ditherMask` (Task 2), `AXIS_W` (`lib/scale`).

- [ ] **Step 1: Chart-anchored gradient area**

Imports: `import { useId, useRef } from "react";`, `import { GradientDitherPattern, LevelBar } from "./dither";`, `import { useWidth } from "./useWidth";`, `import { ditherMask } from "../lib/dither";`.

Near the top of the component body:

```tsx
  // the chart is drawn in AXIS_W × H user units stretched to its box (preserveAspectRatio="none"),
  // so the dither tile is converted per axis to stay 2px dots on screen
  const box = useRef<HTMLDivElement>(null);
  const pxW = useWidth(box, AXIS_W);
  const kx = AXIS_W / Math.max(1, pxW);
  const ky = H / 132;
  const gradRows = Math.ceil(H / (3 * ky));
  const gradId = `noise-${useId().replace(/:/g, "")}`;
```

Wrap the existing `<svg …>` in `<div ref={box} className="absolute inset-0">…</div>` (keep `{...handlers}` on the outer div untouched). Inside the svg, first child:

```tsx
          <defs>
            <GradientDitherPattern id={gradId} color="var(--color-loud)" rows={gradRows} top={0.9} bottom={0.18} kx={kx} ky={ky} />
          </defs>
```

and change the area path to `<path d={area} fill={`url(#${gradId})`} stroke="none" />`.

Legend swatch (line 92): replace its `style` with `style={{ background: "var(--color-loud)", ...ditherMask() }}` and its class with `inline-block h-2 w-3`.

- [ ] **Step 2: Loudest moments as a ranked bar chart**

Before the `return`, add `const maxNoise = Math.max(...metrics.loud_moments.map((m) => m.noise), 1);`. In the loudest-list button change `grid-cols-[2.6rem_1fr_3.5rem] … py-1` to `grid-cols-[2.6rem_7rem_1fr] … py-[7px]`, and replace the trailing `<span className="justify-self-end">…</span>` with:

```tsx
                <span className="min-w-0">
                  <LevelBar value={l.noise} max={maxNoise} color="var(--color-loud)" height={8} label={`${l.binary} noise`} />
                </span>
```

- [ ] **Step 3: Gate**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Look at it**

`npm run dev` → Evidence & detail → Stealth & noise: the noise area is coral dots, dense near the budget line and sparse at the baseline (on a quiet run, a sparse band of dots); dots stay 2px when the window is resized; loudest moments are full-width ranked bars.

- [ ] **Step 5: Commit**

```bash
git add src/components/StealthReport.tsx
git commit -m "stealth: chart-anchored gradient dither area; loudest moments as full-width ranked bars"
```

---

### Task 13: ASCII field (header margins, empty states)

**Files:**
- Create: `src/lib/ascii.ts`, `src/components/AsciiField.tsx`
- Test: `src/lib/ascii.test.ts`
- Modify: `src/components/IdentityBar.tsx:91` (verdict wrapper), `src/components/Progress.tsx:115-120`

**Interfaces:**
- Produces: `ASCII_RAMP`, `asciiField(nx, ny, t): number` (0..1), `asciiChar(v): string`, `HEADER_MASK`, `EMPTY_MASK` (both `(nx: number, ny: number) => number`, module-level so they're referentially stable), `AsciiField(props: { mask: (nx: number, ny: number) => number; alpha?: number; className?: string })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ascii.test.ts
import { describe, it, expect } from "vitest";
import { asciiField, asciiChar, HEADER_MASK, EMPTY_MASK, ASCII_RAMP } from "./ascii";

describe("ascii field", () => {
  it("maps the field into the ramp", () => {
    expect(asciiChar(0)).toBe(" ");
    expect(asciiChar(1)).toBe("@");
    expect(ASCII_RAMP).toHaveLength(13);
  });

  it("stays within 0..1", () => {
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const v = asciiField(i / 10, j / 10, 3.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the header field out from behind the content and fades it downward", () => {
    expect(HEADER_MASK(0.5, 0)).toBe(0);
    expect(HEADER_MASK(0.02, 0)).toBeGreaterThan(0.5);
    expect(HEADER_MASK(0.02, 0.9)).toBeLessThan(HEADER_MASK(0.02, 0));
  });

  it("keeps the empty-state field to the box edges", () => {
    expect(EMPTY_MASK(0.5, 0.5)).toBe(0);
    expect(EMPTY_MASK(0, 0)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/ascii.test.ts`
Expected: FAIL (cannot resolve `./ascii`).

- [ ] **Step 3: Implement the maths**

```ts
// src/lib/ascii.ts
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
```

Run: `npx vitest run src/lib/ascii.test.ts`. Expected: PASS.

- [ ] **Step 4: The canvas component**

```tsx
// src/components/AsciiField.tsx
import { useEffect, useRef } from "react";
import { asciiChar, asciiField } from "../lib/ascii";

const CELL = 14;
const FRAME_MS = 38; // ~26fps is plenty for a drifting texture

/** Decorative ASCII texture on a canvas: paused off-screen, one static frame under reduced motion. */
export function AsciiField({ mask, alpha = 0.3, className = "" }: { mask: (nx: number, ny: number) => number; alpha?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const t0 = performance.now();
    let W = 0;
    let H = 0;
    let raf = 0;
    let last = 0;
    let visible = true;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '12px "Spline Sans Mono Variable", ui-monospace, monospace';
      ctx.textBaseline = "top";
    };
    const draw = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        const t = ((now - t0) / 1000) * 0.45;
        ctx.clearRect(0, 0, W, H);
        for (let j = 0; j * CELL < H; j++) {
          for (let i = 0; i * CELL < W; i++) {
            const nx = (i * CELL) / W;
            const ny = (j * CELL) / H;
            const m = mask(nx, ny);
            if (m <= 0) continue;
            const v = asciiField(nx, ny, t);
            const a = v * m;
            if (a < 0.05) continue;
            const ch = asciiChar(v);
            if (ch === " ") continue;
            const al = Math.min(alpha, a * 0.5);
            ctx.fillStyle = v > 0.8 ? `rgba(47,230,176,${al})` : `rgba(237,237,238,${al * 0.5})`;
            ctx.fillText(ch, i * CELL, j * CELL);
          }
        }
      }
      if (!reduce && visible) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(performance.now() + FRAME_MS);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    });
    io.observe(canvas);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [mask, alpha]);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none absolute ${className}`} />;
}
```

- [ ] **Step 5: Place it**

`IdentityBar.tsx`: import `AsciiField` and `HEADER_MASK`; change the verdict wrapper to `<div className="relative py-1" data-shot="verdict">`, make its first child:

```tsx
      <AsciiField mask={HEADER_MASK} alpha={0.34} className="-top-[70px] left-[calc(50%-50vw)] h-[calc(100%+100px)] w-screen" />
```

and wrap the remaining children in `<div className="relative z-[1]">…</div>`.

`Progress.tsx:115`: change the empty box to `relative overflow-hidden rounded-lg border border-dashed border-edge px-6 py-16 text-center` (drop `bg-panel`), add `<AsciiField mask={EMPTY_MASK} alpha={0.22} className="inset-0 h-full w-full" />` as its first child, and give the heading and paragraph `relative` so they sit above the canvas.

- [ ] **Step 6: Gate**

Run: `npm test && npm run typecheck`
Expected: PASS (SSR renders an empty `<canvas aria-hidden>`; effects don't run on the server).

- [ ] **Step 7: Look at it**

`npm run dev`: drifting mint/grey characters in the verdict band's outer margins only, none behind the name or tiles, no horizontal scrollbar; the Progress empty state has a textured frame; with reduced motion emulated (DevTools → Rendering), the field is static.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ascii.ts src/lib/ascii.test.ts src/components/AsciiField.tsx src/components/IdentityBar.tsx src/components/Progress.tsx
git commit -m "ascii: drifting field in the header margins and empty states"
```

---

### Task 14: Verify, refresh screenshots, rebuild the embed

**Files:**
- Modify: `dist-embed/` (build output), screenshots under `docs/screenshots/`
- External: `C:\Users\Tiago Peter\Claude\Projects\watcher-site\embed\watcher-embed.js`

- [ ] **Step 1: Full gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; `npm test` reports 466 + the new tests, 0 failures.

- [ ] **Step 2: Spec walk-through**

With `npm run dev`, walk the spec's §4–§5 top to bottom against the app, and against the reference preview (`docs/superpowers/specs/2026-09-22-editorial-dark-reference/`, loaded as the spec header describes). Check at 1440px and 390px widths. Fix mismatches in the owning task's files, committing each fix with a message naming the spec section.

- [ ] **Step 3: Screenshots**

Run: `npm run screenshots`
Expected: refreshed captures in `docs/screenshots/`. Commit them:

```bash
git add docs/screenshots
git commit -m "docs: refresh screenshots for the editorial-dark redesign"
```

- [ ] **Step 4: Rebuild the embed**

Run: `npx vite build --config vite.embed.config.ts`
Expected: `dist-embed/watcher-embed.js` rebuilt without errors.

- [ ] **Step 5: Refresh the site (ask first)**

The `watcher-site` checkout has its own uncommitted edits to `embed/watcher-embed.js`. **Ask the user before overwriting it.** With approval: copy `dist-embed/watcher-embed.js` to `watcher-site/embed/watcher-embed.js`, serve the site (`python -m http.server 8092` in `watcher-site`), and check that the hero's live panels (Live Ops, Ghost, Grade, Phase) render in the new style inside Shadow DOM.

- [ ] **Step 6: Report**

Summarise to the user: tests before/after, what each spec section looks like now, anything deferred, and that nothing was pushed.
