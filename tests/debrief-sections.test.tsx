import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { useReport } from "../src/store/report";
import { computeGrade } from "../src/lib/bridge/grade";

describe("debrief sections", () => {
  const html = renderToStaticMarkup(<App />);

  // Assessment's own slice of the markup: from its `data-shot="grade"` anchor to the next
  // `data-shot=` marker in reading order (Evidence & detail's summary comes right after it in
  // App.tsx). Scoping to this slice keeps the rubric assertions below from passing by accident —
  // counting meters or letters that belong to a different section (ScoreReadout tiles in the
  // verdict band, PhaseAudit's PhaseLevel, PivotStrip, StealthReport's ranked bars).
  const gradeStart = html.indexOf('data-shot="grade"');
  const nextShotStart = html.indexOf("data-shot=", gradeStart + 1);
  const gradeHtml = html.slice(gradeStart, nextShotStart === -1 ? html.length : nextShotStart);

  it("leads the grade with its letter and score", () => {
    expect(gradeHtml).toMatch(/weighted across \d rubric metrics/);

    // the lead figure's big number is the grade letter itself, read straight from the same
    // computeGrade the SSR render reads (renderToStaticMarkup uses the store's initial snapshot).
    const grade = computeGrade(useReport.getState().report);
    const leadIdx = gradeHtml.indexOf("text-[40px]");
    expect(leadIdx).toBeGreaterThan(-1);
    const afterTag = gradeHtml.slice(leadIdx);
    const content = afterTag.slice(afterTag.indexOf(">") + 1);
    expect(content.startsWith(grade.letter)).toBe(true);
  });

  it("draws every rubric metric as a level meter", () => {
    const meterCount = (gradeHtml.match(/role="meter"/g) ?? []).length;
    // each rubric row's metric name carries exactly one hover-card tooltip — an independent count
    // of "how many rubric rows actually rendered" that doesn't rely on a hardcoded axis count (v1
    // reports carry 6 rubric dimensions, v2 carry 8).
    const rubricRowCount = (gradeHtml.match(/role="tooltip"/g) ?? []).length;
    expect(rubricRowCount).toBeGreaterThanOrEqual(6);
    expect(meterCount).toBe(rubricRowCount);
  });

  it("numbers the sections in reading order", () => {
    const i01 = html.indexOf(">01<");
    const i02 = html.indexOf(">02<");
    expect(i01).toBeGreaterThan(-1);
    expect(i02).toBeGreaterThan(i01);
  });
});
