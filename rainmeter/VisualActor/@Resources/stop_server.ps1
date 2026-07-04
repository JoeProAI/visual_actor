# Stop the local Visual Actor server by terminating the python process that is
# serving app.main on the configured port.

$ErrorActionPreference = "SilentlyContinue"
$port = 8765

$conns = Get-NetTCPConnection -LocalPort $port -State Listen
foreach ($c in $conns) {
    try { Stop-Process -Id $c.OwningProcess -Force; Write-Output "stopped pid $($c.OwningProcess)" }
    catch { }
}
if (-not $conns) {
    Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -match "app.main" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Output "stopped (by command line match)"
}
