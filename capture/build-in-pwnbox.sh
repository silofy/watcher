#!/usr/bin/env bash
#
# Build the Watcher capture agent INSIDE Pwnbox (Parrot OS) and print how to use it.
#
# Prereq: the `capture/` and `core/` crate folders, in their original relative layout
# (capture/Cargo.toml references ../core). Get them into Pwnbox however you like — HTB's file
# transfer, a private git clone, or scp from your host.
#
#   chmod +x build-in-pwnbox.sh && ./build-in-pwnbox.sh
#
set -euo pipefail

# 1. Rust toolchain (Pwnbox has internet; this is a no-op if cargo is already present).
if ! command -v cargo >/dev/null 2>&1; then
  echo "[*] Installing Rust (rustup)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[*] Building watcher-capture (release)…"
cargo build --release --manifest-path "$HERE/Cargo.toml"

BIN="$HERE/target/release/watcher-capture"
echo
echo "[+] Built: $BIN"
echo
echo "    Capture a box (hack as normal, type 'exit' to finish):"
echo "      $BIN --export ~/session.json --machine <Name> --os <Linux|Windows> --difficulty <Easy|Medium|Hard>"
echo
echo "    Then download ~/session.json to your PC and drop it into:"
echo "      ~/.watcher/sessions/      (Windows: %USERPROFILE%\\.watcher\\sessions\\)"
echo "    It appears in The Watcher's History as a graded debrief."
