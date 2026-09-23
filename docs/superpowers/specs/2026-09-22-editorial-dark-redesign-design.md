# Design Spec: Editorial Dark (the app takes on the site's language)

**Date:** 2026-09-22
**Status:** Direction validated in a live, in-browser preview (no source changed). Awaiting spec review → implementation plan.
**Branch:** `redesign/editorial-dark` (from `feat/embed-widget` @ ab91cd2)
**Reference implementation (throwaway, do not ship):** [`2026-09-22-editorial-dark-reference/`](2026-09-22-editorial-dark-reference/)
- `watcher-preview.js`: tokens, type, flat surfaces, the dither vocabulary, chips/buttons.
- `watcher-hier.js`: content hierarchy (lesson hero, numbered lead figures, route bar, phase stat cells, Ghost pivot strip).
Both inject into the running dev app (`npm run dev`, then load the scripts via a `<script>` tag). They show exactly what each surface should look like; they are **not** the implementation (they patch the DOM React owns).

**Supersedes:** the *visual treatment* of `2026-07-03-debrief-redesign-design.md`. That spec's section order and component set still stand; this one changes how they look and how much text they carry.

---

## 0. Working rules

- **Presentation only.** No metric, grade, pipeline, or schema change. Every number shown already exists in the report.
- One exception: `pickOneLesson()` gains an optional structured field (§5.4) so the hero stops depending on the sentence text. Additive and backward-compatible.
- Green gate: the suite (466 passing at branch point) stays green after every work package. `npm run typecheck` clean.
- Pure helpers introduced here get unit tests (TDD). Visual changes are verified with `scripts/screenshots.mjs` against the showcase run and the Abducted demo.
- The embed (`embed/`, used by `watcher-site`) mounts these same components; rebuild it at the end (§8, WP9).

---

## 1. The direction (what was decided, and why)

The marketing site's style (router.com-inspired editorial layout, Hanken headlines, mono eyebrows, hairline blocks, Bayer-dither and ASCII textures) becomes the app's style, **in dark**. Decisions, in the order they were made:

| Decision | Choice | Why |
|---|---|---|
| Ground | **Neutral black**, not indigo | The site's tone; the colour belongs to the data, not the chrome. |
| Headlines | **Hanken Grotesk**, not Saira | User choice; Saira is removed entirely. |
| Labels | **Mono eyebrows** (Spline Sans Mono) | The site's small-caps label voice. |
| Surfaces | **Flat**: hairline borders, 3px corners, no filled cards | Chosen over "tokens only" in side-by-side preview. |
| Texture | **Dither as a data vocabulary**, not decoration | See §3; the rule came out of the iteration. |
| Hierarchy | **One lead, then numbered sections led by one figure** | Fixes the "text-heavy / AI-driven" read (§5). |

What was tried and **rejected** (don't reintroduce):
- **Dithered rings** (phase audit): a 32-unit ring can't hold a dot pattern; it read as grit. Replaced by number + level bar.
- **Dithered radar fill** (grade): the mesh fought the grid, the axis labels and the centre letter. The radar keeps a quiet **solid** fill.
- **Blanket dither** on every filled SVG shape: dithered selection/hover rects and the timeline ribbon. Dither is opt-in per element.
- **Tinted pill chips** and the **⚡ emoji** button.

---

## 2. Foundation: tokens and type (WP1)

`src/index.css` `@theme` (and its SVG mirror `src/lib/scale.ts`, which hardcodes the same values; keep them in sync):

| Token | Old | New |
|---|---|---|
| `--color-ink` | `oklch(0.15 0.04 286)` | `#0b0b0c` |
| `--color-panel` | `oklch(0.205 0.038 287)` | `#111113` |
| `--color-panel-2` | `oklch(0.255 0.04 288)` | `#18181b` |
| `--color-edge` | `oklch(0.33 0.042 289)` | `#232326` |
| `--color-edge-bright` | `oklch(0.44 0.05 290)` | `#34343a` |
| `--color-fg` | `oklch(0.92 0.012 281)` | `#ededee` |
| `--color-muted` | `oklch(0.73 0.022 284)` | `#a0a3aa` |
| `--color-faint` | `oklch(0.56 0.03 286)` | `#6a6e76` |
| `--color-signal` / `--color-match` / `--color-manual` | `oklch(0.76 0.139 179)` family | `#2fe6b0` (dim: `#22b58a`) |
| `--color-tool` | `oklch(0.81 0.104 292)` | `oklch(0.8 0.085 292)` (less glow on black) |
| `--color-alt` | `oklch(0.85 0.13 201)` | `oklch(0.84 0.1 201)` |

All other legend/verdict hues (`stuck`, `detour`, `idle`, `skipped`, `loud`, `flag`, `web`) keep their values: they carry meaning (the actor legend), only the chrome changes. The new neutrals may be expressed in OKLCH at implementation time; the hex values are the visual contract.

**Type:**
- Remove `@fontsource-variable/saira` (import in `src/main.tsx`, dependency in `package.json`).
- `--font-display` → Hanken Grotesk. `.font-display`: weight 700, `letter-spacing: -0.02em`.
- `.label` → mono eyebrow: Spline Sans Mono, 10.5px, weight 500, `0.14em` tracking, uppercase, `--color-faint`. (111 usages; this one rule restyles every section label.)
- `.readout` → Hanken 700, `-0.03em`.
- Section `h2` titles (currently Saira uppercase) use the eyebrow style.

**Gotcha found in preview:** once `.label` forces its colour, components that *read back* a rendered colour get the grey. Semantic colours must always come from the data maps (`DIFFICULTY_COLOR`, `tierColor`, `ACTOR_COLORS`), never from `getComputedStyle`.

---

## 3. The dither vocabulary (WP3)

### 3.1 The rule
**Dense dots = value reached. Sparse grey dots = headroom.** Every quantity bar in the app uses this one rule, which is what makes the texture read as a system and not as decoration.

### 3.2 The algorithm
Ordered (Bayer) dither, the same as `watcher-site`'s `ditherFill`:
- 4×4 matrix `[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]`; a cell is on when `density > (m[y][x] + 0.5) / 16`.
- Cell pitch **3px**, dot **2px**, tile **12×12px**, sized in **screen pixels** regardless of chart scale.
- Densities: **value 0.9**, **headroom/track 0.25–0.3** in `#3a3a40`.

### 3.3 Implementation: `src/lib/dither.ts` + two primitives
- `ditherTile(density, color): string` returns a `data:image/svg+xml` URL (pure; unit-tested for dot counts per density).
- **HTML elements:** apply the tile as a **CSS mask** (`mask-image` / `-webkit-mask-image`, `mask-size: 12px`) over a solid `background: <series colour>`. The element keeps its own colour; one mask works for every colour.
- **SVG charts:** a `<DitherPattern id density color />` in `<defs>`. When a chart uses a `viewBox` that scales, divide the tile by the screen transform (`1 / getScreenCTM().a`) or render the chart 1:1 in pixels (preferred for new charts, as `PivotStrip` does).
- **`<LevelBar value max color height />`**: the shared component. A sparse track with a dense value segment, square ends. Accessible: `role="meter"` with `aria-valuenow/min/max` and a label. Used by every bar in §4–5.
- **Gradient dither** (stealth area only): density varies by row, **anchored to the chart's full plot height** (0.9 at the budget line → 0.18 at the baseline), *not* to the shape's own bbox. Anchoring to the bbox collapses to nothing on a quiet run.

### 3.4 Where dither is used, and where it is not
Used: KPI tile levels · phase levels · metric bars · loudest-moment bars · difficulty pips · route bar · Ghost tally + late-pivot spans · lesson step strip · stealth area · Finish-setup lamp.
**Not used:** radar fill · rings (removed) · chips/tags · legend dots · selection/hover/brush rects · the timeline episode ribbon · text or icons.

### 3.5 ASCII field
`<AsciiField mask alpha />`: a canvas port of the site's `makeAscii` (sine-interference field → `·.:-+=ox*#%@` ramp; mint above 0.8, off-white below), capped at ~26fps, paused off-screen (IntersectionObserver), a single static frame under `prefers-reduced-motion`. Used **only** in the verdict header's side margins (masked to nothing behind content) and in empty states (e.g. Progress "Not enough runs yet", masked to the box edges).

---

## 4. Surfaces and small components (WP2)

- **Radii:** `rounded-md/lg/xl` → 3px across the app. `Panel` (`ui.tsx`) loses its fill: transparent with a hairline `border-edge`, matching `Section`.
- **Tags** (replaces tinted pills app-wide): transparent, `1px solid color-mix(currentColor 38–45%)`, 3px corners, mono 10.5px uppercase `0.1em`.
  - Phase status: **`✓ CLEAN`** is the mint tag (all good = signal colour). **`N TO IMPROVE`** is neutral: muted text, `edge-bright` border, the count in `fg`. The tag column has a fixed min-width (140px) so stat columns align across rows.
- **Identity chips → a metadata line** (`IdentityBar` `AttributePills`): no boxes. `▮▮▯▯ MEDIUM │ LINUX │ RETIRED`.
  - Difficulty = **4 dithered pips** (Easy 1 … Insane 4), lit pips in `DIFFICULTY_COLOR`, the word in the same colour.
  - OS in `muted` mono, Retired/Local in `faint`, separated by 1px `edge-bright` rules.
- **Score tiles** (`ScoreReadout`): a `LevelBar` (8px) across the bottom, value in the tile's tier colour, with **22px** bottom padding so it doesn't crowd the `/100 · GOOD` line.
- **Header buttons:** Finish setup loses the ⚡ emoji and the pill: transparent, 1px mint border at 45%, 3px corners, mono label, an 8px **dithered mint lamp** that pulses (opacity 1 → .35, 1.8s; static, fully opaque, under `prefers-reduced-motion`), and an arrow that nudges 2px on hover. Pwnbox / AI·setup get the same corners.

---

## 5. Content hierarchy (WP4–WP7)

The diagnosis (unslop-ui audit, 0 mechanical tells in 161 files): the app felt AI-made because of **content structure**. Everything was said in sentences, at equal volume, several times over. The fixes:

### 5.1 Numbered sections, each led by one figure (`Section`)
- Top-level debrief sections are numbered `01`–`04` (mint numeral before the eyebrow).
- New `lead` prop: `{ value, unit?, caption }`, rendered under the header as a 40px Hanken figure plus a 13px muted caption.
  - 01 Path: `95%` "of the write-up's path followed"
  - 02 Phase audit: `3/3` "phases at full efficiency"
  - 03 Ghost: `133 min` "lost to late pivots · you beat the optimal line 1×"
  - 04 Grade: `C · 79.2` in `gradeColor`, "weighted across seven rubric metrics"
- **Subtitles removed** from section headers and the Evidence drawer (*"the explainable rubric"*, *"the raw record — …"*). If a subtitle carried real help, move it to an ⓘ tooltip; a header is a label and a number.
- Copy rule for these surfaces: plain statements with numbers; **no em-dash asides, no quips** (*"the write-up didn't see that coming"*).

### 5.2 01: What you'd do differently (`PathComparison`)
Replaces the summary box and puts the node map behind a toggle:
1. **Route bar:** one cell per `golden_dag` objective in intended order, 22px tall, 3px gaps. Status from the existing `statusOf()`: match = mint dither, alternative = `alt`, out of order = `stuck`, skipped = sparse `skipped` with a dashed outline. Cell `title`: objective · status · step. Ends labelled `WRITE-UP STEP 1` / `STEP N`; a tally key underneath (`20 MATCHED · 1 SKIPPED`).
2. **"Change next time":** only the deviations, one ruled row each: `[TAG] Objective ………… fix`. Skipped → "Try `satisfied_by[0]`"; out of order → "Done at step N, earlier than the write-up's order"; alt → "Done at step N with `binary`". No deviations → one mint line, "You followed the intended path. Nothing to change."
3. **"Show full path map ↓":** a **full-width, 44px** bordered button (mono 11.5px, centred), map **collapsed by default**, toggles to "Hide path map ↑". The existing `PathGraph` is unchanged inside it.

### 5.3 02: Phase audit (`PhaseAudit`)
- `ScoreRing` → **`PhaseLevel`**: the efficiency as a 22px Hanken number over a 56×6 `LevelBar`, vertically centred in the 56px slot. No score (General) → `—` over an empty track.
- `summaryLine()` sentence → **stat cells**, right-aligned before the tag: `OBJECTIVES 9/10` and `TIME LOST 0m` (muted when zero, `loud` when not). Build these from the structured fields (`p.coverage`, `p.wasted_ms`), **not** by parsing the sentence as the preview does. `summaryLine()` stays for the expanded body / tooltips.
- General row: the note becomes a faint mono label, `CROSS-CUTTING`.

### 5.4 The one lesson → hero (`HeroLesson` in `App.tsx`, `lib/one-lesson.ts`)
- `OneLesson` gains an optional `pivot?: { unlock_seq: number; acted_seq: number }`, set by the late-pivot branch of `pickOneLesson()` (it already has both values). Unit-test it.
- Layout: no card. Hairline rules above and below, 28px vertical padding, two columns:
  - Left: eyebrow `THE ONE LESSON`; a 34px Hanken headline, balanced. With `pivot`: *"The way forward opened at step {u}. **You took it at step {a}.**"* (second sentence in `loud`). Without it: `lesson.text` as is. Then `REPLAY STEP N →`.
  - Right (only with `pivot`): `UNLOCKED / STEP u` and `YOU ACTED / STEP a` (coral), over a strip of one cell per episode: sparse track, mint at `u`, coral dither from `u` to `a`, coral at `a`. Caption: "{a−u} steps where the next move was already on the table".
- The whole hero stays one button that calls `reveal(evidence_seq)`.

### 5.5 03: You vs. the Ghost (`GhostCard`)
Replaces the per-objective sentence list (the single biggest "generated" tell: 19 near-identical rows):
1. **Headline, computed not generated:** group late pivots by `unlock_seq` and take the largest group: *"{n} of {total} objectives were reachable from **step {u}**. You worked through them one at a time until step {max actual}."* No late pivots → "You stayed on the optimal line." (Pure helper `ghostHeadline(items)`, unit-tested.)
2. **Tally bar:** a 10px stacked dithered bar by verdict, then a key: `1 AHEAD · 3 ON TIME · 16 LATE PIVOT · 1 SKIPPED`.
3. **`PivotStrip`** (new, SVG rendered 1:1 in px):
   - One row per objective, sorted by `actual_seq` then `unlock_seq`. **Row height 26px**, labels Hanken 13px (humanized), `fg` for late pivots and `muted` otherwise. Step axis with ticks at 1 and every 5.
   - Late pivot: hollow ring at `unlock_seq` → 10px coral dither span → 3×16 coral tick at `actual_seq`. On time: a 3×16 muted tick. Ahead / off-path win: a mint/alt dot + tick. Skipped: sparse slate span from unlock to the end, then `×`.
   - **Hover:** a `panel-2` row band plus a 2px verdict-coloured left accent, and a **floating readout card** (300px, `panel-2`, `edge-bright` border, shadow) beside the span's end (flipping left when it would overflow): verdict tag · **objective** (15px) · detail ("Open from step 5, done at step 20 · 9 min later") · `CLICK TO REPLAY STEP N` in mint. The model narration (`narrateGhost`/`refinedNotes`) replaces the detail line when present.
   - **Click** → `reveal(actual_seq)`. Rows are keyboard-focusable (`tabindex`, Enter = reveal, focus shows the same readout).
4. Remove the old sentence list. The page-level caption line under the chart is gone (the readout replaces it).

### 5.6 04: Grade (`Assessment`)
- Radar: keep the solid value fill (no dither) and the crisp outline.
- Metric bars: `LevelBar`, **8px** (from 1.5px), square ends.

### 5.7 Evidence → Stealth & noise (`StealthReport`)
- Cumulative-noise area: chart-anchored gradient dither (§3.3).
- **Loudest moments** → a full-width ranked bar chart: row grid `2.6rem 7rem 1fr`, each bar a full-width 8px `LevelBar` in `loud` (was a 48×6 pill in a 3.5rem column), 7px row padding.

---

## 6. Scope

**In:** header, IdentityBar/verdict, lesson hero, the four debrief sections, the Evidence → Stealth tab, Progress empty state.
**Inherit tokens/type/surfaces only (no dither or structure work this pass):** History, Progress charts, Install, Onboarding, Live Ops (`LiveDashboard`), Timeline (`AttackTimeline`), Time lost (`DeviationTimeline`), Frameworks, Findings, Command log. Each needs its own follow-up pass; Live Ops is next in line.
**Out:** light theme, export, any pipeline/grade change.

---

## 7. Implementation notes (learned in the preview)

- **Never read semantic colour back from the DOM** (§2 gotcha). Pass colours from data maps.
- **Don't parse UI sentences for numbers.** The preview regex-parses the lesson, phase lines and the "95%"; the real build uses `pickOneLesson().pivot`, `p.coverage`, `p.wasted_ms`, `metrics.objective_coverage_pct`.
- SVG dither patterns must be sized in **screen px** (§3.2); otherwise dot size changes from chart to chart.
- Mask-based dither keeps each element's colour. Prefer it to baking colour into patterns for HTML.
- Stat columns in list rows need a fixed-width trailing column to align.
- The preview's bookkeeping attribute collided with its own theme attribute (`data-pv`). Namespacing matters wherever components mark DOM state.

---

## 8. Work packages (build order)

| WP | Content | Verifies |
|---|---|---|
| 1 | Tokens + type (`index.css`, `scale.ts`, drop Saira) | whole app neutral black + Hanken + eyebrows; suite green |
| 2 | Surfaces: radii, flat `Panel`, tags, header buttons, identity metadata line | screenshots: header, verdict |
| 3 | `lib/dither.ts` (+tests), `LevelBar`, `DitherPattern`, `AsciiField`; KPI tiles, metric bars, loudest moments, difficulty pips | screenshots: verdict, grade, stealth |
| 4 | `Section` numbering + `lead` + subtitle removal; phase audit (`PhaseLevel`, stat cells, tags) | screenshots: phase audit |
| 5 | Path: route bar, change list, collapsible map | screenshots: path open/closed |
| 6 | Ghost: `ghostHeadline` (+tests), tally, `PivotStrip`, readout, keyboard | screenshots: ghost, hover state |
| 7 | Lesson hero: `OneLesson.pivot` (+tests), hero layout, header ASCII field | screenshots: top of debrief |
| 8 | Stealth gradient; Progress empty-state ASCII | screenshots: stealth, progress |
| 9 | Rebuild `dist-embed`; refresh `watcher-site` embed; update `scripts/screenshots.mjs` captures | site hero renders the new look |

---

## 9. Testing and quality

- Unit: `ditherTile` densities, `ghostHeadline` grouping (incl. no late pivots, ties), `pickOneLesson().pivot`, route-bar status mapping (reuse `statusOf`), phase stat formatting.
- Existing suite + typecheck green after every WP.
- Visual: `scripts/screenshots.mjs` on the showcase run (Grade B / 87.6) and the Abducted demo, compared against the reference preview.
- Accessibility: `LevelBar` as `meter`; the strip's rows focusable with the same readout on focus; dither/ASCII `aria-hidden`; contrast of `faint` eyebrows on `#0b0b0c` checked (≥ 4.5:1 for 10.5px text, or bump to `muted`); reduced motion honoured (ASCII static, lamp still).

---

## 10. Risks

- **Legend drift:** `index.css` and `scale.ts` hold the same colours twice. Mitigation: WP1 updates both; add a test that asserts they match.
- **Dither performance:** many masked elements plus canvases. Mitigation: masks are static data URIs (cheap); ASCII fields throttled and paused off-screen; at most two on screen.
- **Embed drift:** the site mounts these components in Shadow DOM. Mitigation: WP9 rebuild plus a visual check of the site hero.
- **Scope creep into the untouched views:** they inherit tokens only this pass; each gets its own spec.
