#!/usr/bin/env bash
# Assemble and build the Debian SOURCE package for watcher-capture — the artifact
# for a Kali "New Tool Request" (and an HTB/Pwnbox/Parrot inclusion pitch).
#
# It builds a minimal upstream tree (the agent + the watcher-core lib it
# path-depends on + the licence), VENDORS the whole crate graph so the build is
# fully offline (as Debian/Kali build daemons require), drops in debian/, and runs
# dpkg-buildpackage. Run on a Debian/Kali host.
#
# Prereqs:
#   sudo apt-get install -y build-essential debhelper devscripts dpkg-dev cargo rustc lintian
#   # optional, to expand debian/copyright into one stanza per crate licence:
#   cargo install --locked cargo-license
#
# Usage:  packaging/deb-src/make-source.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cd "$repo"

PKG=watcher-capture
VERSION=0.1.0
BUILD="$(mktemp -d)"
SRC="$BUILD/${PKG}-${VERSION}"
mkdir -p "$SRC/crates"

# minimal upstream source: the agent, the core lib it path-depends on, the licence
cp -r crates/capture "$SRC/crates/capture"
cp -r crates/core    "$SRC/crates/core"
cp LICENSE           "$SRC/LICENSE"
rm -rf "$SRC"/crates/*/target "$SRC"/crates/*/dist

# vendor the full dependency graph for an offline, --locked build
( cd "$SRC"
  mkdir -p .cargo
  cargo vendor --manifest-path crates/capture/Cargo.toml --locked vendor > .cargo/config.toml )

# pristine upstream tarball (no debian/ inside), next to the source dir
tar -C "$BUILD" --exclude="${PKG}-${VERSION}/debian" \
    -caf "$BUILD/${PKG}_${VERSION}.orig.tar.xz" "${PKG}-${VERSION}"

# drop in the packaging and build the source + binary packages
cp -r "$here/debian" "$SRC/debian"
( cd "$SRC" && dpkg-buildpackage -us -uc )

echo
echo ">> artifacts in: $BUILD"
ls -1 "$BUILD"
echo
echo "   lint:    lintian $BUILD/${PKG}_${VERSION}-1_*.changes"
echo "   install: sudo dpkg -i $BUILD/${PKG}_${VERSION}-1_*.deb"
