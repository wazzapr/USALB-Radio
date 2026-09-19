$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDefault = "https://usalb-radio--applauncher.replit.app"

Write-Host ""
Write-Host "USALB Radio Windows Broadcaster" -ForegroundColor Cyan
Write-Host "--------------------------------" -ForegroundColor Cyan
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
  throw "FFmpeg is required. Install it, add ffmpeg.exe to PATH, and run setup again."
}

$serverUrl = Read-Host "USALB server URL [$serverDefault]"
if ([string]::IsNullOrWhiteSpace($serverUrl)) { $serverUrl = $serverDefault }

$pairingCode = Read-Host "Enter the USALB broadcaster pairing code"
$systemAudio = Read-Host "Windows system-audio device [default]"
if ([string]::IsNullOrWhiteSpace($systemAudio)) { $systemAudio = "default" }

$microphone = Read-Host "Microphone device [leave blank to disable]"
$deviceName = Read-Host "Broadcaster name [USALB Windows Broadcaster]"
if ([string]::IsNullOrWhiteSpace($deviceName)) { $deviceName = "USALB Windows Broadcaster" }

$args = @(
  "-ServerUrl", $serverUrl,
  "-PairingCode", $pairingCode,
  "-SystemAudioDevice", $systemAudio,
  "-DeviceName", $deviceName
)

if (-not [string]::IsNullOrWhiteSpace($microphone)) {
  $args += @("-MicrophoneDevice", $microphone)
}

Write-Host ""
Write-Host "Starting USALB broadcaster..." -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scriptRoot "usalb-broadcaster.ps1") @args
