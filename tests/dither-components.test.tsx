import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LevelBar, DitherPattern, GradientDitherPattern } from "../src/components/dither";

describe("LevelBar", () => {
  it("is an accessible meter with the value as a percentage width", () => {
    const html = renderToStaticMarkup(<LevelBar value={86} color="red" label="Stealth" />);
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="86"');
    expect(html).toContain('aria-label="Stealth"');
    expect(html).toContain("width:86%");
    expect(html).toContain("mask-image:url(");
  });

  it("clamps to the track and honours max", () => {
    expect(renderToStaticMarkup(<LevelBar value={140} color="red" label="x" />)).toContain("width:100%");
    expect(renderToStaticMarkup(<LevelBar value={5} max={10} color="red" label="x" />)).toContain("width:50%");
  });
});

describe("SVG dither patterns", () => {
  it("draws one rect per lit cell, scaled to user units", () => {
    const html = renderToStaticMarkup(
      <svg>
        <DitherPattern id="p" color="red" density={0.5} kx={2} ky={1} />
      </svg>,
    );
    expect(html.match(/<rect /g)).toHaveLength(8);
    expect(html).toContain('width="24"'); // 12px tile × kx 2
  });

  it("thins a gradient from top to bottom", () => {
    const html = renderToStaticMarkup(
      <svg>
        <GradientDitherPattern id="g" color="red" rows={8} top={1} bottom={0} />
      </svg>,
    );
    const ys = [...html.matchAll(/y="(\d+)"/g)].map((m) => Number(m[1]));
    const top = ys.filter((y) => y < 12).length;
    const bottom = ys.filter((y) => y >= 12).length;
    expect(top).toBeGreaterThan(bottom);
  });
});
