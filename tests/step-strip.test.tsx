import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StepStrip, stepCells } from "../src/components/StepStrip";

describe("stepCells", () => {
  it("gives one cell per step when total is at or below the cap", () => {
    const cells = stepCells(5, 12, 30);
    expect(cells).toHaveLength(30);
    expect(cells[4]).toBe("unlock"); // step 5
    expect(cells[11]).toBe("acted"); // step 12
    expect(cells.filter((k) => k === "gap")).toHaveLength(6); // steps 6-11
    expect(cells.filter((k) => k === "track")).toHaveLength(30 - 1 - 1 - 6);
  });

  it("buckets a long run into at most 60 cells with exactly one unlock and one acted cell", () => {
    const cells = stepCells(5, 190, 200);
    expect(cells).toHaveLength(60);
    expect(cells.filter((k) => k === "unlock")).toHaveLength(1);
    expect(cells.filter((k) => k === "acted")).toHaveLength(1);
    expect(cells.filter((k) => k === "gap").length).toBeGreaterThan(0);
  });

  it("gives the acted cell priority when unlock and acted fall in the same bucket", () => {
    const cells = stepCells(101, 102, 200);
    const acted = cells.filter((k) => k === "acted");
    const unlock = cells.filter((k) => k === "unlock");
    expect(acted).toHaveLength(1);
    expect(unlock).toHaveLength(0);
  });
});

describe("StepStrip", () => {
  it("renders an accessible figure with the unlock/acted step numbers and a bucketed strip", () => {
    const html = renderToStaticMarkup(<StepStrip unlock={5} acted={190} total={200} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("Unlocked at step 5, acted at step 190");
    expect(html).toContain("Step 5");
    expect(html).toContain("Step 190");
    // one <i> per bucketed cell, capped at 60 rather than one per step
    expect((html.match(/<i class="block"/g) ?? []).length).toBe(60);
  });

  it("renders one cell per step for a short run", () => {
    const html = renderToStaticMarkup(<StepStrip unlock={2} acted={4} total={10} />);
    expect((html.match(/<i class="block"/g) ?? []).length).toBe(10);
  });
});
