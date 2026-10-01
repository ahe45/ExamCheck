param([string]$SetupPath = (Join-Path $PSScriptRoot 'output\ExamCheck-0.1.0-Setup.exe'))
$ErrorActionPreference = 'Stop'
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
    foreach ($file in @('server.mjs','api.mjs','launcher.ps1','firewall.ps1')) {
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
