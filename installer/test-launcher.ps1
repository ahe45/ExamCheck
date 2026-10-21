param([string]$ExecutablePath = (Join-Path $PSScriptRoot 'stage/가번호 관리 시스템.exe'))
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($ExecutablePath)
$bytes = [IO.File]::ReadAllBytes($source)
$peOffset = [BitConverter]::ToInt32($bytes,0x3c)
if ([BitConverter]::ToUInt16($bytes,($peOffset + 24 + 68)) -ne 2) { throw 'Launcher must use the Windows GUI subsystem.' }
$versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($source)
if ($versionInfo.ProductName -ne '가번호 관리 시스템') { throw 'Executable product name does not match the application.' }
Add-Type -AssemblyName System.Drawing
$icon = [Drawing.Icon]::ExtractAssociatedIcon($source)
if (-not $icon) { throw 'Application icon is missing from the executable.' }
$icon.Dispose()
$testRoot = Join-Path $PSScriptRoot ('test-data/launcher path-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'runtime') -Force | Out-Null
$target = Join-Path $testRoot '가번호 관리 시스템.exe'
Copy-Item -LiteralPath $source -Destination $target
$probe = @'
param([string]$DataDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
$result = @{ dataDirectory = $DataDirectory; consoleWindow = [ConsoleProbe]::GetConsoleWindow().ToInt64() }
[IO.File]::WriteAllText((Join-Path (Split-Path -Parent $PSScriptRoot) 'probe.json'),($result | ConvertTo-Json))
exit 7
'@
[IO.File]::WriteAllText((Join-Path $testRoot 'runtime/launcher.ps1'),$probe,(New-Object Text.UTF8Encoding($true)))
$data = (Join-Path $testRoot 'data path') + '\'
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = $target
$info.Arguments = '--data-dir "' + $data + '\"'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$process = [Diagnostics.Process]::Start($info)
try {
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Launcher probe timed out.' }
    if ($process.ExitCode -ne 7) { throw "Child exit code was not propagated ($($process.ExitCode))." }
    $result = [IO.File]::ReadAllText((Join-Path $testRoot 'probe.json')) | ConvertFrom-Json
    if ($result.consoleWindow -ne 0) { throw 'PowerShell created a console window.' }
    if ($result.dataDirectory -ne $data) { throw 'Paths with spaces and a trailing backslash were not preserved.' }
} finally { $process.Dispose() }
$launcherScript = Join-Path ([IO.Path]::GetDirectoryName($source)) 'runtime/launcher.ps1'
$tokens = $null; $parseErrors = $null
$tree = [Management.Automation.Language.Parser]::ParseFile($launcherScript,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Packaged launcher PowerShell is invalid.' }
$hiddenFunction = $tree.Find({ param($ast) $ast -is [Management.Automation.Language.FunctionDefinitionAst] -and $ast.Name -eq 'Start-HiddenProcess' },$true)
if (-not $hiddenFunction) { throw 'Hidden backend process helper is missing.' }
. ([scriptblock]::Create($hiddenFunction.Extent.Text))
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$probeScript = Join-Path $testRoot 'runtime/launcher.ps1'
$hidden = Start-HiddenProcess $powershell "-NoProfile -ExecutionPolicy Bypass -File `"$probeScript`" -DataDirectory backend-probe" $testRoot
try {
    if (-not $hidden.WaitForExit(15000)) { $hidden.Kill(); throw 'Hidden backend process probe timed out.' }
    $backendResult = [IO.File]::ReadAllText((Join-Path $testRoot 'probe.json')) | ConvertFrom-Json
    if ($hidden.ExitCode -ne 7 -or $backendResult.consoleWindow -ne 0 -or $backendResult.dataDirectory -ne 'backend-probe') { throw 'Backend process helper created a console or failed to pass arguments.' }
} finally { $hidden.Dispose() }
Write-Host 'GUI subsystem, product name, embedded icon, no console window, Korean/spaced paths, trailing backslash and child exit code passed.'
Write-Host 'Packaged backend process helper also starts without a console.'
