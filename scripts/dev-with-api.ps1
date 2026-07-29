# Launch TransTrack desktop against the local API server (Epic/remote mode).
# Prerequisites: Docker Postgres up + API listening on :8080
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-with-api.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

function Test-Api {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 3
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 300
  } catch {
    return $false
  }
}

Write-Host "Stopping prior Electron / Vite processes..."
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'vite|concurrently|electron-dev-remote') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

$envPath = Join-Path (Get-Location) '.env.development'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText(
  $envPath,
  "VITE_TRANSTRACK_API_URL=http://127.0.0.1:8080`n",
  $utf8NoBom
)

$env:VITE_TRANSTRACK_API_URL = 'http://127.0.0.1:8080'
$env:TRANSTRACK_API_URL = 'http://127.0.0.1:8080'
$env:ELECTRON_DEV = '1'

if (-not (Test-Api)) {
  Write-Host ""
  Write-Host "ERROR: API is not reachable at http://127.0.0.1:8080/health" -ForegroundColor Red
  Write-Host "Start it in another terminal first:" -ForegroundColor Yellow
  Write-Host "  cd C:\TransTrack\server"
  Write-Host "  npm start"
  exit 1
}

Write-Host "API health: OK"
Write-Host "Desktop will call API at: $env:TRANSTRACK_API_URL"
Write-Host "Credentials: admin@transtrack.local / ChangeMeNow!123456"
Write-Host ""
Write-Host "IMPORTANT: Leave this window open. Do not edit code while logging in."
npm run dev:electron
