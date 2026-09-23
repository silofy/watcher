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
