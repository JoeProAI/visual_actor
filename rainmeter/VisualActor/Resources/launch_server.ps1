# Launch the local Visual Actor server (idempotent).
# Searches common install locations for the project, then starts the server in a
# minimized window if it is not already responding on the health endpoint.

$ErrorActionPreference = "SilentlyContinue"
$Health = "http://127.0.0.1:8765/health"

function Test-Server {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 $Health; return $r.StatusCode -eq 200 }
    catch { return $false }
}

if (Test-Server) { Write-Output "online"; exit 0 }

$candidates = @(
    (Join-Path $env:USERPROFILE "visual_actor"),
    (Join-Path $env:USERPROFILE "Documents\visual_actor"),
    (Join-Path $env:USERPROFILE "repos\visual_actor"),
    "C:\visual_actor"
)
$root = $candidates | Where-Object { Test-Path (Join-Path $_ "app\main.py") } | Select-Object -First 1
if (-not $root) { Write-Output "not-found"; exit 1 }

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

Start-Process -WindowStyle Minimized -WorkingDirectory $root -FilePath $python -ArgumentList "-m","app.main"
for ($i = 0; $i -lt 30; $i++) { if (Test-Server) { Write-Output "started"; exit 0 }; Start-Sleep -Milliseconds 300 }
Write-Output "timeout"; exit 1
