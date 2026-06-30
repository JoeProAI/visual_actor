<#
.SYNOPSIS
    Ensure the Microsoft Edge WebView2 Runtime is installed (required by the
    Rainmeter WebView2 host).

.DESCRIPTION
    Checks the registry for an existing WebView2 Runtime; if absent, downloads
    and silently installs the Evergreen bootstrapper from Microsoft. Safe to run
    repeatedly. Requires an internet connection on first install.
#>
$ErrorActionPreference = "Stop"

function Test-WebView2 {
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    foreach ($k in $keys) {
        if (Test-Path $k) { $v = (Get-ItemProperty $k).pv; if ($v) { return $v } }
    }
    return $null
}

$existing = Test-WebView2
if ($existing) { Write-Output "WebView2 Runtime already installed (version $existing)"; exit 0 }

Write-Output "WebView2 Runtime not found. Downloading Evergreen bootstrapper..."
$tmp = Join-Path $env:TEMP "MicrosoftEdgeWebview2Setup.exe"
Invoke-WebRequest -UseBasicParsing -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $tmp
Write-Output "Installing (silent)..."
Start-Process -FilePath $tmp -ArgumentList "/silent","/install" -Wait
$v = Test-WebView2
if ($v) { Write-Output "WebView2 Runtime installed (version $v)" }
else { Write-Warning "WebView2 install could not be verified. Install manually from https://developer.microsoft.com/microsoft-edge/webview2/"; exit 1 }
