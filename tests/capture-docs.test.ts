import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

// Every place that tells a user how to capture — installed app users have no repo checkout, so
// these must lead with the one-line installer, never with repo-relative paths.
const surfaces = ["README.md", "crates/capture/CAPTURE.md", "src/components/Install.tsx", "src/components/Onboarding.tsx"];
const INSTALL_SH = "https://raw.githubusercontent.com/silofy/watcher/main/install.sh";

describe("capture setup surfaces lead with the one-line installer", () => {
  for (const rel of surfaces) {
    it(`${rel} documents install.sh and the installed watcher-capture command`, () => {
      const text = read(rel);
      expect(text).toContain(INSTALL_SH);
      expect(text).toMatch(/watcher-capture --(attach|export)/);
    });

    it(`${rel} never points at the old repo-only binary path`, () => {
      expect(read(rel)).not.toContain("crates/capture/dist/");
    });
  }

  it("the installers the docs point at exist at the repo root", () => {
    expect(existsSync(resolve(root, "install.sh"))).toBe(true);
    expect(existsSync(resolve(root, "install.ps1"))).toBe(true);
  });

  it("install.sh and the release workflow agree on asset names", () => {
    const sh = read("install.sh");
    const release = read(".github/workflows/release.yml");
    for (const asset of ["watcher-capture-linux-x86_64", "watcher-capture-linux-aarch64", "watcher-capture-macos-universal"]) {
      expect(sh).toContain(asset);
      expect(release).toContain(asset);
    }
    expect(read("install.ps1")).toContain("watcher-capture-windows-x86_64.exe");
    expect(release).toContain("watcher-capture-windows-x86_64.exe");
  });
});
