import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PivotStrip } from "../src/components/PivotStrip";
import type { GhostItem } from "../src/types/report";

const items: GhostItem[] = [
  { objective: "enumerate_services", verdict: "ahead", unlock_seq: 1, actual_seq: 1 },
  { objective: "read_rclone_config", verdict: "late_pivot", unlock_seq: 5, actual_seq: 15, lag_ms: 60_000 },
  { objective: "audit_share_permissions", verdict: "skipped", unlock_seq: 1, actual_seq: null },
];

describe("PivotStrip", () => {
  const html = renderToStaticMarkup(<PivotStrip items={items} total={30} notes={new Map()} onReveal={() => {}} />);

  it("draws one focusable row per objective with a readable label", () => {
    expect(html.match(/role="listitem"/g)).toHaveLength(3);
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
    expect(html).toContain("Read rclone config");
  });

  it("fills late-pivot and skipped spans with dither patterns", () => {
    expect(html).toMatch(/fill="url\(#[^)]*late\)"/);
    expect(html).toMatch(/fill="url\(#[^)]*skip\)"/);
  });

  it("puts each row's explanation in its accessible name", () => {
    expect(html).toContain("Late pivot. Open from step 5, done at step 15 · 1 min later");
  });
});
