import { describe, it, expect } from "vitest";
import { withDefaultMode, binaryRelPath, MODE_FLAGS } from "../scripts/capture.mjs";

describe("capture wrapper arg handling", () => {
  it("injects --attach when no mode flag is present", () => {
    expect(withDefaultMode(["--machine", "Blue"])).toEqual(["--attach", "--machine", "Blue"]);
  });

  it("leaves args untouched when a mode flag is present", () => {
    expect(withDefaultMode(["--export", "x.json", "--machine", "Blue"]))
      .toEqual(["--export", "x.json", "--machine", "Blue"]);
    expect(withDefaultMode(["--attach", "--machine", "Blue"]))
      .toEqual(["--attach", "--machine", "Blue"]);
  });

  it("treats every documented mode flag as a mode", () => {
    expect(MODE_FLAGS).toEqual(expect.arrayContaining(["--attach", "--export", "-i", "--interactive", "--forward"]));
  });

  it("resolves the platform binary path", () => {
    expect(binaryRelPath("win32")).toBe("crates/capture/target/release/watcher-capture.exe");
    expect(binaryRelPath("linux")).toBe("crates/capture/target/release/watcher-capture");
  });
});
