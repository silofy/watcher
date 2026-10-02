#!/usr/bin/env bash
# Build a static (musl) .deb for the watcher-capture agent.
#
# The agent is pure Rust with no GUI/WebKit dependencies, so a musl-static build
# yields ONE binary with no runtime Depends that runs on Kali, Parrot / HTB Pwnbox
# and plain Debian regardless of their glibc version. Only the agent is packaged;
# the Tauri desktop app stays a separate download.
#
# Prerequisites (run on Linux):
#   rustup                                   # https://rustup.rs
#   cargo install cargo-deb                  # the packager
#   # amd64 is built out of the box. For arm64, cross-compiling musl needs a
#   # cross linker — easiest is `cargo install cross` and TARGET below.
#
# Usage:
#   ./build-deb.sh                           # amd64 (x86_64-unknown-linux-musl)
#   TARGET=aarch64-unknown-linux-musl ./build-deb.sh   # arm64 (needs a cross linker)
#
# Output: target/<triple>/debian/watcher-capture_<version>_<arch>.deb
set -euo pipefail
cd "$(dirname "$0")"

TARGET="${TARGET:-x86_64-unknown-linux-musl}"

command -v rustup   >/dev/null 2>&1 || { echo "error: rustup not found — see https://rustup.rs" >&2; exit 1; }
command -v cargo-deb >/dev/null 2>&1 || { echo "error: cargo-deb not found — run: cargo install cargo-deb" >&2; exit 1; }

echo ">> target: $TARGET"
rustup target add "$TARGET" >/dev/null

# cargo-deb builds the release binary for the given target and assembles the .deb
# (the binary is taken from [[bin]] automatically; Cargo.toml's [package.metadata.deb]
# adds the man page, license and metadata).
cargo deb -p watcher-capture --target "$TARGET"

echo
echo ">> built:"
find "target/$TARGET/debian" -maxdepth 1 -name '*.deb' -printf '   %p\n'
echo
echo "   inspect:  dpkg-deb -I   target/$TARGET/debian/*.deb"
echo "   contents: dpkg-deb -c   target/$TARGET/debian/*.deb"
echo "   install:  sudo dpkg -i  target/$TARGET/debian/*.deb"
