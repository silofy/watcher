import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";

/**
 * Smoke test: render the whole report to static markup. Executes every section's
 * render path against the real fixture, catching crashes without a browser. This
 * is also the seam the portable HTML export (brief §6.3) builds on — pre-rendered
 * static markup that is readable with JS disabled.
 */
describe("report renders end-to-end", () => {
  const html = renderToStaticMarkup(<App />);

  it("produces markup", () => {
    expect(html.length).toBeGreaterThan(2000);
  });

  it("includes the core report sections", () => {
    for (const title of [
      "The Watcher",
      "How the run unfolded",
      "Stealth &amp; Noise",
      "Command Log",
      "do differently",
      "Phase audit",
      "explainable rubric",
    ]) {
      expect(html).toContain(title);
    }
  });

  it("renders the new layout's hero, Findings, and Session window sections", () => {
    // The hero — the single evidence-backed takeaway, led big above the fold (see HeroLesson).
    expect(html).toContain("The one lesson");
    // The Deep dive's Findings and Timeline tabs stay mounted (just visually `hidden`), so their
    // labels are always in the static markup regardless of which tab is active.
    expect(html).toContain("Findings");
    expect(html).toContain("Timeline");
    // The Session window accordion (SessionFacts + TrimControl), collapsed by default.
    expect(html).toContain("Session window");
  });

  // Note (follow-up, not covered here): the bundled htb-easy fixture predates schema v1.4's
  // `ghost` field, so GhostCard's own render path (report.ghost present, human_wins/time_lost_ms
  // copy, the per-objective verdict list) never executes in the App render above. Injecting a
  // ghost via `useReport.setState(...)` before an SSR render doesn't exercise it either: zustand
  // v5's `useStore` passes `getServerSnapshot: () => selector(api.getInitialState())` to
  // `useSyncExternalStore`, and `renderToStaticMarkup` is treated as a server render — so it
  // always reads the store's snapshot frozen at module load, never a runtime `setState`. Testing
  // GhostCard's populated path needs either a bundled ghost-bearing fixture or a jsdom render
  // (client snapshot path) rather than `renderToStaticMarkup` against the raw store.

  it("renders the machine identity, platform, verdict, and command log", () => {
    expect(html).toContain("Abducted"); // the default demo's identity in the verdict band
    expect(html).toContain("Hack The Box"); // correctly identified platform (not mislabeled)
    expect(html).toContain("System flag");
    expect(html).toContain("rpcclient"); // a real command from the run's command log
  });

  it("renders the skipped objective from the golden DAG", () => {
    expect(html).toContain("never attempted");
  });
});
