param([string]$StageDirectory = (Join-Path $PSScriptRoot 'stage'))
$ErrorActionPreference = 'Stop'
$stage = [IO.Path]::GetFullPath($StageDirectory)
$data = Join-Path $PSScriptRoot ('test-data\smoke path-' + [Guid]::NewGuid().ToString('N'))
$node = Join-Path $stage 'runtime\node\node.exe'
$server = Join-Path $stage 'runtime\server.mjs'
$statusPath = Join-Path $data 'status.json'
$commandPath = Join-Path $data 'command.json'
$script:backend = $null
function Write-Json($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}
function New-Secret {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).Replace('+','-').Replace('/','_').TrimEnd('=')
}
function Get-FreePort {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
function Wait-State($Expected) {
    $deadline = [DateTime]::UtcNow.AddSeconds(150)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $statusPath) {
            $status = [IO.File]::ReadAllText($statusPath) | ConvertFrom-Json
            if ($status.state -eq $Expected) { return $status }
            if ($status.state -eq 'error') { throw $status.message }
        }
        if ($script:backend.HasExited) { throw "Server exited before $Expected. Check $data/logs/server.log." }
        Start-Sleep -Milliseconds 400
    }
    throw "Timed out waiting for $Expected. Check $data/logs/server.log."
}
function Start-Server($Action = 'start', $Archive = '') {
    if (Test-Path -LiteralPath $statusPath) { Remove-Item -LiteralPath $statusPath }
    $arguments = "`"$server`" --data-dir `"$data`" --parent-pid $PID --action $Action"
    if ($Archive) { $arguments += " --archive `"$Archive`"" }
    $script:backend = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $stage -WindowStyle Hidden -PassThru
}
function Stop-Server {
    if ($script:backend -and -not $script:backend.HasExited) {
        Write-Json $commandPath @{ action = 'stop' }
        Wait-State 'stopped' | Out-Null
        if (-not $script:backend.WaitForExit(30000)) { throw 'Server did not finish shutdown.' }
    }
}
function Invoke-Db($Action) {
    & $node (Join-Path $PSScriptRoot 'smoke-db.mjs') $stage $data $Action
    if ($LASTEXITCODE -ne 0) { throw "DB check failed: $Action" }
}
New-Item -ItemType Directory -Path $data -Force | Out-Null
$release = Get-Content (Join-Path $stage 'release.json') -Raw | ConvertFrom-Json
$password = New-Secret
$settings = @{
    format = 1; mariadb = $release.mariadb; webPort = Get-FreePort; apiPort = Get-FreePort
    dbPort = Get-FreePort; lan = $false; dbPassword = New-Secret; jwtSecret = New-Secret
    initialPassword = $password; bootstrapped = $false
}
Write-Json (Join-Path $data 'settings.json') $settings
try {
    Start-Server
    Wait-State 'ready' | Out-Null
    $base = "http://127.0.0.1:$($settings.webPort)"
    $web = Invoke-WebRequest -Uri $base -UseBasicParsing
    if ($web.StatusCode -ne 200 -or $web.Content -notmatch '<html') { throw 'Web page failed.' }
    $login = Invoke-RestMethod -Uri "$base/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body (@{loginId='admin'; password=$password} | ConvertTo-Json)
    if (-not $login.token) { throw 'Admin login failed.' }
    $user = Invoke-RestMethod -Uri "$base/api/v1/auth/me" -Headers @{Authorization="Bearer $($login.token)"}
    if ($user.loginId -ne 'admin') { throw 'Authenticated user mismatch.' }
    $stored = Get-Content (Join-Path $data 'settings.json') -Raw | ConvertFrom-Json
    if ($stored.initialPassword) { throw 'Initial password was retained after bootstrap.' }
    Invoke-Db 'seed'
    Write-Json $commandPath @{action='backup'}
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 400
        $archive = Get-ChildItem (Join-Path $data 'backups') -Filter '*.ecbackup' | Select-Object -First 1
    } while (-not $archive -and [DateTime]::UtcNow -lt $deadline)
    if (-not $archive) { throw 'Backup archive was not created.' }
    Wait-State 'ready' | Out-Null
    Invoke-Db 'change'
    Stop-Server
    foreach ($port in @($settings.webPort,$settings.apiPort,$settings.dbPort)) {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
        $listener.Start(); $listener.Stop()
    }
    Write-Host 'Fresh DB, web, authentication, backup and clean shutdown passed.'
    Start-Server 'restore' $archive.FullName
    Wait-State 'ready' | Out-Null
    Invoke-Db 'verify'
    Stop-Server
    # Simulate a new application release, without changing the production package.
    $stored = Get-Content (Join-Path $data 'settings.json') -Raw | ConvertFrom-Json
    $stored.lastRelease = 'previous-test-release'
    Write-Json (Join-Path $data 'settings.json') $stored
    $count = @(Get-ChildItem (Join-Path $data 'backups') -Filter '*.ecbackup').Count
    Start-Server
    Wait-State 'ready' | Out-Null
    Invoke-Db 'verify'
    if (@(Get-ChildItem (Join-Path $data 'backups') -Filter '*.ecbackup').Count -le $count) { throw 'Update safety backup was not created.' }
    Stop-Server
    Write-Host 'Restore, restart, data preservation and update safety backup passed.'
    Write-Host "Test data retained: $data"
} finally {
    Stop-Server
}
