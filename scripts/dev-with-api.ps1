# Launch TransTrack desktop against the local API server (Epic/remote mode).
# Prerequisites: Postgres + `npm start` already running in server/ on :8080
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\dev-with-api.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

# Kill any prior Vite/Electron so CSP + env changes actually load
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match 'vite|electron'
} | Stop-Process -Force -ErrorAction SilentlyContinue

$env:VITE_TRANSTRACK_API_URL = 'http://localhost:8080'
$env:TRANSTRACK_API_URL = 'http://localhost:8080'
$env:ELECTRON_DEV = '1'

Write-Host "API URL: $env:VITE_TRANSTRACK_API_URL"
Write-Host "Starting Vite + Electron..."
npm run dev:electron
