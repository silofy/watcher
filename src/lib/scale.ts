/**
 * The ONE shared time axis (brief §6.2). Every chart — timeline, stealth pins,
 * waste hotspots, replay playhead — is rendered against the scale built here, so
 * a position means the same instant everywhere. And the actor-mode palette is the
 * single color vocabulary, identical across every chart.
 *
 * This file is the canonical source for the actor-mode hexes; src/index.css mirrors
 * them as CSS custom properties for Tailwind utilities.
 */
import { scaleLinear, type ScaleLinear } from "d3-scale";
import type { ActorMode, Alignment, Episode, Phase } from "../types/report";

// OKLCH instrument legend — mirrors src/index.css. Calibrated to one lightness/chroma band so the
// four modes read as a single legend, not a neon dashboard. WebView2/Chromium render oklch in SVG.
export const ACTOR_COLORS: Record<ActorMode, string> = {
  machine_bound: "oklch(0.81 0.104 292)", // tool — grinding, human waiting (lavender)
  human_active: "oklch(0.79 0.135 179)", // manual — iteration (teal)
  think_pause: "oklch(0.78 0.129 25)", // stuck — reasoning or stuck (coral)
  idle: "oklch(0.5 0.03 250)", // walked away — excluded from analytics
};

export const ACTOR_LABELS: Record<ActorMode, string> = {
  machine_bound: "Tool",
  human_active: "Manual",
  think_pause: "Stuck / thinking",
  idle: "Idle",
};

/** Detour gets its own deep coral since it is the headline waste class. */
export const DETOUR_COLOR = "oklch(0.66 0.16 29)";

/** Web/HTTP capture accent (Burp exchanges) — a hue distinct from every actor/alignment color so
 *  a request stands out in the ribbon without competing with the actor-mode legend. */
export const WEB_COLOR = "oklch(0.75 0.14 230)";

const HTTP_METHODS = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/i;

/** An HTTP exchange captured via Burp (§8 web capture) — tagged `context_path: "web:burp"` by the
 *  ingest pipeline, or (defensively) any episode whose command line is itself a request line. */
export function isWebEpisode(ep: Episode): boolean {
  return ep.context_path === "web:burp" || HTTP_METHODS.test(ep.cmd ?? "");
}

/** Split a web episode's `cmd` ("GET /login?x=1") into its method and path for compact display. */
export function httpParts(cmd: string): { method: string; path: string } {
  const m = HTTP_METHODS.exec(cmd);
  return { method: m ? m[0].toUpperCase() : "GET", path: m ? cmd.slice(m[0].length).trim() : cmd };
}

export const ALIGNMENT_COLORS: Record<NonNullable<Alignment>, string> = {
  match: "oklch(0.76 0.139 179)", // on the golden path — teal
  alternative: "oklch(0.85 0.13 201)", // alternative method — cyan
  detour: "oklch(0.66 0.16 29)", // wasted effort — deep coral
  skipped: "oklch(0.6 0.045 250)", // missed objective — cool slate
  out_of_order: "oklch(0.78 0.129 25)", // right thing, wrong time — coral
};

/** Color an episode block by actor, but let a detour override (it is the thing to see). */
export function episodeColor(ep: Episode): string {
  if (ep.alignment === "detour") return DETOUR_COLOR;
  return ACTOR_COLORS[ep.actor];
}

export interface TimedEpisode {
  ep: Episode;
  /** ms from session start to the moment the command began (after its think gap). */
  t0: number;
  /** ms from session start to the moment the command finished. */
  t1: number;
  /** start of the think gap that precedes the command. */
  gapStart: number;
}

export interface Timeline {
  items: TimedEpisode[];
  totalMs: number;
  bySeq: Map<number, TimedEpisode>;
}

/**
 * Derive absolute positions deterministically by walking episodes in order:
 * each episode is preceded by its think gap, then occupies its machine duration.
 * This relative model keeps the fixture authorable and the axis reproducible.
 */
export function buildTimeline(episodes: Episode[]): Timeline {
  const ordered = [...episodes].sort((a, b) => a.seq - b.seq);
  const items: TimedEpisode[] = [];

  // Real-time axis: when every episode carries an absolute start (live/fused captures), position
  // by wall-clock so concurrent lanes (host vs on-target) overlap instead of serializing. Fixtures
  // and authored streams lack started_at_ms and fall back to the cumulative relative model.
  const hasAbsolute = ordered.length > 0 && ordered.every((e) => typeof e.started_at_ms === "number");
  if (hasAbsolute) {
    const t0Base = Math.min(...ordered.map((e) => e.started_at_ms as number));
    let totalMs = 0;
    for (const ep of ordered) {
      const t0 = (ep.started_at_ms as number) - t0Base;
      const t1 = t0 + ep.duration_ms;
      const gapStart = Math.max(0, t0 - ep.gap_before_ms);
      items.push({ ep, t0, t1, gapStart });
      totalMs = Math.max(totalMs, t1);
    }
    const bySeq = new Map(items.map((it) => [it.ep.seq, it]));
    return { items, totalMs, bySeq };
  }

  let running = 0;
  for (const ep of ordered) {
    const gapStart = running;
    running += ep.gap_before_ms;
    const t0 = running;
    running += ep.duration_ms;
    items.push({ ep, t0, t1: running, gapStart });
  }
  const bySeq = new Map(items.map((it) => [it.ep.seq, it]));
  return { items, totalMs: running, bySeq };
}

/**
 * Virtual width of the shared axis. Every time-based chart renders into an SVG
 * with viewBox="0 0 AXIS_W h" at width:100%, so identical ms positions land at
 * identical x across stacked charts regardless of the rendered pixel width — one
 * shared axis, responsive, with no DOM measurement.
 */
/** Which swim-lane an episode belongs to: the attacker host, or a compromised target (ssh-tap). */
export function episodeLane(ep: Episode): "host" | "target" {
  return ep.context_path && /ssh:/i.test(ep.context_path) ? "target" : "host";
}

export const AXIS_W = 1000;
export const AXIS_PAD = 6;

export type TimeScale = ScaleLinear<number, number>;

/** The canonical shared scale for a session: ms domain → virtual axis units. */
export function sharedScale(totalMs: number): TimeScale {
  return makeTimeScale(totalMs, AXIS_PAD, AXIS_W - AXIS_PAD);
}

/** Build the shared scale: ms domain → pixel range. Every chart passes its own width. */
export function makeTimeScale(totalMs: number, pxStart: number, pxEnd: number): TimeScale {
  return scaleLinear().domain([0, totalMs]).range([pxStart, pxEnd]);
}

export interface PhaseWindow {
  phase: Phase;
  t0: number;
  t1: number;
}

/** Map each phase to its [t0, t1] window from the episodes carrying its tactic. */
export function phaseWindows(timeline: Timeline, phases: Phase[]): PhaseWindow[] {
  return phases.map((phase) => {
    const inPhase = timeline.items.filter((it) => it.ep.tactic === phase.mitre_tactic);
    const t0 = inPhase.length ? Math.min(...inPhase.map((i) => i.gapStart)) : 0;
    const t1 = inPhase.length ? Math.max(...inPhase.map((i) => i.t1)) : 0;
    return { phase, t0, t1 };
  });
}
