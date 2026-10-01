param([string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'ExamCheck\data'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$mutex = New-Object Threading.Mutex($false, 'Local\ExamCheckInstallerLauncher')
if (-not $mutex.WaitOne(0)) {
    [Windows.Forms.MessageBox]::Show('ExamCheck 실행 창이 이미 열려 있습니다.', 'ExamCheck') | Out-Null
    $mutex.Dispose()
    exit
}
$script:backend = $null
$script:closing = $false
$script:browserOpened = $false
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $PSScriptRoot 'node\node.exe'
$statusPath = Join-Path $DataDirectory 'status.json'
$commandPath = Join-Path $DataDirectory 'command.json'
function Write-JsonFile($Path, $Value) {
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Show-Error($Message) { [Windows.Forms.MessageBox]::Show($Message, 'ExamCheck', 'OK', 'Error') | Out-Null }
function Is-Running { return ($null -ne $script:backend -and -not $script:backend.HasExited) }
function Send-Command($Action) { Write-JsonFile $commandPath @{ action = $Action } }
function Start-Backend($Action = 'start', $Archive = '') {
    if (Is-Running) { return }
    if (Test-Path -LiteralPath $commandPath) { Remove-Item -LiteralPath $commandPath -Force }
    if (Test-Path -LiteralPath $statusPath) { Remove-Item -LiteralPath $statusPath -Force }
    $script:browserOpened = $false
    $arguments = "`"$(Join-Path $PSScriptRoot 'server.mjs')`" --data-dir `"$DataDirectory`" --parent-pid $PID --action $Action"
    if ($Archive) { $arguments += " --archive `"$Archive`"" }
    $script:backend = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $label.Text = '서버를 준비하고 있습니다...'
    $start.Enabled = $false
}
function Initialize-Settings {
    if (Test-Path -LiteralPath (Join-Path $DataDirectory 'settings.json')) { return $true }
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = 'ExamCheck 처음 사용하기'
    $dialog.ClientSize = New-Object Drawing.Size(430, 245)
    $dialog.StartPosition = 'CenterScreen'
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $info = New-Object Windows.Forms.Label
    $info.SetBounds(20, 18, 390, 45)
    $info.Text = "초기 계정(admin / 가번호 / dev)의 비밀번호를 정해 주세요.`n로그인 후 계정별 비밀번호를 변경할 수 있습니다."
    $password = New-Object Windows.Forms.TextBox
    $password.SetBounds(20, 70, 390, 26)
    $password.UseSystemPasswordChar = $true
    $password.MaxLength = 200
    $confirm = New-Object Windows.Forms.TextBox
    $confirm.SetBounds(20, 110, 390, 26)
    $confirm.UseSystemPasswordChar = $true
    $confirm.MaxLength = 200
    $hint = New-Object Windows.Forms.Label
    $hint.SetBounds(20, 142, 390, 22)
    $hint.Text = '비밀번호와 확인 비밀번호를 입력하세요. (8자 이상)'
    $lan = New-Object Windows.Forms.CheckBox
    $lan.SetBounds(20, 167, 390, 24)
    $lan.Text = '같은 네트워크의 다른 PC에서도 접속 허용'
    $ok = New-Object Windows.Forms.Button
    $ok.SetBounds(300, 204, 110, 30)
    $ok.Text = '설정 완료'
    $ok.Add_Click({
        if ($password.Text.Trim().Length -lt 8 -or $password.Text -ne $password.Text.Trim() -or $password.Text -ne $confirm.Text) {
            Show-Error '앞뒤 공백 없이 8자 이상의 동일한 비밀번호를 두 번 입력해 주세요.'
            return
        }
        if ($lan.Checked) {
            $firewall = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'firewall.ps1')`"" -WindowStyle Hidden -Wait -PassThru
            if ($firewall.ExitCode -ne 0) { Show-Error '네트워크 접속 설정에 실패했습니다. 관리자 권한 요청을 허용하거나 접속 허용 선택을 해제해 주세요.'; return }
        }
        Write-JsonFile (Join-Path $DataDirectory 'first-run.json') @{ password = $password.Text; lan = $lan.Checked }
        $dialog.DialogResult = 'OK'
        $dialog.Close()
    })
    $dialog.Controls.AddRange(@($info,$password,$confirm,$hint,$lan,$ok))
    $result = $dialog.ShowDialog()
    $dialog.Dispose()
    return $result -eq 'OK'
}
try {
    New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
    # Restrict inherited permissions before storing database/JWT credentials.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($userSid, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $DataDirectory -AclObject $acl
    if (-not (Test-Path -LiteralPath $node)) { throw '실행 환경이 없습니다. 전체 배포 폴더를 사용해 주세요.' }
    if (-not (Initialize-Settings)) { exit }
    $form = New-Object Windows.Forms.Form
    $form.Text = 'ExamCheck 서버 관리'
    $form.ClientSize = New-Object Drawing.Size(580, 315)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $label = New-Object Windows.Forms.Label
    $label.SetBounds(20, 18, 540, 60)
    $label.Text = '서버를 준비하고 있습니다...'
    $urls = New-Object Windows.Forms.TextBox
    $urls.SetBounds(20, 85, 540, 62)
    $urls.Multiline = $true
    $urls.ReadOnly = $true
    $urls.ScrollBars = 'Vertical'
    $start = New-Object Windows.Forms.Button
    $start.SetBounds(20, 163, 125, 35)
    $start.Text = '서버 시작'
    $stop = New-Object Windows.Forms.Button
    $stop.SetBounds(155, 163, 125, 35)
    $stop.Text = '서버 종료'
    $browser = New-Object Windows.Forms.Button
    $browser.SetBounds(290, 163, 125, 35)
    $browser.Text = '화면 열기'
    $backup = New-Object Windows.Forms.Button
    $backup.SetBounds(20, 210, 125, 35)
    $backup.Text = '백업하기'
    $restore = New-Object Windows.Forms.Button
    $restore.SetBounds(155, 210, 125, 35)
    $restore.Text = '복원하기'
    $logs = New-Object Windows.Forms.Button
    $logs.SetBounds(290, 210, 125, 35)
    $logs.Text = '로그 보기'
    $folder = New-Object Windows.Forms.Button
    $folder.SetBounds(425, 210, 135, 35)
    $folder.Text = '백업 폴더 열기'
    $foot = New-Object Windows.Forms.Label
    $foot.SetBounds(20, 264, 540, 36)
    $foot.Text = "이 창을 닫으면 서버도 종료됩니다. 브라우저만 닫으면 계속 실행됩니다.`n데이터는 프로그램 설치 폴더와 별도로 보관됩니다."
    $form.Controls.AddRange(@($label,$urls,$start,$stop,$browser,$backup,$restore,$logs,$folder,$foot))
    $start.Add_Click({ try { Start-Backend } catch { Show-Error $_.Exception.Message } })
    $stop.Add_Click({ if (Is-Running) { Send-Command 'stop' } })
    $browser.Add_Click({ Start-Process 'http://localhost:5173' })
    $backup.Add_Click({
        if (Is-Running) { Send-Command 'backup' }
        else { Start-Backend 'backup' }
    })
    $restore.Add_Click({
        $picker = New-Object Windows.Forms.OpenFileDialog
        $picker.Filter = 'ExamCheck 백업 (*.ecbackup)|*.ecbackup'
        if ($picker.ShowDialog() -eq 'OK') {
            $answer = [Windows.Forms.MessageBox]::Show('현재 데이터를 선택한 백업으로 교체합니다. 복원 전 데이터는 자동으로 백업합니다. 계속할까요?', '백업 복원', 'YesNo', 'Warning')
            if ($answer -eq 'Yes') { Start-Backend 'restore' $picker.FileName }
        }
        $picker.Dispose()
    })
    $logs.Add_Click({
        $path = Join-Path $DataDirectory 'logs\server.log'
        if (Test-Path -LiteralPath $path) { Start-Process notepad.exe -ArgumentList "`"$path`"" }
    })
    $folder.Add_Click({ Start-Process explorer.exe -ArgumentList "`"$(Join-Path $DataDirectory 'backups')`"" })
    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 500
    $timer.Add_Tick({
        $running = Is-Running
        $state = $null
        if (Test-Path -LiteralPath $statusPath) {
            try {
                $state = [IO.File]::ReadAllText($statusPath) | ConvertFrom-Json
                $label.Text = $state.message
                if ($state.urls) { $urls.Text = $state.urls -join "`r`n" }
            } catch { }
        }
        $start.Enabled = -not $running -and -not $script:closing
        $stop.Enabled = $running -and $state.state -in @('ready','error') -and -not $script:closing
        $browser.Enabled = $running -and $state.state -eq 'ready'
        $backup.Enabled = (-not $running -or $state.state -eq 'ready') -and -not $script:closing
        $restore.Enabled = -not $running -and -not $script:closing
        if ($running -and $state.state -eq 'ready' -and -not $script:browserOpened -and -not $script:closing) {
            $script:browserOpened = $true
            Start-Process 'http://localhost:5173'
        }
        if ($script:closing -and -not $running) { $timer.Stop(); $form.Close() }
    })
    $form.Add_FormClosing({
        if (Is-Running) {
            $_.Cancel = $true
            if (-not $script:closing) { $script:closing = $true; Send-Command 'stop'; $label.Text = '작업을 마치고 서버를 안전하게 종료하고 있습니다...' }
        }
    })
    $form.Add_Shown({ Start-Backend })
    $timer.Start()
    [Windows.Forms.Application]::Run($form)
    $timer.Dispose()
    $form.Dispose()
} catch { Show-Error $_.Exception.Message }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
