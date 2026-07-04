import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useReport } from "../store/report";
import { DEEP_DIVE_TABS, type DeepDiveTabId } from "../lib/deep-dive";
import { AttackTimeline } from "./AttackTimeline";
import { StealthReport } from "./StealthReport";
import { DeviationTimeline } from "./DeviationTimeline";
import { FrameworkAxes } from "./FrameworkAxes";
import { Findings } from "./Findings";
import { CommandReplay } from "./CommandReplay";

// Every tab's content stays mounted (`hidden` toggles visibility instead of unmounting) — the
// report's static-HTML export renders every section's markup up front with no JS, so a tab whose
// content only existed while active would vanish from that export.
const PANELS: Record<DeepDiveTabId, ReactNode> = {
  timeline: <AttackTimeline />,
  stealth: <StealthReport />,
  deviation: <DeviationTimeline />,
  frameworks: <FrameworkAxes />,
  findings: <Findings />,
  log: (
    <div id="log">
      <CommandReplay />
    </div>
  ),
};

/** The debrief's "Deep dive" — one tabbed panel replacing the old one-at-a-time accordion stack.
 *  Each tab renders its detail view directly (no inner Collapse); the whole panel scrolls the wide
 *  charts internally rather than the page. A `reveal()` (deep-link from a coaching card, a technique
 *  chip, …) always surfaces in the command log, so it flips the active tab to "log". */
export function DeepDive() {
  const revealNonce = useReport((s) => s.revealNonce);
  const [active, setActive] = useState<DeepDiveTabId>("timeline");
  const tabRefs = useRef<Map<DeepDiveTabId, HTMLButtonElement>>(new Map());
  const logPanelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setActive("log");
    // The log tabpanel is still `hidden` in this same tick (this effect runs before the DOM
    // reflects the `active` state change on the next render). Wait a frame so the panel has
    // lost `display:none` before scrolling — otherwise scrollIntoView on a hidden element is a
    // no-op, which is the bug this effect exists to fix.
    const raf = requestAnimationFrame(() => {
      logPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [revealNonce]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % DEEP_DIVE_TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + DEEP_DIVE_TABS.length) % DEEP_DIVE_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DEEP_DIVE_TABS.length - 1;
    if (next == null) return;
    e.preventDefault();
    const tab = DEEP_DIVE_TABS[next];
    setActive(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  return (
    <div id="deep-dive">
      <div role="tablist" aria-label="Deep dive" className="flex flex-wrap gap-1 border-b border-edge">
        {DEEP_DIVE_TABS.map((t, i) => {
          const selected = active === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
              }}
              type="button"
              role="tab"
              id={`deep-dive-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`deep-dive-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`label -mb-px rounded-t px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/60 ${
                selected ? "border-b-2 border-signal text-fg" : "border-b-2 border-transparent text-faint hover:text-muted"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {DEEP_DIVE_TABS.map((t) => (
        <div
          key={t.id}
          ref={t.id === "log" ? logPanelRef : undefined}
          id={`deep-dive-panel-${t.id}`}
          data-shot={`deepdive-${t.id}`}
          role="tabpanel"
          aria-labelledby={`deep-dive-tab-${t.id}`}
          hidden={active !== t.id}
          tabIndex={0}
          className="overflow-x-auto pt-3"
        >
          {PANELS[t.id]}
        </div>
      ))}
    </div>
  );
}
