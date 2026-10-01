param([string]$CompilerPath, [switch]$SkipInstaller)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $PSScriptRoot 'stage'
$output = Join-Path $PSScriptRoot 'output'
$cache = Join-Path $PSScriptRoot 'cache'
$lock = Get-Content (Join-Path $PSScriptRoot 'runtime-lock.json') -Raw | ConvertFrom-Json

function Invoke-Checked {
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File failed ($LASTEXITCODE)." }
}
function Copy-Tree {
    param([string]$From, [string]$To)
    New-Item -ItemType Directory -Path $To -Force | Out-Null
    Get-ChildItem -LiteralPath $From -Force | Copy-Item -Destination $To -Recurse -Force
}
function Get-Runtime {
    param($Runtime, [string]$Name)
    $zip = Join-Path $cache "$Name.zip"
    if (-not (Test-Path -LiteralPath $zip)) {
        Write-Host "Downloading $Name $($Runtime.version)..."
        $partial = "$zip.partial"
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            Invoke-Checked 'curl.exe' @('--fail','--location','--silent','--show-error','--connect-timeout','20','--max-time','300','--output',$partial,$Runtime.url)
        } else {
            Invoke-WebRequest -Uri $Runtime.url -OutFile $partial -UseBasicParsing -TimeoutSec 300
        }
        Move-Item -LiteralPath $partial -Destination $zip -Force
    }
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Runtime.sha256) {
        throw "$Name archive checksum mismatch. Remove installer/cache/$Name.zip and retry."
    }
    $extracted = Join-Path $cache $Runtime.directory
    # Re-extract the verified archive each build; do not trust a modified extracted cache.
    if (Test-Path -LiteralPath $extracted) {
        if (-not ([IO.Path]::GetFullPath($extracted).StartsWith([IO.Path]::GetFullPath($cache) + '\'))) { throw 'Unsafe cache path.' }
        Remove-Item -LiteralPath $extracted -Recurse -Force
    }
    Expand-Archive -LiteralPath $zip -DestinationPath $cache -Force
    return $extracted
}

New-Item -ItemType Directory -Path $output,$cache -Force | Out-Null
if (Test-Path -LiteralPath $stage) {
    if ([IO.Path]::GetFullPath($stage) -ne ([IO.Path]::GetFullPath($PSScriptRoot) + '\stage')) { throw 'Unsafe stage path.' }
    Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$oldApiUrl = $env:VITE_API_BASE_URL
$oldPrinterMode = $env:VITE_PRINTER_MODE
Push-Location $root
try {
    $env:VITE_API_BASE_URL = '/api/v1'
    $env:VITE_PRINTER_MODE = 'browser-print'
    Invoke-Checked 'npm.cmd' @('run','build')
} finally {
    $env:VITE_API_BASE_URL = $oldApiUrl
    $env:VITE_PRINTER_MODE = $oldPrinterMode
    Pop-Location
}

# Preserve the npm lock and workspace layout for a reproducible production-only install.
Copy-Item (Join-Path $root 'package.json'),(Join-Path $root 'package-lock.json') $stage
foreach ($app in @('api','web')) {
    $destination = Join-Path $stage "apps/$app"
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item (Join-Path $root "apps/$app/package.json") $destination
    Copy-Tree (Join-Path $root "apps/$app/dist") (Join-Path $destination 'dist')
}
Copy-Tree (Join-Path $root 'apps/api/src/database/migrations') (Join-Path $stage 'apps/api/src/database/migrations')
Copy-Tree (Join-Path $root 'vendor') (Join-Path $stage 'vendor')
Copy-Tree (Join-Path $PSScriptRoot 'runtime') (Join-Path $stage 'runtime')
if (Test-Path (Join-Path $root 'drivers')) { Copy-Tree (Join-Path $root 'drivers') (Join-Path $stage 'drivers') }
Copy-Item (Join-Path $PSScriptRoot 'portable/ExamCheck.cmd') $stage
Copy-Item (Join-Path $PSScriptRoot 'USER-GUIDE.txt') $stage
Copy-Item (Join-Path $PSScriptRoot 'runtime-lock.json') $stage
Push-Location $stage
try { Invoke-Checked 'npm.cmd' @('ci','--omit=dev','--no-audit','--no-fund') } finally { Pop-Location }
# Workspace junctions duplicate the entire apps tree in archives and are unnecessary at runtime.
$workspaceLinks = Join-Path $stage 'node_modules/@examcheck'
if (Test-Path -LiteralPath $workspaceLinks) {
    foreach ($link in Get-ChildItem -LiteralPath $workspaceLinks -Force) {
        if ($link.LinkType -ne 'Junction') { throw 'Unexpected workspace link type.' }
        $target = [IO.Path]::GetFullPath([string]$link.Target)
        if (-not $target.StartsWith([IO.Path]::GetFullPath($stage) + '\apps\')) { throw 'Unexpected workspace target.' }
        # Non-recursive deletion removes the junction itself, preserving apps/api and apps/web.
        [IO.Directory]::Delete($link.FullName)
    }
    [IO.Directory]::Delete($workspaceLinks)
}
$webModules = [IO.Path]::GetFullPath((Join-Path $stage 'apps/web/node_modules'))
if (Test-Path -LiteralPath $webModules) {
    if ($webModules -ne ([IO.Path]::GetFullPath($stage) + '\apps\web\node_modules')) { throw 'Unsafe web module path.' }
    Remove-Item -LiteralPath $webModules -Recurse -Force
}

$nodeRuntime = Get-Runtime $lock.node 'node'
$mariaRuntime = Get-Runtime $lock.mariadb 'mariadb'
New-Item -ItemType Directory -Path (Join-Path $stage 'runtime/node') -Force | Out-Null
Copy-Item (Join-Path $nodeRuntime 'node.exe'),(Join-Path $nodeRuntime 'LICENSE') (Join-Path $stage 'runtime/node')
$mariaDestination = Join-Path $stage 'runtime/mariadb'
foreach ($part in @('bin','lib','share')) { Copy-Tree (Join-Path $mariaRuntime $part) (Join-Path $mariaDestination $part) }
Get-ChildItem -LiteralPath $mariaRuntime -File | Copy-Item -Destination $mariaDestination
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$manifest = @{
    version = $version
    releaseId = [Guid]::NewGuid().ToString()
    builtAt = [DateTime]::UtcNow.ToString('o')
    node = $lock.node.version
    mariadb = $lock.mariadb.version
}
[IO.File]::WriteAllText((Join-Path $stage 'release.json'), ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
# Windows PowerShell 5.1 needs BOM to read Korean UI strings reliably.
Get-ChildItem (Join-Path $stage 'runtime') -Filter '*.ps1' | ForEach-Object {
    $content = [IO.File]::ReadAllText($_.FullName)
    [IO.File]::WriteAllText($_.FullName, $content, (New-Object Text.UTF8Encoding($true)))
}
Write-Host 'Creating the offline portable package...'
$zip = Join-Path $output "ExamCheck-$version-win-x64.zip"
# ZipFile supports large MariaDB archives and avoids Compress-Archive's hidden-file omissions.
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Format-List
if (-not $SkipInstaller) {
    if (-not $CompilerPath) {
        $candidates = @((Join-Path $cache 'compiler/ISCC.exe'), "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe")
        $CompilerPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if ($CompilerPath) {
        Invoke-Checked $CompilerPath @('/Qp', "/DAppVersion=$version", (Join-Path $PSScriptRoot 'ExamCheck.iss'))
    } else {
        Write-Host 'Portable ZIP is ready. To also create Setup.exe, install Inno Setup on the build PC and rerun with -CompilerPath <ISCC.exe>.'
    }
}
Write-Host "Output: $output"
