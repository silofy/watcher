# Install the Watcher capture agent (Windows).
#
#   irm https://raw.githubusercontent.com/silofy/watcher/main/install.ps1 | iex
#
# Downloads the prebuilt binary from the latest GitHub release, verifies it against the release's
# SHA256SUMS, installs it as watcher-capture.exe and adds its folder to your user PATH. No admin.
#
#   $env:WATCHER_VERSION = "v0.1.0"   install a specific release instead of the latest
#   $env:WATCHER_BIN_DIR = "C:\tools" install somewhere other than %LOCALAPPDATA%\Programs\watcher
$ErrorActionPreference = "Stop"

$Repo    = "silofy/watcher"
$Asset   = "watcher-capture-windows-x86_64.exe"
$Version = if ($env:WATCHER_VERSION) { $env:WATCHER_VERSION } else { "latest" }
$BinDir  = if ($env:WATCHER_BIN_DIR) { $env:WATCHER_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\watcher" }

if (-not [Environment]::Is64BitOperatingSystem) { throw "watcher install: only 64-bit Windows has a prebuilt binary." }

$Base = if ($Version -eq "latest") { "https://github.com/$Repo/releases/latest/download" }
        else { "https://github.com/$Repo/releases/download/$Version" }

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("watcher-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host "Downloading $Asset ($Version)..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $Tmp "SHA256SUMS")

  $want = $null
  foreach ($line in Get-Content (Join-Path $Tmp "SHA256SUMS")) {
    $parts = $line -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Asset) { $want = $parts[0].ToLower() }
  }
  if (-not $want) { throw "watcher install: $Asset is not listed in SHA256SUMS" }
  $got = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLower()
  if ($want -ne $got) { throw "watcher install: checksum mismatch for $Asset (expected $want, got $got) - not installing" }
  Write-Host "Checksum verified."

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $Dest = Join-Path $BinDir "watcher-capture.exe"
  Move-Item -Force (Join-Path $Tmp $Asset) $Dest
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $UserPath) { $UserPath = "" }
if (-not (($UserPath -split ';') -contains $BinDir)) {
  [Environment]::SetEnvironmentVariable("Path", (($UserPath.TrimEnd(';') + ";$BinDir").TrimStart(';')), "User")
  $env:Path += ";$BinDir"
  Write-Host "Added $BinDir to your user PATH (new terminals pick it up)."
}

Write-Host ""
Write-Host "Installed: $Dest"
Write-Host ""
Write-Host "Capture a run (hack as normal, type 'exit' to finish):"
Write-Host "  watcher-capture --attach --platform htb --target <box>"
