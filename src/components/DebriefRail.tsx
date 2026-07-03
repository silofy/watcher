import { useReport } from "../store/report";
import { IdentityBar } from "./IdentityBar";
import { Assessment } from "./Assessment";
import { tierColor } from "./ui";
import { fmtMinutes } from "../lib/format";

/** One cell of the key-numbers tri-tile — coverage / efficiency / stealth, tinted by its quality tier
 *  (the same `tierColor` scale every gauge/readout in the report already uses). Pure display: no metric
 *  computed here, only `metrics` values the pipeline already produced. */
function KeyNumber({ label, value }: { label: string; value: number }) {
  const v = Math.round(value);
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-edge bg-panel py-2.5">
      <span className="font-display text-xl font-bold tabular-nums leading-none" style={{ color: tierColor(v) }}>
        {v}
      </span>
      <span className="label text-faint">{label}</span>
    </div>
  );
}

/** "vs the Ghost" mini — human wins + time lost, straight off `report.ghost`. Renders nothing when the
 *  report carries no golden tree (no write-up ever diffed) — same guard `GhostCard` itself uses. */
function GhostMini() {
  const ghost = useReport((s) => s.report.ghost);
  const items = ghost?.items ?? [];
  if (!items.length) return null;
  const wins = ghost?.human_wins ?? 0;
  const lostMs = ghost?.time_lost_ms ?? 0;
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2.5 text-xs text-muted">
      <span className="text-fg">
        <span style={{ color: "var(--color-flag)" }}>⚑</span> {wins} win{wins === 1 ? "" : "s"} · {fmtMinutes(lostMs)} lost
      </span>{" "}
      <span className="text-faint">vs the Ghost</span>
    </div>
  );
}

/**
 * The debrief's sticky left rail — identity + rooted status, the grade + 8-dim radar, key numbers, and
 * a ghost-mini (§1 of the redesign spec). Composes `IdentityBar` and `Assessment` whole and unmodified
 * in behavior (only Assessment's own always-collapsed accordion wrapper was dropped so the grade shows
 * settled here rather than closed by default — see Assessment.tsx); no metric/grade logic lives here,
 * only the key-numbers tri-tile's display, which reads already-computed `metrics` fields.
 *
 * Sticky at `lg:` and up, matching the header's approximate height (`top-20`, the same offset the
 * report already uses for in-page scroll targets via `scroll-mt-20`). Below `lg:`, the caller renders
 * this as a normal (non-sticky) block that stacks above the main column — see App.tsx.
 *
 * The stack (identity + radar + rubric table + key numbers + ghost-mini) can plausibly exceed a
 * laptop viewport's height; a sticky element taller than the viewport pins in place and hides
 * whatever falls past the fold. `lg:max-h-[calc(100vh-5rem)]` (5rem == `top-20`) caps it to what's
 * actually visible below the sticky offset, and `lg:overflow-y-auto` lets the rail itself scroll
 * internally rather than clipping content — only at `lg:`, where it's sticky in the first place.
 */
export function DebriefRail() {
  const { metrics } = useReport();
  return (
    <aside
      aria-label="Target identity and verdict"
      className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1"
    >
      <IdentityBar variant="rail" />
      <Assessment />
      <div className="flex gap-2">
        <KeyNumber label="Coverage" value={metrics.objective_coverage_pct} />
        <KeyNumber label="Efficiency" value={metrics.efficiency_pct} />
        <KeyNumber label="Stealth" value={metrics.stealth_score} />
      </div>
      <GhostMini />
    </aside>
  );
}
