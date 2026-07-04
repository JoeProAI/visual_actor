<#
.SYNOPSIS
    Packages the VisualActor Rainmeter skin into a valid .rmskin file.

.DESCRIPTION
    A .rmskin file is a standard ZIP archive with a 16-byte Rainmeter footer
    appended:  <int64 archiveSize><byte flags>"RMSKIN\0".  The archive layout is:

        RMSKIN.ini                         (package metadata, at archive root)
        Skins/VisualActor/...              (the skin folder + @Resources + .ps1)

    This script stages that layout, zips it, and appends the footer. The result
    installs via the Rainmeter Skin Installer like any official package.

.PARAMETER SkinRoot
    Path to rainmeter/VisualActor (defaults to repo layout relative to script).

.PARAMETER OutFile
    Output .rmskin path (default: <repo>/VisualActor.rmskin).
#>
param(
    [string]$SkinRoot = (Join-Path $PSScriptRoot "..\rainmeter\VisualActor"),
    [string]$OutFile  = (Join-Path $PSScriptRoot "..\VisualActor.rmskin"),
    # WebView2 Rainmeter plugin release (bundled into the package so the skin
    # installs its own dependency). https://github.com/NSTechBytes/WebView2
    [string]$PluginZipUrl = "https://github.com/NSTechBytes/WebView2/releases/download/v1.0.0/WebView2_v1.0.0_x64_x86_dll.zip",
    [switch]$SkipPlugin
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$SkinRoot = (Resolve-Path $SkinRoot).Path
$rmskinIni = Join-Path $SkinRoot "RMSKIN.ini"
if (-not (Test-Path $rmskinIni)) { throw "RMSKIN.ini not found in $SkinRoot" }

# 1. Stage the archive layout in a temp folder.
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("va_rmskin_" + [guid]::NewGuid().ToString("N"))
$skinsDir = Join-Path $stage "Skins\VisualActor"
New-Item -ItemType Directory -Force -Path $skinsDir | Out-Null

# Copy everything except RMSKIN.ini into Skins/VisualActor; RMSKIN.ini -> root.
Get-ChildItem -Path $SkinRoot -Force | ForEach-Object {
    if ($_.Name -ieq "RMSKIN.ini") {
        Copy-Item $_.FullName (Join-Path $stage "RMSKIN.ini") -Force
    } else {
        Copy-Item $_.FullName (Join-Path $skinsDir $_.Name) -Recurse -Force
    }
}

# 1b. Bundle the WebView2 Rainmeter plugin (Plugins/32bit + Plugins/64bit) so
#     the Skin Installer deploys the DLL the skin depends on.
if (-not $SkipPlugin) {
    $pluginZip = Join-Path $stage "webview2_plugin.zip"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $PluginZipUrl -OutFile $pluginZip
        $pluginTmp = Join-Path $stage "plugin_tmp"
        [System.IO.Compression.ZipFile]::ExtractToDirectory($pluginZip, $pluginTmp)
        $map = @{ "x64" = "64bit"; "x32" = "32bit" }
        foreach ($arch in $map.Keys) {
            $dll = Join-Path $pluginTmp "$arch\WebView2.dll"
            if (Test-Path $dll) {
                $dest = Join-Path $stage "Plugins\$($map[$arch])"
                New-Item -ItemType Directory -Force -Path $dest | Out-Null
                Copy-Item $dll (Join-Path $dest "WebView2.dll") -Force
            }
        }
        Remove-Item $pluginTmp -Recurse -Force
    } catch {
        Write-Warning "Could not bundle WebView2 plugin ($_). Building without it; install the plugin manually from $PluginZipUrl"
    } finally {
        if (Test-Path $pluginZip) { Remove-Item $pluginZip -Force }
    }
}

# 2. Zip the staged layout.
$zipPath = "$OutFile.zip"
if (Test-Path $zipPath)  { Remove-Item $zipPath -Force }
if (Test-Path $OutFile)  { Remove-Item $OutFile -Force }
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 3. Append the 16-byte Rainmeter footer:  <int64 size><byte flags>"RMSKIN\0".
#    The magic key is the null-terminated 7-byte string; without the trailing
#    NUL the Skin Installer rejects the package as invalid.
$bytes  = [System.IO.File]::ReadAllBytes($zipPath)
$footer = [System.Collections.Generic.List[byte]]::new()
$footer.AddRange([System.BitConverter]::GetBytes([int64]$bytes.Length))   # archive size
$footer.Add([byte]0)                                                       # flags (0 = zip)
$footer.AddRange([System.Text.Encoding]::ASCII.GetBytes("RMSKIN"))         # magic
$footer.Add([byte]0)                                                       # NUL terminator
[System.IO.File]::WriteAllBytes($OutFile, $bytes + $footer.ToArray())

Remove-Item $zipPath -Force
Remove-Item $stage -Recurse -Force

Write-Output "Built $OutFile ($([math]::Round((Get-Item $OutFile).Length / 1KB, 1)) KB)"
