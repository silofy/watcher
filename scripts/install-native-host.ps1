<#
  Registers the Watcher Native Messaging host so the browser extension can talk to the local
  daemon (brief section 3.3 / 5.4). Run AFTER loading the unpacked extension and copying its ID.

    powershell -File scripts/install-native-host.ps1 -ExtensionId <id> [-Browser Chrome|Edge]

  Writes a launcher + the host manifest (your extension as the only allowed origin) and the HKCU
  registry key Chrome/Edge reads. Build the daemon first:
    cargo build --manifest-path crates/daemon/Cargo.toml
#>
param(
  [Parameter(Mandatory = $true)][string]$ExtensionId,
  [ValidateSet("Chrome", "Edge")][string]$Browser = "Chrome",
  [string]$DbPath = "$env:USERPROFILE\.watcher\sessions.db",
  [string]$Key = "watcher-dev-key"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$daemon = Join-Path $root "crates\daemon\target\debug\watcher-daemon.exe"
if (-not (Test-Path $daemon)) {
  throw ("daemon not built. Run: cargo build --manifest-path crates/daemon/Cargo.toml (expected: " + $daemon + ")")
}
New-Item -ItemType Directory -Force -Path (Split-Path $DbPath) | Out-Null
$hostDir = Join-Path $root "extension\native-host"
New-Item -ItemType Directory -Force -Path $hostDir | Out-Null

# 1) launcher - Chrome runs this; it execs the daemon in native-messaging mode (stdio passes through)
$cmd = Join-Path $hostDir "watcher-host.cmd"
$launcher = "@echo off`r`n`"$daemon`" --native-messaging --db `"$DbPath`" --key `"$Key`"`r`n"
Set-Content -Path $cmd -Value $launcher -Encoding ascii -NoNewline

# 2) host manifest - only OUR extension may connect
$manifest = Join-Path $hostDir "com.thewatcher.host.json"
$obj = [ordered]@{
  name            = "com.thewatcher.host"
  description     = "The Watcher local daemon (Native Messaging host)"
  path            = $cmd
  type            = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
($obj | ConvertTo-Json) | Set-Content -Path $manifest -Encoding ascii

# 3) registry key the browser reads
$base = if ($Browser -eq "Edge") { "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts" } else { "HKCU:\Software\Google\Chrome\NativeMessagingHosts" }
$keyPath = Join-Path $base "com.thewatcher.host"
New-Item -Path $keyPath -Force | Out-Null
Set-ItemProperty -Path $keyPath -Name "(default)" -Value $manifest

Write-Host "[OK] Native host registered for $Browser" -ForegroundColor Green
Write-Host "  launcher : $cmd"
Write-Host "  manifest : $manifest"
Write-Host "  registry : $keyPath"
Write-Host "  db       : $DbPath"
Write-Host "  daemon log: $env:TEMP\watcher-daemon.log"
Write-Host ""
Write-Host "Reload the extension, then spawn a box on hackthebox.com." -ForegroundColor Yellow
