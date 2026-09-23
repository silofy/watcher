import { describe, it, expect } from "vitest";
import { pickOneLesson } from "./one-lesson";
import type { WatcherReport } from "../types/report";

const withGhost = (items: unknown[]) => ({ ghost: { items } }) as unknown as WatcherReport;

describe("pickOneLesson pivot", () => {
  it("exposes the worst late pivot's unlock and action steps", () => {
    const lesson = pickOneLesson(
      withGhost([
        { objective: "a", verdict: "late_pivot", unlock_seq: 5, actual_seq: 11, lag_ms: 1000 },
        { objective: "b", verdict: "late_pivot", unlock_seq: 5, actual_seq: 30, lag_ms: 9000 },
      ]),
    );
    expect(lesson?.pivot).toEqual({ unlock_seq: 5, acted_seq: 30 });
    expect(lesson?.evidence_seq).toBe(30);
  });

  it("omits the pivot when a step is missing", () => {
    const lesson = pickOneLesson(withGhost([{ objective: "a", verdict: "late_pivot", unlock_seq: null, actual_seq: 9, lag_ms: 1 }]));
    expect(lesson?.pivot).toBeUndefined();
  });
});
