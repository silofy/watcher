import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { StepCapture } from "../src/components/Onboarding";

describe("setup has one entry point: the wizard", () => {
  it("has no Install tab", () => {
    expect(renderToStaticMarkup(<App />)).not.toMatch(/>Install</);
  });

  it("carries every Install-page section inside the wizard's capture step", () => {
    const html = renderToStaticMarkup(<StepCapture />);
    for (const s of ["All setup options", "On your own machine", "In Pwnbox", "live auto-pull", "Reference path", "AI-refined coaching"]) {
      expect(html).toContain(s);
    }
  });
});
