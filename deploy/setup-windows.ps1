$ErrorActionPreference = 'Stop'
$rootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setupLog = Join-Path $rootDir 'log\setup-windows.log'
$transcriptStarted = $false
$previousConsoleEncoding = [Console]::OutputEncoding

function Read-RequiredText([string]$label, [string]$currentValue) {
    while ($true) {
        $answer = Read-Host "$label [$currentValue]"
        if ([string]::IsNullOrWhiteSpace($answer)) { $answer = $currentValue }
        if (-not [string]::IsNullOrWhiteSpace($answer)) { return $answer.Trim() }
        Write-Warning 'Enter a value.'
    }
}

function Read-Password([string]$currentValue) {
    $hint = if ($currentValue) { 'Enter keeps the existing password' } else { 'required' }
    while ($true) {
        $secureValue = Read-Host "DB USER PASSWORD ($hint)" -AsSecureString
        if ($secureValue.Length -eq 0) {
            if ($currentValue) { return $currentValue }
            Write-Warning 'Enter the database password. Windows integrated authentication is not supported.'
            continue
        }
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
        try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    }
}

Push-Location $rootDir
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    New-Item -ItemType Directory -Path (Join-Path $rootDir 'log') -Force | Out-Null
    Start-Transcript -Path $setupLog -Append | Out-Null
    $transcriptStarted = $true

    Write-Host 'MySQL or MariaDB must already be installed and running.'
    Write-Host 'Use a password-authenticated account with permission to create and manage the ExamCheck database.'
    Write-Host 'Other application settings are preserved. Password input is hidden.'
    Write-Host "DB_HOST is set automatically to '127.0.0.1'."
    Write-Host "DB_PORT is set automatically to '3306'."
    Write-Host "DB_NAME is set automatically to 'examcheck'."

    # Capture settings privately. Never print this JSON or pass passwords as command arguments.
    $currentJson = & node.exe tools/windows-env.mjs read
    if ($LASTEXITCODE -ne 0) { throw 'Could not read database settings.' }
    $current = $currentJson | ConvertFrom-Json
    $dbUser = Read-RequiredText 'DB USER ID' $current.DB_USER
    $dbPassword = Read-Password $current.DB_PASSWORD
    $settings = [ordered]@{
        DB_HOST = '127.0.0.1'
        DB_PORT = '3306'
        DB_NAME = 'examcheck'
        DB_USER = $dbUser
        DB_PASSWORD = $dbPassword
    }

    # Base64 preserves Unicode over Windows PowerShell 5.1 stdin without exposing secrets in argv.
    $settingsJson = $settings | ConvertTo-Json -Compress
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($settingsJson))
    $payload | & node.exe tools/windows-env.mjs write
    if ($LASTEXITCODE -ne 0) { throw 'Could not save database settings.' }
    Write-Host 'Database settings saved. Returning to start-server.bat to prepare the database and start the servers.'
} catch {
    Write-Host 'ExamCheck setup failed.' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Setup log: $setupLog"
    exit 1
} finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
    [Console]::OutputEncoding = $previousConsoleEncoding
    Pop-Location
}
