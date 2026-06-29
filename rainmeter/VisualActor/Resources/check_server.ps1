# Report Visual Actor server status for the Rainmeter status line.
# Prints a short human-readable string consumed by [MeasureServer].

$ErrorActionPreference = "SilentlyContinue"
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:8765/health"
    if ($r.StatusCode -eq 200) {
        $j = $r.Content | ConvertFrom-Json
        Write-Output ("online (" + $j.active_provider + ")")
    } else {
        Write-Output "error"
    }
} catch {
    Write-Output "offline"
}
