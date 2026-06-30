<#
.SYNOPSIS
    Start the Visual Actor server on Windows (creates the venv on first run).

.DESCRIPTION
    Convenience launcher for Windows users: ensures a virtual environment exists,
    installs core dependencies if needed, loads .env, and starts the server.
    Equivalent to run.sh on Linux/macOS.
#>
param(
    [int]$Port = 8765,
    [string]$ServerHost = "127.0.0.1"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$venv = Join-Path $root ".venv"
$py = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Output "Creating virtual environment..."
    python -m venv $venv
    & $py -m pip install --upgrade pip
    & $py -m pip install -r (Join-Path $root "requirements.txt")
}

$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match "^\s*[^#].*=" } | ForEach-Object {
        $kv = $_ -split "=", 2
        [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
}

$env:VISUAL_ACTOR_HOST = $ServerHost
$env:VISUAL_ACTOR_PORT = "$Port"
Write-Output "Starting Visual Actor at http://${ServerHost}:${Port} (Ctrl+C to stop)"
& $py -m app.main --host $ServerHost --port $Port
