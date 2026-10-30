param([string]$SetupPath)
$ErrorActionPreference = 'Stop'
$version = (Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json).version
if (-not $SetupPath) {
    $SetupPath = Join-Path $PSScriptRoot "output\가번호 관리 시스템_v$version.exe"
}
$key = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{BD33D457-7884-4E6F-9F49-4E54C94C712A}_is1'
foreach ($hive in @('HKCU','HKLM')) {
    if (Test-Path -LiteralPath "${hive}:\$key") { throw 'An installed ExamCheck already exists. Use a separate Windows account or clean test PC for the installer test.' }
}
$testRoot = Join-Path $PSScriptRoot ('test-data\i-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
$destination = Join-Path $testRoot 'program'
if (-not ([IO.Path]::GetFullPath($destination).StartsWith([IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'test-data')) + '\'))) { throw 'Unsafe test installation path.' }
New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$setup = Start-Process -FilePath ([IO.Path]::GetFullPath($SetupPath)) -ArgumentList @(
    '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/TASKS=',
    ('/DIR="' + $destination + '"'), ('/LOG="' + (Join-Path $testRoot 'install.log') + '"')
) -WindowStyle Hidden -Wait -PassThru
if ($setup.ExitCode -ne 0) { throw "Installation failed ($($setup.ExitCode)); see $testRoot/install.log." }
try {
    $installedRelease = Get-Content (Join-Path $destination 'release.json') -Raw | ConvertFrom-Json
    if ($installedRelease.version -ne $version) { throw 'Installed release version does not match the project.' }
    $launcherVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $destination '가번호 관리 시스템.exe'))
    if ($launcherVersion.FileVersion -ne "$version.0" -or $launcherVersion.ProductVersion -ne $version) { throw 'Launcher version does not match the release.' }
    foreach ($manifest in @('package.json','apps/api/package.json','apps/web/package.json')) {
        if ((Get-Content (Join-Path $destination $manifest) -Raw | ConvertFrom-Json).version -ne $version) {
            throw "Installed package version does not match the project: $manifest"
        }
    }
    $uninstallInfo = Get-ItemProperty -LiteralPath "HKCU:\$key"
    if ($uninstallInfo.DisplayVersion -ne $version) { throw 'Windows installed-app version does not match the project.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-launcher.ps1') -ExecutablePath (Join-Path $destination '가번호 관리 시스템.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Installed GUI launcher console regression test failed.' }
    foreach ($file in @('server.mjs','initial-accounts.mjs','api.mjs','launcher.ps1','firewall.ps1','data-permissions.ps1')) {
        # PowerShell scripts gain a BOM when packaged, so compare decoded text.
        $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot "runtime/$file"))
        $installed = [IO.File]::ReadAllText((Join-Path $destination "runtime/$file"))
        if ($source -ne $installed) { throw "Installer contains an older runtime file: $file" }
    }
    $dataCount = @(Get-ChildItem (Join-Path $PSScriptRoot 'test-data') -Directory -Filter 'smoke path-*').Count
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke-test.ps1') -StageDirectory $destination
    if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke test failed.' }
    if (@(Get-ChildItem (Join-Path $PSScriptRoot 'test-data') -Directory -Filter 'smoke path-*').Count -le $dataCount) { throw 'Test data was not created.' }
} finally {
    $uninstaller = Join-Path $destination 'unins000.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -WindowStyle Hidden -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw "Test uninstall failed: $($uninstall.ExitCode)" }
    }
}
if (Test-Path -LiteralPath (Join-Path $destination 'runtime/node/node.exe')) { throw 'Program files remain after uninstall.' }
$latestData = Get-ChildItem (Join-Path $PSScriptRoot 'test-data') -Directory -Filter 'smoke path-*' | Sort-Object CreationTime -Descending | Select-Object -First 1
if (-not (Test-Path -LiteralPath (Join-Path $latestData.FullName 'database/mysql'))) { throw 'Data was removed by uninstall.' }
Write-Host 'Installer installation, installed application and uninstall with retained data passed.'
Write-Host "Installer test logs: $testRoot"
