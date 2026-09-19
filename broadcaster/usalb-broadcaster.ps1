param(
  [string]$ServerUrl = "https://usalb-radio--applauncher.replit.app",
  [string]$PairingCode = "",
  [string]$SystemAudioDevice = "default",
  [string]$MicrophoneDevice = "",
  [string]$DeviceName = "USALB Windows Broadcaster",
  [string]$FfmpegPath = "ffmpeg.exe",
  [ValidateRange(0,2)][double]$MusicVolume = 1.0,
  [ValidateRange(0,2)][double]$MicrophoneVolume = 1.0,
  [switch]$DisableMicDucking
)

$ErrorActionPreference = "Stop"
$ServerUrl = $ServerUrl.TrimEnd("/")
$CredentialsPath = Join-Path $PSScriptRoot "credentials.json"
$PairEndpoint = "$ServerUrl/api/broadcaster/pair"

function Send-Heartbeat {
  param([string]$Endpoint, [string]$Token, [string]$Status, [string]$Detail = "")
  try {
    $body = @{
      status = $Status
      contentType = "audio/mpeg"
      sampleRate = 44100
      bitrateKbps = 128
      detail = $Detail
    } | ConvertTo-Json
    $headers = @{ Authorization = "Bearer $Token" }
    Invoke-RestMethod -Method Post -Uri $Endpoint -Headers $headers -ContentType "application/json" -Body $body | Out-Null
  } catch {
    Write-Host "Heartbeat unavailable: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Pair-Broadcaster {
  if ([string]::IsNullOrWhiteSpace($script:PairingCode)) {
    $script:PairingCode = Read-Host "Enter the USALB broadcaster pairing code"
  }
  if ([string]::IsNullOrWhiteSpace($script:PairingCode)) { throw "A pairing code is required." }

  $deviceId = $null
  if (Test-Path $CredentialsPath) {
    try {
      $old = Get-Content $CredentialsPath -Raw | ConvertFrom-Json
      $deviceId = $old.deviceId
    } catch {}
  }

  $pairBody = @{ code = $script:PairingCode; deviceName = $DeviceName }
  if ($deviceId) { $pairBody.deviceId = [string]$deviceId }

  try {
    $result = Invoke-RestMethod -Method Post -Uri $PairEndpoint -ContentType "application/json" -Body ($pairBody | ConvertTo-Json)
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 404) {
      throw "USALB pairing endpoint was not found at $PairEndpoint. The deployed server is not running the current broadcaster API."
    }
    if ($status -eq 401) { throw "The pairing code was rejected by the USALB server." }
    throw "Pairing failed: $($_.Exception.Message)"
  }

  $result | ConvertTo-Json -Depth 10 | Set-Content -Path $CredentialsPath -Encoding UTF8
  Write-Host "Paired successfully. Device: $($result.deviceId)" -ForegroundColor Green
  Write-Host "Publish endpoint: $($result.publishEndpoint)" -ForegroundColor Cyan
  return $result
}

function Get-Credentials {
  if (Test-Path $CredentialsPath) {
    try { return Get-Content $CredentialsPath -Raw | ConvertFrom-Json }
    catch {
      Remove-Item $CredentialsPath -Force -ErrorAction SilentlyContinue
      Write-Host "Saved credentials were invalid. Pairing again." -ForegroundColor Yellow
    }
  }
  return Pair-Broadcaster
}

function Test-Credentials($credentials) {
  try {
    Invoke-RestMethod -Method Get -Uri $credentials.commandsEndpoint -Headers @{ Authorization = "Bearer $($credentials.publishToken)" } | Out-Null
    return $true
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 401 -or $status -eq 404) { return $false }
    return $true
  }
}

function Start-Ffmpeg {
  param($credentials)

  $headers = "Authorization: Bearer $($credentials.publishToken)" + [Environment]::NewLine + "Content-Type: audio/mpeg"
  $common = @("-hide_banner", "-loglevel", "warning", "-nostdin")

  if ([string]::IsNullOrWhiteSpace($MicrophoneDevice)) {
    $args = $common + @(
      "-f", "wasapi", "-loopback", "1", "-i", $SystemAudioDevice,
      "-ac", "2", "-ar", "44100",
      "-filter:a", "volume=$MusicVolume,alimiter=limit=0.95",
      "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3",
      "-flush_packets", "1", "-method", "POST", "-headers", $headers,
      $credentials.publishEndpoint
    )
  } else {
    if ($DisableMicDucking) {
      $filter = "[0:a]volume=$MusicVolume[music];[1:a]volume=$MicrophoneVolume[mic];[music][mic]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[a]"
    } else {
      $filter = "[0:a]volume=$MusicVolume[music];[1:a]volume=$MicrophoneVolume[mic];[music][mic]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=250[ducked];[ducked][mic]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0,alimiter=limit=0.95[a]"
    }
    $args = $common + @(
      "-f", "wasapi", "-loopback", "1", "-i", $SystemAudioDevice,
      "-f", "wasapi", "-i", $MicrophoneDevice,
      "-filter_complex", $filter, "-map", "[a]",
      "-ac", "2", "-ar", "44100",
      "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3",
      "-flush_packets", "1", "-method", "POST", "-headers", $headers,
      $credentials.publishEndpoint
    )
  }

  & $FfmpegPath @args
  return $LASTEXITCODE
}

Write-Host ""
Write-Host "USALB RADIO - WINDOWS BROADCASTER" -ForegroundColor Cyan
Write-Host "---------------------------------" -ForegroundColor Cyan

if (-not (Get-Command $FfmpegPath -ErrorAction SilentlyContinue)) {
  throw "FFmpeg was not found. Install FFmpeg and make sure ffmpeg.exe is on PATH."
}

$credentials = Get-Credentials

if (-not (Test-Credentials $credentials)) {
  Write-Host "Saved credentials are no longer valid. Pairing again..." -ForegroundColor Yellow
  Remove-Item $CredentialsPath -Force -ErrorAction SilentlyContinue
  $credentials = Pair-Broadcaster
}

$heartbeatJob = Start-Job -ArgumentList $credentials.heartbeatEndpoint, $credentials.publishToken -ScriptBlock {
  param($endpoint, $token)
  while ($true) {
    try {
      $body = @{ status = "CONNECTED"; contentType = "audio/mpeg"; sampleRate = 44100; bitrateKbps = 128 } | ConvertTo-Json
      Invoke-RestMethod -Method Post -Uri $endpoint -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body | Out-Null
    } catch {}
    Start-Sleep -Seconds 10
  }
}

try {
  Write-Host "System audio: $SystemAudioDevice" -ForegroundColor Cyan
  if ($MicrophoneDevice) {
    Write-Host "Microphone: $MicrophoneDevice" -ForegroundColor Cyan
    Write-Host "Mic ducking: $(-not $DisableMicDucking)" -ForegroundColor Cyan
  } else {
    Write-Host "Microphone: disabled" -ForegroundColor DarkGray
  }

  while ($true) {
    Write-Host "Broadcasting to USALB..." -ForegroundColor Green
    Send-Heartbeat -Endpoint $credentials.heartbeatEndpoint -Token $credentials.publishToken -Status "STREAMING" -Detail "Windows broadcaster streaming"

    $exitCode = Start-Ffmpeg $credentials
    Write-Host "FFmpeg stopped with exit code $exitCode." -ForegroundColor Yellow

    Send-Heartbeat -Endpoint $credentials.heartbeatEndpoint -Token $credentials.publishToken -Status "RECONNECTING"

    if (-not (Test-Credentials $credentials)) {
      Write-Host "Broadcaster authentication failed. Pairing again..." -ForegroundColor Yellow
      Remove-Item $CredentialsPath -Force -ErrorAction SilentlyContinue
      $credentials = Pair-Broadcaster
    }

    Write-Host "Reconnecting in 5 seconds..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
  }
} finally {
  if ($heartbeatJob) {
    Stop-Job $heartbeatJob -ErrorAction SilentlyContinue
    Remove-Job $heartbeatJob -Force -ErrorAction SilentlyContinue
  }
  if ($credentials) {
    Send-Heartbeat -Endpoint $credentials.heartbeatEndpoint -Token $credentials.publishToken -Status "DISCONNECTED"
  }
}
