/**
 * Prerequisite check for the desktop app (`npm run tauri dev` / `tauri build`).
 *
 * Runs automatically as the `pretauri` npm hook, and standalone via `npm run doctor`.
 * It reports what's present, and for anything missing prints the exact command to fix it,
 * then exits non-zero if a hard requirement is absent — so `tauri` never falls through to a
 * cryptic `cargo`/webkit error like `failed to run 'cargo metadata' … (os error 2)`.
 *
 * Node is the only thing guaranteed here (npm ran us), so this stays dependency-free.
 */
import { execSync } from "node:child_process";
import { platform } from "node:os";

const os = platform(); // 'linux' | 'darwin' | 'win32'
const tty = process.stdout.isTTY;
const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ok = (s) => `${paint("32", "✓")} ${s}`;
const bad = (s) => `${paint("31", "✗")} ${s}`;
const note = (s) => paint("2", `• ${s}`);
const fix = (s) => paint("2", `    Install:  ${s}`);

/** True if the command runs (exit 0). Any failure — missing binary included — is false. */
function runs(cmd) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const RUSTUP = `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh && source "$HOME/.cargo/env"`;
const APT = `sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`;

const missing = [];

console.log("\nThe Watcher — desktop prerequisites\n");
console.log(ok(`Node ${process.version}`));

// Rust — a hard requirement on every platform (Tauri, plus the capture/store/daemon crates).
if (runs("cargo --version") && runs("rustc --version")) {
  console.log(ok("Rust toolchain (cargo, rustc)"));
} else {
  console.log(bad("Rust toolchain not found (cargo/rustc)"));
  console.log(fix(os === "win32" ? "https://rustup.rs  (run rustup-init.exe, then reopen the shell)" : RUSTUP));
  missing.push("Rust");
}

// Platform desktop libraries.
if (os === "linux") {
  // Tauri v2 needs webkit2gtk-4.1. pkg-config may itself be absent — if so we can't verify,
  // so warn rather than block on uncertainty (a real miss surfaces at build time with the fix in hand).
  if (!runs("pkg-config --version")) {
    console.log(note("Can't verify desktop libs (pkg-config not installed). If the build fails on webkit, run:"));
    console.log(fix(APT));
  } else if (runs("pkg-config --exists webkit2gtk-4.1")) {
    console.log(ok("Desktop libs (webkit2gtk-4.1)"));
  } else {
    console.log(bad("Desktop libs missing (webkit2gtk-4.1 and friends)"));
    console.log(fix(APT));
    missing.push("WebKit/GTK libs");
  }
} else if (os === "darwin") {
  if (runs("xcode-select -p")) {
    console.log(ok("Xcode Command Line Tools"));
  } else {
    console.log(bad("Xcode Command Line Tools not found"));
    console.log(fix("xcode-select --install"));
    missing.push("Xcode CLT");
  }
} else if (os === "win32") {
  console.log(note("Windows also needs Microsoft C++ Build Tools + WebView2 (preinstalled on Win11)."));
  console.log(paint("2", "    See:  https://tauri.app/start/prerequisites/"));
}

if (missing.length) {
  console.log(`\n${bad(`Missing: ${missing.join(", ")}. Install the above, then re-run.`)}`);
  console.log(note("Just want the graded report in a browser (no desktop build)?  npm run dev\n"));
  process.exit(1);
}

console.log(`\n${ok("All set — starting the desktop app.")}\n`);
