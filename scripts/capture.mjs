#!/usr/bin/env node
// npm run capture -- --machine <box>
// Builds the Rust capture agent if needed, then execs it with your args forwarded.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Passing any of these means the user chose a capture mode; otherwise we default to --attach
// so the shortest happy path is `npm run capture -- --machine <box>`.
export const MODE_FLAGS = ["--attach", "--export", "-i", "--interactive", "--forward"];

export function withDefaultMode(args) {
  return args.some((a) => MODE_FLAGS.includes(a)) ? args : ["--attach", ...args];
}

export function binaryRelPath(platform) {
  const exe = platform === "win32" ? "watcher-capture.exe" : "watcher-capture";
  return `crates/capture/target/release/${exe}`;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const crateDir = join(repoRoot, "crates", "capture");
const manifest = join(crateDir, "Cargo.toml");
const binPath = join(repoRoot, binaryRelPath(process.platform));

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    const m = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

function needsBuild() {
  if (!existsSync(binPath)) return true;
  try {
    return newestMtime(join(crateDir, "src")) > statSync(binPath).mtimeMs;
  } catch {
    return false;
  }
}

function ensureCargo() {
  const probe = spawnSync("cargo", ["--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    console.error(
      "[capture] Rust's `cargo` isn't on your PATH, so the capture agent can't be built.\n" +
      "          Install the toolchain (https://rustup.rs), then check with:  npm run doctor",
    );
    process.exit(1);
  }
}

function main() {
  const forwarded = withDefaultMode(process.argv.slice(2));
  if (needsBuild()) {
    ensureCargo();
    console.error("[capture] building the capture agent (first run or sources changed)…");
    const build = spawnSync("cargo", ["build", "--release", "--manifest-path", manifest], {
      stdio: "inherit",
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  // stdio inherited so the interactive PTY attach uses the real terminal.
  const child = spawn(binPath, forwarded, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// Run only when invoked directly (`node scripts/capture.mjs`), not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
