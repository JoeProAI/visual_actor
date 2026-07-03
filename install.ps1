<#
.SYNOPSIS
    Visual Actor - one-command install for Windows.

.DESCRIPTION
    Creates a virtualenv, installs dependencies, prepares .env, downloads the
    local Piper voice, checks WebView2 (for the Rainmeter widget), generates
    the 3D avatar head when TRIPO3D_API_KEY is available, then launches the
    server and opens the demo page. Equivalent to install.sh on macOS/Linux.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -NoLaunch
#>
param(
    [switch]$NoLaunch,
    [int]$Port = 8765
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  + $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

Step "Checking Python (need 3.11+)"
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw "Python not found. Install Python 3.11+ from https://www.python.org/downloads/ and re-run." }
$ver = & python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$ver -lt [version]"3.11") { throw "Python 3.11+ required, found $ver." }
Ok "Python $ver"

Step "Creating virtual environment (.venv)"
$venvPy = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { python -m venv .venv }
& $venvPy -m pip install --upgrade pip wheel --quiet
Ok "venv ready"

Step "Installing dependencies"
& $venvPy -m pip install -r requirements.txt --quiet
Ok "dependencies installed"

Step "Configuring environment (.env)"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Ok "created .env from .env.example" }
else { Ok ".env already present" }

# Offer to capture missing keys interactively (stored only in local .env).
$envText = Get-Content ".env" -Raw
foreach ($key in @("OPENROUTER_API_KEY", "TRIPO3D_API_KEY")) {
    if ($envText -match "(?m)^$key=\s*$") {
        $value = Read-Host "  Enter $key (or press Enter to skip)"
        if ($value) {
            $envText = $envText -replace "(?m)^$key=\s*$", "$key=$value"
            Set-Content ".env" $envText -NoNewline
            Ok "$key saved to .env"
        } else { Warn "$key skipped - related feature will be disabled until set in .env" }
    }
}

Step "Downloading local Piper voice (fallback TTS)"
$piperDir = "app\assets\models\piper"
$piperOnnx = Join-Path $piperDir "en_US-amy-low.onnx"
New-Item -ItemType Directory -Force -Path $piperDir | Out-Null
if (-not (Test-Path $piperOnnx)) {
    $base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low"
    try {
        Invoke-WebRequest "$base/en_US-amy-low.onnx" -OutFile $piperOnnx
        Invoke-WebRequest "$base/en_US-amy-low.onnx.json" -OutFile "$piperOnnx.json"
        Ok "Piper voice downloaded"
    } catch { Warn "Piper voice download failed - formant fallback will be used." }
} else { Ok "Piper voice present" }

Step "Checking WebView2 (Rainmeter widget)"
try { & powershell -ExecutionPolicy Bypass -File "scripts\install_webview2.ps1"; Ok "WebView2 OK" }
catch { Warn "WebView2 check failed - only needed for the Rainmeter widget." }

Step "3D avatar head"
$model = "app\assets\models\avatar_head.glb"
$envText = Get-Content ".env" -Raw
$tripoKey = if ($envText -match "(?m)^TRIPO3D_API_KEY=(.+)$") { $Matches[1].Trim() } else { "" }
if (Test-Path $model) {
    Ok "avatar_head.glb present"
} elseif ($tripoKey) {
    Write-Host "  Generating the 3D head with Tripo3D (takes a few minutes)..."
    $env:TRIPO3D_API_KEY = $tripoKey
    & $venvPy "scripts\generate_avatar_tripo.py"
    & $venvPy "scripts\add_jaw_morph.py"
    Ok "3D head generated with moving lips"
} else {
    Warn "No TRIPO3D_API_KEY - Face mode will use the built-in 2D portrait."
    Warn "Set the key in .env and run: python scripts\generate_avatar_tripo.py; python scripts\add_jaw_morph.py"
}

Step "Smoke test"
& $venvPy -c "from app.main import build; build(); print('engine OK')"

Write-Host ""
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Launch any time with: .\run.bat   then open http://127.0.0.1:$Port/"
if (-not $NoLaunch) {
    Step "Launching Visual Actor"
    # Open the browser once the server is listening (server runs in the foreground below).
    $opener = Start-Job -ArgumentList $Port -ScriptBlock {
        param($Port)
        foreach ($i in 1..60) {
            Start-Sleep -Seconds 1
            try {
                $client = New-Object Net.Sockets.TcpClient
                $client.Connect("127.0.0.1", $Port)
                $client.Close()
                Start-Process "http://127.0.0.1:$Port/"
                break
            } catch { }
        }
    }
    try { & powershell -ExecutionPolicy Bypass -File "scripts\windows_start_server.ps1" -Port $Port }
    finally { $opener | Remove-Job -Force -ErrorAction SilentlyContinue }
}
