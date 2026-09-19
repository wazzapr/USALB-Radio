$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDefault = "https://usalb-radio--applauncher.replit.app"

Write-Host ""
Write-Host "USALB Radio Windows broadcaster" -ForegroundColor Cyan
Write-Host "This captures Windows system audio and sends it to the public USALB stream."
Write-Host ""

if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
  Write-Host "FFmpeg was not found on PATH." -ForegroundColor Yellow
  $install = Read-Host "Install FFmpeg with winget now? (Y/N)"
  if ($install -match "^[Yy]$" -and (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    winget install --id Gyan.FFmpeg.Shared --exact --source winget
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  }
}

if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
  throw "FFmpeg is required. Install it from https://ffmpeg.org/download.html, add ffmpeg.exe to PATH, then run this setup again."
}

$serverUrl = Read-Host "USALB server URL [$serverDefault]"
if ([string]::IsNullOrWhiteSpace($serverUrl)) { $serverUrl = $serverDefault }
$pairingCode = Read-Host "Enter the pairing code shown by the station operator"
$audioDevice = Read-Host "Windows audio device [default]"
if ([string]::IsNullOrWhiteSpace($audioDevice)) { $audioDevice = "default" }

Write-Host ""
Write-Host "Starting the broadcaster. Keep this window open while live." -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptRoot "usalb-broadcaster.ps1") `
  -ServerUrl $serverUrl `
  -PairingCode $pairingCode `
  -AudioDevice $audioDevice