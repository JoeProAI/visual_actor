<#
.SYNOPSIS
    Visual Actor — zero-prerequisite bootstrap for Windows.

.DESCRIPTION
    Works on a bare Windows machine: no Git, no Python, no winget needed.
    Installs Python silently if missing, downloads the repo as a zip
    (no Git required), then hands off to install.ps1.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\bootstrap.ps1
    # or straight from the web:
    irm https://raw.githubusercontent.com/JoeProAI/visual_actor/base/bootstrap.ps1 | iex
#>
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}

Step "Checking Python (need 3.11+)"
Refresh-Path
$havePython = $false
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
    try {
        $ver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
        if ($ver -and [version]$ver -ge [version]"3.11") { $havePython = $true }
    } catch { }
}
if (-not $havePython) {
    Step "Installing Python 3.12 (silent, ~30 MB download)"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
        $pyArch = "arm64"
        $pyHash = "8F653DD553B0430C0A5C0B2E9701B46DA187B61734066E8866B673A718A55F2C"
    } else {
        $pyArch = "amd64"
        $pyHash = "71BD44E6B0E91C17558963557E4CDB80B483DE9B0A0A9717F06CF896F95AB598"
    }
    $pyExe = Join-Path $env:TEMP "python-installer.exe"
    Invoke-WebRequest "https://www.python.org/ftp/python/3.12.8/python-3.12.8-$pyArch.exe" -OutFile $pyExe
    if ((Get-FileHash $pyExe -Algorithm SHA256).Hash -ne $pyHash) {
        throw "Python installer failed SHA-256 verification — download may be corrupted or tampered with. Install Python 3.12 manually from https://www.python.org/downloads/ and re-run."
    }
    Start-Process $pyExe -ArgumentList "/quiet", "InstallAllUsers=0", "PrependPath=1", "Include_launcher=0" -Wait
    Refresh-Path
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "Python installed but not on PATH yet — close this window, open a new PowerShell, and re-run this script."
    }
    Write-Host "  + Python installed" -ForegroundColor Green
} else {
    Write-Host "  + Python present" -ForegroundColor Green
}

Step "Downloading Visual Actor (no Git needed)"
$dest = Join-Path (Get-Location) "visual_actor"
if (Test-Path (Join-Path $dest "install.ps1")) {
    Write-Host "  + $dest already exists — using it" -ForegroundColor Green
} else {
    $zip = Join-Path $env:TEMP "visual_actor.zip"
    Invoke-WebRequest "https://codeload.github.com/JoeProAI/visual_actor/zip/refs/heads/base" -OutFile $zip
    $extract = Join-Path $env:TEMP "visual_actor_extract"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive $zip -DestinationPath $extract
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item (Join-Path $extract "visual_actor-base") $dest
    Write-Host "  + Downloaded to $dest" -ForegroundColor Green
}

Step "Running the installer"
Set-Location $dest
powershell -ExecutionPolicy Bypass -File ".\install.ps1"
