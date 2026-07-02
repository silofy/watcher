import { create } from "zustand";
import type { GoldenObjective, WatcherReport } from "../types/report";
import { alignEpisodes } from "../lib/pipeline";
import {
  buildTimeline,
  phaseWindows as computePhaseWindows,
  sharedScale,
  type Timeline,
  type PhaseWindow,
  type TimeScale,
} from "../lib/scale";
import { computeMetrics, round, type ComputedMetrics } from "../lib/metrics";
import { applyTrim } from "../lib/trim";
import { computeGrade } from "../lib/bridge/grade";
import { machineOf, type MachineMeta } from "../lib/machine";
import { finalizeLiveReport } from "../lib/finalize";
import { sshSessionsFromDir, type SshLogFile } from "../lib/ssh/ingest";
import { isLiveRecording } from "../lib/live";
import { assembleReport } from "../lib/pipeline/ingest";
import { DEMO_RAW, DEMO_SESSION, DEMO_GOLDEN, DEMO_ID, DEMO_REPORT } from "../lib/demo/playthrough";

/**
 * The normalized store. The report blob is resolved from, in order:
 *   1. an SSR-injected global / embedded <script id="watcher-data"> (the export — single
 *      session, §6.3),
 *   2. otherwise every fixtures/session-*.json (dev): the curated demo plus any captured
 *      session written by `npm run ingest` — selectable in the UI.
 * In later phases these come from the Tauri backend / SQLCipher store.
 */
interface SessionEntry {
  id: string;
  label: string;
  report: WatcherReport;
}

function loadSessions(): SessionEntry[] {
  const injected = (globalThis as { __WATCHER_REPORT__?: WatcherReport }).__WATCHER_REPORT__;
  if (injected) return [{ id: "injected", label: injected.session.target_scope, report: injected }];

  if (typeof document !== "undefined") {
    const el = document.getElementById("watcher-data");
    if (el?.textContent) {
      try {
        const r = JSON.parse(el.textContent) as WatcherReport;
        return [{ id: "embedded", label: r.session.target_scope, report: r }];
      } catch {
        /* fall through */
      }
    }
  }

  const mods = import.meta.glob("../../fixtures/session-*.json", { eager: true }) as Record<
    string,
    { default: WatcherReport }
  >;
  const entries = Object.entries(mods).map(([path, m]) => {
    const id = (path.split("/").pop() ?? "session").replace(/\.json$/, "").replace(/^session-/, "");
    return { id, label: m.default.session.target_scope, report: m.default };
  });
  // Curated demo first, then the rest alphabetically.
  entries.sort((a, b) => (a.id === "htb-easy" ? -1 : b.id === "htb-easy" ? 1 : a.id.localeCompare(b.id)));
  return entries;
}

interface Derived {
  report: WatcherReport;
  timeline: Timeline;
  metrics: ComputedMetrics;
  phaseWindows: PhaseWindow[];
  scale: TimeScale;
}

function derive(report: WatcherReport): Derived {
  const timeline = buildTimeline(report.episodes);
  return {
    report,
    timeline,
    metrics: computeMetrics(report),
    phaseWindows: computePhaseWindows(timeline, report.phases),
    scale: sharedScale(timeline.totalMs),
  };
}

const SESSIONS = loadSessions();

// A mutable registry so live sessions (spawned in the browser, written by the daemon) can be merged
// in at runtime alongside the bundled fixtures.
const REPORTS: Record<string, WatcherReport> = {};
for (const s of SESSIONS) REPORTS[s.id] = s.report;

export interface SessionCard {
  id: string;
  machine: MachineMeta;
  target_scope: string;
  started_at: string;
  ended_at: string;
  source: string;
  rooted: boolean;
  grade: number;
  letter: string;
  coverage: number;
  efficiency: number;
  episodes: number;
  recording: boolean;
  isLatest: boolean;
  /** The scripted demo session — opening it replays the run live rather than opening a static debrief. */
  demo: boolean;
}

function toCard(id: string, r: WatcherReport): SessionCard {
  const g = computeGrade(r);
  const rooted = r.golden_dag.some((o) => /escalate_to_root|capture_flags|root\b/i.test(o.objective) && o.user_satisfied_by_seq != null);
  return {
    id,
    machine: machineOf(r),
    target_scope: r.session.target_scope,
    started_at: r.session.started_at,
    ended_at: r.session.ended_at,
    source: r.session.source,
    rooted,
    grade: g.score,
    letter: g.letter,
    coverage: r.metrics.objective_coverage_pct,
    efficiency: r.metrics.efficiency_pct,
    episodes: r.episodes.length,
    recording: isLiveRecording(r), // flag + heartbeat — a dead capture isn't "live"
    isLatest: false,
    demo: id === DEMO_ID,
  };
}

function cardsFrom(): SessionCard[] {
  const cards = Object.entries(REPORTS).map(([id, r]) => toCard(id, r));
  const latestId = [...cards].sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at))[0]?.id;
  return cards.map((c) => ({ ...c, isLatest: c.id === latestId }));
}

// Open on the fullest engagement (most episodes), tie-broken by recency — the headline debrief.
const DEFAULT_ID =
  [...cardsFrom()].sort((a, b) => b.episodes - a.episodes || Date.parse(b.ended_at) - Date.parse(a.ended_at))[0]?.id ?? SESSIONS[0].id;

// Register the scripted demo AFTER DEFAULT_ID is chosen, so it shows as a History card (openable as a
// live replay) without ever being the session the app lands on.
REPORTS[DEMO_ID] = DEMO_REPORT;

type View = "debrief" | "history" | "install";

interface ReportState extends Derived {
  sessions: { id: string; label: string }[];
  sessionCards: SessionCard[];
  activeId: string;
  view: View;
  /** Dismissed the "needs a write-up" gate for this session (chose run-only). Resets per session. */
  gateDismissed: boolean;
  /** The active session's full report; `report` is the (possibly trimmed) view. */
  fullReport: WatcherReport;
  /** Retroactive session window as an inclusive seq range, or null for the full session. */
  trimSeq: [number, number] | null;

  hoveredSeq: number | null;
  selectedSeq: number | null;
  /** A request to reveal a step in the Command Log (scroll the row into view + highlight). Bumped each
   *  call so repeat reveals of the same seq still fire; only set by deliberate deep-links, not hover/select. */
  revealSeq: number | null;
  revealNonce: number;
  /** Shared zoom window (ms) across the time-axis charts — null is the full session. */
  zoomWin: [number, number] | null;
  playheadMs: number;
  playing: boolean;
  /** A just-detected live session to surface, until dismissed/opened. */
  liveBanner: { id: string; name: string } | null;
  /** Layer-2 provenance once a write-up's golden DAG is applied to the active report. */
  writeup: { source: string; confidence: number } | null;
  /** Live-demo progress, when the scripted playthrough is streaming; null when idle. */
  demo: { phase: "recording" | "resolved" | "compared"; n: number; total: number } | null;

  setView: (v: View) => void;
  /** Dismiss the write-up gate for this session and show the run-only report. */
  setGateDismissed: (v: boolean) => void;
  /** Overlay a write-up-sourced golden DAG: re-align the active report against the intended path. */
  applyGoldenDag: (golden: GoldenObjective[], meta?: { source: string; confidence: number }) => void;
  switchSession: (id: string) => void;
  /** Merge a session report written by the daemon (a spawned box) at runtime, with any captured
   *  SSH-session log files (folded in as on-target commands for the matching session). */
  ingestLiveReport: (report: WatcherReport, sshFiles?: SshLogFile[]) => void;
  dismissLiveBanner: () => void;
  /** Start (or restart) the scripted live-box demo — streams DEMO_RAW into the live pipeline one
   *  command at a time, then resolves and unlocks the intended-path comparison. */
  startLiveDemo: () => void;
  setTrim: (range: [number, number] | null) => void;
  clearTrim: () => void;
  hover: (seq: number | null) => void;
  select: (seq: number | null) => void;
  /** Select a step AND ask the Command Log to scroll the row into view and highlight it. */
  reveal: (seq: number) => void;
  /** Set the shared zoom window across the time-axis charts (null = full session). */
  setZoom: (win: [number, number] | null) => void;
  scrub: (ms: number) => void;
  setPlaying: (p: boolean) => void;
}

const RESET = { hoveredSeq: null, selectedSeq: null, zoomWin: null, playheadMs: 0, playing: false, gateDismissed: false } as const;
const DEFAULT_ENTRY = SESSIONS.find((s) => s.id === DEFAULT_ID) ?? SESSIONS[0];

// The live-demo driver runs on real timers outside React; module-scoped so a re-entrant start is a no-op
// and a restart can clear the prior run cleanly.
const DEMO_TICK_MS = 2000;
const DEMO_GOLDEN_DELAY_MS = 2200;
let demoTick: ReturnType<typeof setInterval> | undefined;
let demoGoldenTimer: ReturnType<typeof setTimeout> | undefined;

export const useReport = create<ReportState>((set, get) => ({
  sessions: SESSIONS.map((s) => ({ id: s.id, label: s.label })),
  sessionCards: cardsFrom(),
  activeId: DEFAULT_ENTRY.id,
  view: "debrief",
  gateDismissed: false,
  fullReport: DEFAULT_ENTRY.report,
  trimSeq: null,
  ...derive(DEFAULT_ENTRY.report),

  hoveredSeq: null,
  selectedSeq: null,
  revealSeq: null,
  revealNonce: 0,
  zoomWin: null,
  playheadMs: 0,
  playing: false,
  liveBanner: null,
  writeup: null,
  demo: null,

  setView: (view) => set({ view }),
  setGateDismissed: (gateDismissed) => set({ gateDismissed }),
  switchSession: (id) => {
    const r = REPORTS[id];
    if (!r) return;
    const banner = get().liveBanner;
    // Explicitly opening a session (from History, the live banner, etc.) goes straight to the debrief —
    // never re-prompt for a write-up here. The gate is for the initial landing; you can still add a
    // reference path from inside the debrief (Reference path → Add write-up).
    set({ activeId: id, view: "debrief", fullReport: r, trimSeq: null, ...derive(r), ...RESET, gateDismissed: true, liveBanner: banner?.id === id ? null : banner, writeup: null, demo: id === DEMO_ID ? get().demo : null });
  },

  applyGoldenDag: (golden, meta) => {
    const r = get().fullReport;
    const { episodes, golden: aligned } = alignEpisodes(r.episodes, golden);
    // Re-alignment reclassifies episodes (detour → match/alternative), which moves efficiency and the
    // other alignment-derived metrics — so re-derive the whole block, not just coverage, or the Grade
    // would keep the stale efficiency while the KPI cards showed the improved one.
    const scoped: WatcherReport = { ...r, episodes, golden_dag: aligned };
    const cm = computeMetrics(scoped);
    const next: WatcherReport = {
      ...scoped,
      metrics: {
        ...r.metrics,
        efficiency_pct: round(cm.efficiency_pct),
        objective_coverage_pct: round(cm.objective_coverage_pct),
        stealth_score: round(cm.stealth_score),
        technique_breadth: cm.technique_breadth,
        time_waster: cm.time_waster,
        loud_moments: cm.loud_moments.map((l) => ({ seq: l.seq, noise: round(l.noise, 1) })),
        ukc_coverage_pct: round(cm.ukc_coverage_pct),
        ukc_progression: round(cm.ukc_progression),
        weakness_breadth: cm.weakness_breadth,
      },
    };
    REPORTS[get().activeId] = next;
    set({ fullReport: next, writeup: meta ?? get().writeup, sessionCards: cardsFrom(), ...derive(applyTrim(next, get().trimSeq)) });
  },

  ingestLiveReport: (report, sshFiles = []) => {
    // fold in this session's captured SSH sessions (files named <session-uuid>-<ts>.in|.meta)
    const mine = sshFiles.filter((f) => f.name.startsWith(report.session.uuid));
    const finalized = finalizeLiveReport(report, sshSessionsFromDir(mine));
    const id = `htb:${finalized.session.uuid}`;
    const isNew = !(id in REPORTS);
    REPORTS[id] = finalized;
    const patch: Partial<ReportState> = { sessionCards: cardsFrom() };
    if (get().activeId === id) Object.assign(patch, derive(applyTrim(finalized, get().trimSeq)), { fullReport: finalized });
    if (isNew && isLiveRecording(finalized)) patch.liveBanner = { id, name: machineOf(finalized).name };
    set(patch);
  },
  dismissLiveBanner: () => set({ liveBanner: null }),

  startLiveDemo: () => {
    // restart cleanly if a prior run is mid-flight (e.g. re-clicked from History)
    if (demoTick) clearInterval(demoTick);
    if (demoGoldenTimer) clearTimeout(demoGoldenTimer);
    const total = DEMO_RAW.length;
    let step = 0;

    const advance = () => {
      step += 1;
      const live = step < total;
      // heartbeat: while live, ended_at = now so isLiveRecording() keeps the debrief in live mode
      const session = { ...DEMO_SESSION, ended_at: live ? new Date().toISOString() : DEMO_SESSION.ended_at };
      const base = assembleReport(DEMO_RAW.slice(0, step), { session, golden: [] });
      get().ingestLiveReport({ ...base, recording: live });
      if (step === 1) get().switchSession(DEMO_ID); // land on the debrief, viewing the live session
      set({ demo: { phase: live ? "recording" : "resolved", n: step, total } });

      if (step >= total) {
        clearInterval(demoTick);
        demoTick = undefined;
        // the run is done and archived; a beat later "the writeup loads" and unlocks the comparison
        demoGoldenTimer = setTimeout(() => {
          get().applyGoldenDag(DEMO_GOLDEN, { source: "0xdf", confidence: 0.92 });
          set({ demo: { phase: "compared", n: total, total } });
        }, DEMO_GOLDEN_DELAY_MS);
      }
    };

    set({ view: "debrief", demo: { phase: "recording", n: 0, total } });
    demoTick = setInterval(advance, DEMO_TICK_MS);
    advance(); // fire the first command immediately
  },

  setTrim: (range) => {
    set({ trimSeq: range, ...derive(applyTrim(get().fullReport, range)), ...RESET });
  },
  clearTrim: () => get().setTrim(null),

  hover: (seq) => {
    const t = seq == null ? get().playheadMs : (get().timeline.bySeq.get(seq)?.t0 ?? get().playheadMs);
    set({ hoveredSeq: seq, playheadMs: t });
  },
  select: (seq) => {
    const it = seq == null ? null : get().timeline.bySeq.get(seq);
    set({ selectedSeq: seq, playheadMs: it ? it.t0 : get().playheadMs });
  },
  reveal: (seq) => {
    const it = get().timeline.bySeq.get(seq);
    set({ selectedSeq: seq, playheadMs: it ? it.t0 : get().playheadMs, revealSeq: seq, revealNonce: get().revealNonce + 1 });
  },
  setZoom: (win) => set({ zoomWin: win }),
  scrub: (ms) => set({ playheadMs: Math.max(0, Math.min(get().timeline.totalMs, ms)) }),
  setPlaying: (p) => set({ playing: p }),
}));

/** The episode currently under the playhead (the one the DVR is "showing"). */
export function episodeAtPlayhead(state: ReportState): number | null {
  const { items } = state.timeline;
  const t = state.playheadMs;
  // The item whose window has most recently opened at time t. Don't `break` on the first future item:
  // with a tapped SSH sub-session, items aren't strictly time-ordered by seq, so an early break would
  // stop at an out-of-order gap and highlight the wrong command.
  let seq: number | null = null;
  let best = -Infinity;
  for (const it of items) {
    if (it.gapStart <= t && it.gapStart >= best) {
      best = it.gapStart;
      seq = it.ep.seq;
    }
  }
  return seq;
}

/** Selection wins over hover for "what is the user focused on". */
export const activeSeq = (s: Pick<ReportState, "selectedSeq" | "hoveredSeq">): number | null =>
  s.selectedSeq ?? s.hoveredSeq;
