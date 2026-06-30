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

  it("renders the machine identity, verdict, and the 23-minute stall", () => {
    expect(html).toContain("Uploadr");
    expect(html).toContain("System flag");
    expect(html).toContain("23 min");
    expect(html).toContain("sudo -l");
  });

  it("renders the skipped objective from the golden DAG", () => {
    expect(html).toContain("never attempted");
  });
});
