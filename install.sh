#!/bin/sh
# Install the Watcher capture agent (Linux / macOS / Pwnbox).
#
#   curl -fsSL https://raw.githubusercontent.com/silofy/watcher/main/install.sh | sh
#
# Downloads the prebuilt binary for this OS/CPU from the latest GitHub release, verifies it against
# the release's SHA256SUMS, and installs it as `watcher-capture`. No Rust toolchain, no root.
#
#   WATCHER_VERSION=v0.1.0      install a specific release instead of the latest
#   WATCHER_BIN_DIR=/some/dir   install somewhere other than ~/.local/bin
set -eu

REPO="silofy/watcher"
VERSION="${WATCHER_VERSION:-latest}"
BIN_DIR="${WATCHER_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
die() { printf 'watcher install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux)
    case "$(uname -m)" in
      x86_64 | amd64) ASSET="watcher-capture-linux-x86_64" ;;
      aarch64 | arm64) ASSET="watcher-capture-linux-aarch64" ;;
      *) die "no prebuilt binary for Linux $(uname -m) — build from source: https://github.com/$REPO#install" ;;
    esac ;;
  Darwin) ASSET="watcher-capture-macos-universal" ;;
  *) die "unsupported OS $(uname -s) — on Windows use install.ps1" ;;
esac

if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "needs curl or wget"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "needs sha256sum or shasum to verify the download"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Downloading $ASSET ($VERSION)…"
fetch "$BASE/$ASSET" "$TMP/$ASSET" || die "download failed: $BASE/$ASSET"
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "download failed: $BASE/SHA256SUMS"

want="$(awk -v f="$ASSET" '$2 == f || $2 == "*"f {print $1}' "$TMP/SHA256SUMS")"
[ -n "$want" ] || die "$ASSET is not listed in SHA256SUMS"
got="$(sha "$TMP/$ASSET")"
[ "$want" = "$got" ] || die "checksum mismatch for $ASSET (expected $want, got $got) — not installing"
say "Checksum verified."

mkdir -p "$BIN_DIR"
chmod 755 "$TMP/$ASSET"
mv "$TMP/$ASSET" "$BIN_DIR/watcher-capture"
mkdir -p "$HOME/.watcher-exports"  # where Pwnbox sync pulls finished runs from

say ""
say "Installed: $BIN_DIR/watcher-capture"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Note: $BIN_DIR isn't on your PATH. Add it with:"
     say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile && . ~/.profile" ;;
esac
say ""
say "Capture a run (hack as normal, type 'exit' to finish):"
say "  watcher-capture --export ~/.watcher-exports/run.json --platform htb --target <box>"
say ""
say "Then open it in the Watcher app, or let Pwnbox sync pull it in automatically."
