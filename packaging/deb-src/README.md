# Debian source package — `watcher-capture`

The artifact for getting the capture agent into **Kali** (a *New Tool Request*),
and the same package installs on **Parrot / HTB Pwnbox**. Unlike the binary `.deb`
([`../apt/`](../apt/)), this builds **from source, offline**, which is what Debian
and Kali build daemons require.

Only the agent is packaged — it's pure Rust, no GUI/WebKit. The source tree is just
two crates (`watcher-capture` + the `watcher-core` lib it path-depends on) plus the
vendored dependency graph.

## Build it (on Debian/Kali)

```sh
sudo apt-get install -y build-essential debhelper devscripts dpkg-dev cargo rustc lintian
packaging/deb-src/make-source.sh
```

This produces, in a temp dir it prints: the `.dsc`, `.orig.tar.xz`,
`.debian.tar.xz`, the built `.deb`, and a `.changes`. Check it with `lintian` and
test with `sudo dpkg -i`.

## What's in `debian/`

| File | Role |
| --- | --- |
| `control` | source + binary package metadata; `Depends` is auto (`${shlibs:Depends}` — empty for the static binary) |
| `rules` | offline `cargo build` of `crates/capture`, installs the binary; no root Cargo.toml so debhelper doesn't fight it |
| `changelog` | `0.1.0-1` initial packaging |
| `copyright` | DEP-5: the Watcher crates are AGPL-3.0; **the `vendor/*` stanza is a placeholder** |
| `source/format` | `3.0 (quilt)` |
| `manpages` | installs `watcher-capture.1` |
| `watch` | tracks upstream tags |

## Before submitting to Kali

1. **Expand `debian/copyright`.** Kali/Debian require every bundled crate's licence
   recorded. Generate the list with `cargo license` (or `cargo deny`) and write one
   stanza per distinct licence, replacing the `vendor/*` placeholder.
2. Run `lintian` and fix findings.
3. File the request on `bugs.kali.org` → *New Tool Requests* with: homepage, licence
   (AGPL-3.0, free to redistribute), dependencies, **similar tools: none — it grades
   operator methodology, not findings**, dev activity, and the build/usage above.

Repo inclusion (`apt install` from Kali) is the realistic first outcome; inclusion in
the default image (`kali-linux-default`) is a later, adoption-gated step.
