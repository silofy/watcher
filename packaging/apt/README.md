# apt packaging for `watcher-capture`

Make the capture agent installable with `apt` on Kali, Parrot / HTB Pwnbox and
Debian. Only the **agent** is packaged — it's pure Rust with no GUI/WebKit deps,
built static against musl, so one binary has **no runtime `Depends`** and runs on
any of them regardless of glibc version. The desktop app stays a separate download.

## What's here

| File | Role |
| --- | --- |
| `../../crates/capture/Cargo.toml` → `[package.metadata.deb]` | `cargo-deb` config (section, license, man page) |
| `../../crates/capture/watcher-capture.1` | man page shipped in the `.deb` |
| `../../build-deb.sh` | build one `.deb` locally (musl + `cargo deb`) |
| `conf/distributions` | reprepro config for the signed repo |
| `apt-repo.yml` | workflow that builds + signs + publishes the repo |

The `.deb`s themselves are built and attached to every release by
`.github/workflows/release.yml` (the Linux legs run `cargo deb`), so the repo
workflow just collects those assets — it never rebuilds Rust.

## Build one `.deb` locally

```sh
cargo install cargo-deb
./build-deb.sh                                   # amd64
TARGET=aarch64-unknown-linux-musl ./build-deb.sh # arm64 (needs a cross linker, e.g. `cross`)
sudo dpkg -i target/x86_64-unknown-linux-musl/debian/watcher-capture_*.deb
```

## Stand up the signed apt repo

GitHub Pages gives a repo one site, and `silofy/watcher`'s Pages already serves
the demos — so the repo lives in a **dedicated repo** (e.g. `silofy/watcher-apt`),
not here. One-time setup there:

1. Copy `apt-repo.yml` → `.github/workflows/apt-repo.yml` and `conf/distributions`
   → `conf/distributions` in the new repo.
2. Create a signing key and add its **armored private key** as the secret
   `APT_GPG_PRIVATE_KEY`:
   ```sh
   gpg --batch --quick-gen-key "The Watcher apt <you@example.com>" default sign never
   gpg --armor --export-secret-keys <keyid>   # paste into the repo secret
   ```
3. **Settings → Pages → Source = "GitHub Actions".**
4. Run the workflow (Actions → Run workflow). It pulls the latest `.deb`s from
   `silofy/watcher` releases, signs the repo, and publishes to
   `https://<owner>.github.io/<repo>/`. A daily schedule keeps it current; to
   publish the instant a release lands, have `silofy/watcher`'s release workflow
   send a `repository_dispatch` (type `watcher-release`) to the apt repo using a
   PAT with `contents: write` on it.

## Users install with

```sh
curl -fsSL https://<owner>.github.io/<repo>/watcher-archive-keyring.asc \
  | sudo tee /usr/share/keyrings/watcher.asc >/dev/null
echo "deb [signed-by=/usr/share/keyrings/watcher.asc] https://<owner>.github.io/<repo> stable main" \
  | sudo tee /etc/apt/sources.list.d/watcher.list
sudo apt update && sudo apt install watcher-capture
```

## Next: official Kali inclusion

The repo above is the "readily available" path with no gatekeeper. For Kali's
image, the follow-up is a **vendored Debian source package** (`debian/` dir +
`cargo vendor`, including the `watcher-core` crate) submitted as a *New Tool
Request* on `bugs.kali.org`. The same source package is the artifact for an
HTB/Pwnbox (Parrot) inclusion pitch.
