import { describe, it, expect } from "vitest";
import { asciiField, asciiChar, HEADER_MASK, EMPTY_MASK, ASCII_RAMP } from "./ascii";

describe("ascii field", () => {
  it("maps the field into the ramp", () => {
    expect(asciiChar(0)).toBe(" ");
    expect(asciiChar(1)).toBe("@");
    expect(ASCII_RAMP).toHaveLength(13);
  });

  it("stays within 0..1", () => {
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
      const v = asciiField(i / 10, j / 10, 3.7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the header field out from behind the content and fades it downward", () => {
    expect(HEADER_MASK(0.5, 0)).toBe(0);
    expect(HEADER_MASK(0.02, 0)).toBeGreaterThan(0.5);
    expect(HEADER_MASK(0.02, 0.9)).toBeLessThan(HEADER_MASK(0.02, 0));
  });

  it("keeps the empty-state field to the box edges", () => {
    expect(EMPTY_MASK(0.5, 0.5)).toBe(0);
    expect(EMPTY_MASK(0, 0)).toBeGreaterThan(0);
  });
});
