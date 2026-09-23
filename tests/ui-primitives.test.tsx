import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Section, Tag, TallyKey } from "../src/components/ui";

describe("Section", () => {
  it("numbers the eyebrow and leads with one figure", () => {
    const html = renderToStaticMarkup(
      <Section title="Phase audit" num="02" lead={{ value: 3, unit: "/3", caption: "phases at full efficiency" }}>
        <p>body</p>
      </Section>,
    );
    expect(html).toMatch(/02<\/span>Phase audit/);
    expect(html).toContain(">3<");
    expect(html).toContain("/3");
    expect(html).toContain("phases at full efficiency");
  });

  it("keeps the subtitle for screen readers and as a tooltip, not as visible prose", () => {
    const html = renderToStaticMarkup(
      <Section title="Grade" subtitle="the explainable rubric">
        <p>x</p>
      </Section>,
    );
    expect(html).toContain('class="sr-only">the explainable rubric');
    expect(html).toContain('title="the explainable rubric"');
  });
});

describe("Tag and TallyKey", () => {
  it("renders a hairline mono tag in its colour", () => {
    const html = renderToStaticMarkup(<Tag color="var(--color-signal)">Clean</Tag>);
    expect(html).toContain("uppercase");
    expect(html).toContain("color:var(--color-signal)");
  });

  it("lists only non-zero counts", () => {
    const html = renderToStaticMarkup(
      <TallyKey items={[{ label: "Matched", count: 20, color: "a" }, { label: "Skipped", count: 0, color: "b" }]} />,
    );
    expect(html).toContain("Matched");
    expect(html).not.toContain("Skipped");
  });
});
