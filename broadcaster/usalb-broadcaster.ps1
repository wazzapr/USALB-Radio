param(
  [Parameter(Mandatory = $true)]
  [string]$ServerUrl,
  [Parameter(Mandatory = $false)]
  [string]$PairingCode,
  [Parameter(Mandatory = $false)]
  [string]$AudioDevice = "default",
  [Parameter(Mandatory = $false)]
  [string]$DeviceName = "USALB Windows Broadcaster",
  [Parameter(Mandatory = $false)]
  [string]$FfmpegPath = "ffmpeg.exe"
)

$ErrorActionPreference = "Stop"
$ServerUrl = $ServerUrl.TrimEnd("/")
$CredentialsPath = Join-Path $PSScriptRoot "credentials.json"
$PairEndpoint = "$ServerUrl/api/broadcaster/pair"

function Send-Heartbeat {
  param([string]$Endpoint, [string]$Token, [string]$Status)
  try {
    Invoke-RestMethod -Method Post -Uri $Endpoint -Headers @{ Authorization = "Bearer $Token" } `
      -ContentType "application/json" -Body (@{ status = $Status; contentType = "audio/mpeg"; sampleRate = 44100; bitrateKbps = 128 } | ConvertTo-Json)
  } catch {
    Write-Host "Heartbeat unavailable: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

if (Test-Path $CredentialsPath) {
  $credentials = Get-Content $CredentialsPath -Raw | ConvertFrom-Json
  Write-Host "Using saved broadcaster credentials for device $($credentials.deviceId)." -ForegroundColor Cyan
} else {
  if ([string]::IsNullOrWhiteSpace($PairingCode)) {
    $PairingCode = Read-Host "Enter the USALB broadcaster pairing code"
  }
  $pairBody = @{ code = $PairingCode; deviceName = $DeviceName } | ConvertTo-Json
  $credentials = Invoke-RestMethod -Method Post -Uri $PairEndpoint -ContentType "application/json" -Body $pairBody
  $credentials | ConvertTo-Json -Depth 5 | Set-Content -Path $CredentialsPath -Encoding UTF8
  Write-Host "Paired. Persistent publish endpoint: $($credentials.publishEndpoint)" -ForegroundColor Green
}

$heartbeatJob = Start-Job -ArgumentList $credentials.heartbeatEndpoint, $credentials.publishToken `
  -ScriptBlock {
    param($endpoint, $token)
    while ($true) {
      try {
        Invoke-RestMethod -Method Post -Uri $endpoint -Headers @{ Authorization = "Bearer $token" } `
          -ContentType "application/json" -Body (@{ status = "CONNECTED"; contentType = "audio/mpeg"; sampleRate = 44100; bitrateKbps = 128 } | ConvertTo-Json) | Out-Null
      } catch {}
      Start-Sleep -Seconds 10
    }
  }

try {
  while ($true) {
    Write-Host "Streaming Windows system audio to USALB..." -ForegroundColor Green
    Send-Heartbeat -Endpoint $credentials.heartbeatEndpoint -Token $credentials.publishToken -Status "STREAMING"
    $headers = "Authorization: Bearer $($credentials.publishToken)`r`nContent-Type: audio/mpeg"
    & $FfmpegPath -hide_banner -loglevel warning `
      -f wasapi -i $AudioDevice `
      -ac 2 -ar 44100 -c:a libmp3lame -b:a 128k -f mp3 `
      -flush_packets 1 -method POST -headers $headers $credentials.publishEndpoint
    Write-Host "FFmpeg stopped. Reconnecting in 5 seconds..." -ForegroundColor Yellow
    Send-Heartbeat -Endpoint $credentials.heartbeatEndpoint -Token $credentials.publishToken -Status "RECONNECTING"
    Start-Sleep -Seconds 5
  }
} finally {
  Stop-Job $heartbeatJob -ErrorAction SilentlyContinue
  Remove-Job $heartbeatJob -Force -ErrorAction SilentlyContinue
  Send-Heartbeat -Endpoint $credentials.heartbeatEndpoint -Token $credentials.publishToken -Status "DISCONNECTED"
}