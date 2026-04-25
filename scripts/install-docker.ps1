# TransTrack: Docker Desktop bootstrap
# Run elevated. The parent script kicks this off via Start-Process -Verb RunAs.
$ErrorActionPreference = 'Continue'
$logFile = "$env:TEMP\transtrack-docker-install.log"
Start-Transcript -Path $logFile -Force | Out-Null

function Say($msg) {
    Write-Host "==> $msg" -ForegroundColor Cyan
}

Say "Verifying elevation..."
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$p = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: not elevated. Re-run via right-click -> Run as Administrator." -ForegroundColor Red
    Stop-Transcript | Out-Null
    Read-Host "Press Enter to exit"
    exit 1
}
Say "OK, running as $($id.Name) (elevated)."

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$installer = "$env:TEMP\DockerDesktopInstaller.exe"
if (-not (Test-Path $installer) -or (Get-Item $installer).Length -lt 100MB) {
    Say "Downloading Docker Desktop (AMD64)..."
    try {
        Invoke-WebRequest `
            -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" `
            -OutFile $installer -UseBasicParsing
    } catch {
        Write-Host "Download failed: $_" -ForegroundColor Red
        Stop-Transcript | Out-Null
        Read-Host "Press Enter to exit"
        exit 2
    }
}
$size = [math]::Round((Get-Item $installer).Length / 1MB, 1)
Say "Installer ready: $installer ($size MB)"

Say "Stopping any running Docker services / processes..."
Get-Service *docker*  -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue
Get-Process *docker*  -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process com.docker.* -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$leftovers = @(
    "C:\ProgramData\DockerDesktop",
    "C:\ProgramData\Docker",
    "C:\Program Files\Docker"
)
foreach ($f in $leftovers) {
    if (Test-Path $f) {
        Say "Cleaning ownership / removing leftover: $f"
        try {
            takeown.exe /F $f /R /A /D Y | Out-Null
            icacls.exe  $f /grant "*S-1-5-32-544:(F)" /T /C | Out-Null
            Remove-Item $f -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Host "Could not fully remove $f : $_" -ForegroundColor Yellow
        }
    }
}

Say "Running the Docker Desktop installer (this takes 2-4 min)..."
$proc = Start-Process -FilePath $installer `
    -ArgumentList "install","--accept-license","--quiet" `
    -Wait -PassThru
Say "Installer exit code: $($proc.ExitCode)"

if (Test-Path "C:\Program Files\Docker\Docker\resources\bin\docker.exe") {
    Say "Success - Docker Desktop is installed."
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Green
    Write-Host "  1. Reboot Windows."
    Write-Host "  2. Launch 'Docker Desktop' from the Start menu and wait for the whale icon to stop animating."
    Write-Host "  3. Open a new PowerShell and run:  docker --version"
    Write-Host ""
    Write-Host "Log saved to: $logFile" -ForegroundColor DarkGray
} else {
    Write-Host "Install did not produce docker.exe. See log: $logFile" -ForegroundColor Red
}

Stop-Transcript | Out-Null
Read-Host "Press Enter to close this window"
