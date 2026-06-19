# Cross-compile watcher-capture to a Linux x86_64 binary from Windows (no WSL, no Docker).
#
# Uses cargo-zigbuild with zig as the cross-linker. The catch on this machine is the SPACE in the
# user-profile path ("Tiago Peter"): zig's linker breaks on unquoted spaced paths, so EVERY path the
# linker sees must be space-free. We arrange that with:
#   * a Rust toolchain + sysroot at C:\rust        (RUSTUP_HOME) — the sysroot is on the link line
#   * a zig copy at C:\zig                          (cargo-zigbuild's PATH fallback uses it)
#   * PYTHONNOUSERSITE=1                            (hide the spaced user-site `python -m ziglang`)
#   * CARGO_TARGET_DIR=C:\wbtarget                  (space-free build outputs)
#
# One-time setup (already done; re-run only if the machine is reset). With $env:RUSTUP_HOME="C:\rust":
#   rustup toolchain install stable --profile minimal
#   rustup target add x86_64-unknown-linux-gnu
#   cargo install cargo-zigbuild
#   pip install ziglang   # then copy <site-packages>\ziglang\*  ->  C:\zig

# NB: do NOT use $ErrorActionPreference="Stop" here — cargo writes warnings to stderr, which
# PowerShell would otherwise treat as a terminating error. We gate on $LASTEXITCODE instead.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$env:RUSTUP_HOME = "C:\rust"
$env:CARGO_TARGET_DIR = "C:\wbtarget"
$env:PYTHONNOUSERSITE = "1"
$env:Path = "C:\zig;$env:USERPROFILE\.cargo\bin;$env:Path"
Remove-Item Env:\ZIG_COMMAND -ErrorAction SilentlyContinue

& "$env:USERPROFILE\.cargo\bin\cargo.exe" zigbuild --release --target x86_64-unknown-linux-gnu --manifest-path "$here\Cargo.toml"
if ($LASTEXITCODE -ne 0) { throw "cross-build failed" }

$bin = "C:\wbtarget\x86_64-unknown-linux-gnu\release\watcher-capture"
$dist = Join-Path $here "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item $bin (Join-Path $dist "watcher-capture-linux-x86_64") -Force
Write-Host "[+] Linux binary -> $dist\watcher-capture-linux-x86_64"
Write-Host "    Transfer to Pwnbox, then: chmod +x watcher-capture-linux-x86_64 && ./watcher-capture-linux-x86_64 --export ..."
