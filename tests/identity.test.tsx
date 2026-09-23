import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";
import { DifficultyPips } from "../src/components/IdentityBar";

describe("identity metadata", () => {
  it("lights one pip per difficulty level", () => {
    expect(renderToStaticMarkup(<DifficultyPips label="Easy" color="c" />).match(/data-on="true"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<DifficultyPips label="Hard" color="c" />).match(/data-on="true"/g)).toHaveLength(3);
    expect(renderToStaticMarkup(<DifficultyPips label="Insane" color="c" />).match(/data-on="true"/g)).toHaveLength(4);
  });

  it("gives both score tiles a level meter", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('aria-label="Stealth');
    expect(html).toContain('aria-label="Grade');
  });
});
