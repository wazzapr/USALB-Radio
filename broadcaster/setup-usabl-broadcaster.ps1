$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDefault = "https://usalb-radio--applauncher.replit.app"
$project = Join-Path $scriptRoot "windows\USALBBroadcaster.csproj"

Write-Host ""
Write-Host "USALB Radio Windows broadcaster" -ForegroundColor Cyan
Write-Host "System-audio loopback broadcaster" -ForegroundColor DarkCyan
Write-Host ""

if (-not (Get-Command dotnet.exe -ErrorAction SilentlyContinue)) {
  throw ".NET 8 is required. Install the .NET 8 Desktop Runtime/SDK, then run this setup again."
}

if (-not (Test-Path $project)) {
  throw "The Windows broadcaster project is missing: $project"
}

$serverUrl = Read-Host "USALB server URL [$serverDefault]"
if ([string]::IsNullOrWhiteSpace($serverUrl)) { $serverUrl = $serverDefault }
$serverUrl = $serverUrl.Trim().TrimEnd("/")
if ($serverUrl -match "/admin$") {
  $serverUrl = $serverUrl -replace "/admin$", ""
  Write-Host "Removed /admin from the server URL." -ForegroundColor Yellow
}

$credentialsPath = Join-Path $scriptRoot "windows\credentials.json"
$pairingCode = ""
if (-not (Test-Path $credentialsPath)) {
  $pairingCode = Read-Host "Enter the pairing code shown by the station operator"
}

Write-Host ""
Write-Host "Starting the broadcaster. Keep this window open while live." -ForegroundColor Green

if ([string]::IsNullOrWhiteSpace($pairingCode)) {
  & dotnet.exe run --project $project -- "$serverUrl"
} else {
  & dotnet.exe run --project $project -- "$serverUrl" "$pairingCode"
}

exit $LASTEXITCODE
