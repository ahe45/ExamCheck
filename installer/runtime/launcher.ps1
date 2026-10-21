param([string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'ExamCheck\data'), [string]$PreviewPath)
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
function Start-HiddenProcess($File, $Arguments, $Directory) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $File
    $info.Arguments = $Arguments
    $info.WorkingDirectory = $Directory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = 'Hidden'
    return [Diagnostics.Process]::Start($info)
}
function New-UiLabel($Parent, $Text, $X, $Y, $Width, $Height, $Size = 10, $Bold = $false, $Color = '#172033') {
    $control = New-Object Windows.Forms.Label
    $control.SetBounds($X,$Y,$Width,$Height)
    $control.Text = $Text
    $style = if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
    $control.Font = New-Object Drawing.Font('Malgun Gothic',[single]$Size,$style)
    $control.ForeColor = [Drawing.ColorTranslator]::FromHtml($Color)
    $Parent.Controls.Add($control)
    return $control
}
function New-UiButton($Parent, $Text, $X, $Y, $Width, $Primary = $false) {
    $control = New-Object Windows.Forms.Button
    $control.SetBounds($X,$Y,$Width,42)
    $control.Text = $Text
    $control.Font = New-Object Drawing.Font('Malgun Gothic',10,[Drawing.FontStyle]::Bold)
    $control.FlatStyle = 'Flat'
    $control.FlatAppearance.BorderSize = 1
    $control.FlatAppearance.BorderColor = [Drawing.ColorTranslator]::FromHtml('#dce4ef')
    $control.BackColor = [Drawing.Color]::White
    $control.ForeColor = [Drawing.ColorTranslator]::FromHtml('#43536b')
    $control.Cursor = [Windows.Forms.Cursors]::Hand
    if ($Primary) {
        $control.BackColor = [Drawing.ColorTranslator]::FromHtml('#3264f5')
        $control.ForeColor = [Drawing.Color]::White
        $control.FlatAppearance.BorderColor = $control.BackColor
        $control.FlatAppearance.MouseOverBackColor = [Drawing.ColorTranslator]::FromHtml('#2453d8')
    } else { $control.FlatAppearance.MouseOverBackColor = [Drawing.ColorTranslator]::FromHtml('#edf3ff') }
    $Parent.Controls.Add($control)
    return $control
}
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
    $script:backend = Start-HiddenProcess $node $arguments $root
    $label.Text = '서버를 준비하고 있습니다...'
    $start.Enabled = $false
}
function Initialize-Settings {
    if (Test-Path -LiteralPath (Join-Path $DataDirectory 'settings.json')) { return $true }
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = '가번호 관리 시스템 · 처음 사용하기'
    $dialog.BackColor = [Drawing.ColorTranslator]::FromHtml('#f5f7fb')
    $dialog.Font = New-Object Drawing.Font('Malgun Gothic',9)
    $setupIconPath = Join-Path $PSScriptRoot 'app.ico'
    if (Test-Path -LiteralPath $setupIconPath) { $dialog.Icon = New-Object Drawing.Icon($setupIconPath) }
    $dialog.ClientSize = New-Object Drawing.Size(480, 360)
    $dialog.StartPosition = 'CenterScreen'
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $info = New-Object Windows.Forms.Label
    $info.SetBounds(24, 18, 432, 48)
    $info.Text = "admin 계정과 가번호 계정의 비밀번호를 각각 설정해 주세요.`n개발자(dev) 계정은 지정된 비밀번호로 자동 설정됩니다."
    New-UiLabel $dialog 'admin 비밀번호' 24 76 210 22 9 | Out-Null
    New-UiLabel $dialog 'admin 비밀번호 확인' 246 76 210 22 9 | Out-Null
    New-UiLabel $dialog '가번호 비밀번호' 24 146 210 22 9 | Out-Null
    New-UiLabel $dialog '가번호 비밀번호 확인' 246 146 210 22 9 | Out-Null
    $adminPassword = New-Object Windows.Forms.TextBox
    $adminPassword.SetBounds(24, 100, 210, 26)
    $adminConfirm = New-Object Windows.Forms.TextBox
    $adminConfirm.SetBounds(246, 100, 210, 26)
    $userPassword = New-Object Windows.Forms.TextBox
    $userPassword.SetBounds(24, 170, 210, 26)
    $userConfirm = New-Object Windows.Forms.TextBox
    $userConfirm.SetBounds(246, 170, 210, 26)
    foreach ($field in @($adminPassword, $adminConfirm, $userPassword, $userConfirm)) {
        $field.UseSystemPasswordChar = $true
        $field.MaxLength = 200
    }
    $hint = New-Object Windows.Forms.Label
    $hint.SetBounds(24, 216, 432, 40)
    $hint.Text = '계정별 비밀번호를 두 번씩 입력하세요. (4~200자, 앞뒤 공백 불가, 문자 조합 제한 없음)'
    $lan = New-Object Windows.Forms.CheckBox
    $lan.SetBounds(24, 266, 432, 24)
    $lan.Text = '같은 네트워크의 다른 PC에서도 접속 허용'
    $ok = New-Object Windows.Forms.Button
    $ok.SetBounds(346, 310, 110, 30)
    $ok.Text = '설정 완료'
    $ok.FlatStyle = 'Flat'
    $ok.BackColor = [Drawing.ColorTranslator]::FromHtml('#3264f5')
    $ok.ForeColor = [Drawing.Color]::White
    $ok.FlatAppearance.BorderSize = 0
    $ok.Add_Click({
        foreach ($account in @(
            @{ Label = 'admin'; Password = $adminPassword; Confirm = $adminConfirm },
            @{ Label = '가번호'; Password = $userPassword; Confirm = $userConfirm }
        )) {
            $value = $account.Password.Text
            if ($value.Trim().Length -lt 4 -or $value.Length -gt 200 -or $value -cne $value.Trim() -or $value -cne $account.Confirm.Text) {
                Show-Error "$($account.Label) 비밀번호를 확인해 주세요. 앞뒤 공백 없이 4~200자의 동일한 비밀번호를 두 번 입력해야 합니다."
                $account.Password.Focus()
                return
            }
        }
        if ($lan.Checked) {
            $firewall = Start-HiddenProcess "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'firewall.ps1')`"" $root
            $firewall.WaitForExit()
            if ($firewall.ExitCode -ne 0) { Show-Error '네트워크 접속 설정에 실패했습니다. 관리자 권한 요청을 허용하거나 접속 허용 선택을 해제해 주세요.'; return }
        }
        Write-JsonFile (Join-Path $DataDirectory 'first-run.json') @{ adminPassword = $adminPassword.Text; userPassword = $userPassword.Text; lan = $lan.Checked }
        $dialog.DialogResult = 'OK'
        $dialog.Close()
    })
    $dialog.Controls.AddRange(@($info,$adminPassword,$adminConfirm,$userPassword,$userConfirm,$hint,$lan,$ok))
    $result = $dialog.ShowDialog()
    $dialog.Dispose()
    return $result -eq 'OK'
}
try {
    . (Join-Path $PSScriptRoot 'data-permissions.ps1')
    if (-not $PreviewPath) { Initialize-ExamCheckDataPermissions -DataDirectory $DataDirectory }
    if (-not $PreviewPath -and -not (Test-Path -LiteralPath $node)) { throw '실행 환경이 없습니다. 전체 배포 폴더를 사용해 주세요.' }
    if (-not $PreviewPath -and -not (Initialize-Settings)) { exit }
    $form = New-Object Windows.Forms.Form
    $form.Text = '가번호 관리 시스템 · 서버 관리'
    $form.ClientSize = New-Object Drawing.Size(680, 532)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.AutoScaleMode = 'Dpi'
    $form.BackColor = [Drawing.ColorTranslator]::FromHtml('#f5f7fb')
    $form.Font = New-Object Drawing.Font('Malgun Gothic',10)
    $iconPath = Join-Path $PSScriptRoot 'app.ico'
    if (-not (Test-Path -LiteralPath $iconPath)) { $iconPath = Join-Path $PSScriptRoot '../assets/app.ico' }
    if (Test-Path -LiteralPath $iconPath) { $form.Icon = New-Object Drawing.Icon($iconPath) }

    $header = New-Object Windows.Forms.Panel
    $header.SetBounds(0,0,680,94)
    $header.BackColor = [Drawing.Color]::White
    $form.Controls.Add($header)
    $brand = New-Object Windows.Forms.PictureBox
    $brand.SetBounds(24,23,48,48)
    $brand.SizeMode = 'Zoom'
    $brandPath = Join-Path $PSScriptRoot 'app.png'
    if (-not (Test-Path -LiteralPath $brandPath)) { $brandPath = Join-Path $PSScriptRoot '../assets/app.png' }
    if (Test-Path -LiteralPath $brandPath) { $brand.Image = [Drawing.Image]::FromFile($brandPath) }
    $header.Controls.Add($brand)
    New-UiLabel $header '가번호 관리 시스템' 88 20 400 30 17 $true | Out-Null
    New-UiLabel $header '서버 실행부터 데이터 백업까지, 한곳에서 관리하세요.' 90 53 480 24 9 $false '#7b8a9f' | Out-Null

    $statusPanel = New-Object Windows.Forms.Panel
    $statusPanel.SetBounds(24,114,632,88)
    $statusPanel.BackColor = [Drawing.ColorTranslator]::FromHtml('#edf3ff')
    $form.Controls.Add($statusPanel)
    $statusCaption = New-UiLabel $statusPanel '서버 상태' 18 13 580 22 9 $true '#3264f5'
    $label = New-UiLabel $statusPanel '서버를 준비하고 있습니다...' 18 40 592 32 12 $true

    New-UiLabel $form '접속 주소' 24 217 240 24 10 $true | Out-Null
    $urls = New-Object Windows.Forms.TextBox
    $urls.SetBounds(24,246,632,56)
    $urls.Multiline = $true
    $urls.ReadOnly = $true
    $urls.ScrollBars = 'Vertical'
    $urls.BorderStyle = 'FixedSingle'
    $urls.BackColor = [Drawing.Color]::White
    $urls.ForeColor = [Drawing.ColorTranslator]::FromHtml('#52637c')
    $urls.Font = New-Object Drawing.Font('Segoe UI',11)
    $urls.Text = '서버가 준비되면 접속 주소가 표시됩니다.'
    $form.Controls.Add($urls)

    $browser = New-UiButton $form '시스템 화면 열기' 24 318 272 $true
    $start = New-UiButton $form '서버 시작' 308 318 168
    $stop = New-UiButton $form '서버 종료' 488 318 168

    New-UiLabel $form '데이터 및 지원' 24 382 600 24 10 $true | Out-Null
    $backup = New-UiButton $form '백업하기' 24 416 149
    $restore = New-UiButton $form '복원하기' 185 416 149
    $folder = New-UiButton $form '백업 폴더' 346 416 149
    $logs = New-UiButton $form '로그 보기' 507 416 149
    $foot = New-UiLabel $form "이 창을 닫으면 서버도 안전하게 종료됩니다. 브라우저만 닫으면 계속 실행됩니다." 24 484 632 28 9 $false '#7b8a9f'
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
                $statusCaption.Text = switch ($state.state) { 'ready' { '서버 실행 중' } 'stopped' { '서버 중지됨' } 'error' { '확인이 필요합니다' } default { '서버 준비 중' } }
                $statusPanel.BackColor = [Drawing.ColorTranslator]::FromHtml($(if ($state.state -eq 'error') { '#fff0f3' } elseif ($state.state -eq 'ready') { '#eaf8f2' } else { '#edf3ff' }))
                $statusCaption.ForeColor = [Drawing.ColorTranslator]::FromHtml($(if ($state.state -eq 'error') { '#dc365b' } elseif ($state.state -eq 'ready') { '#009c73' } else { '#3264f5' }))
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
    if ($PreviewPath) {
        $statusCaption.Text = '서버 실행 중'
        $statusPanel.BackColor = [Drawing.ColorTranslator]::FromHtml('#eaf8f2')
        $statusCaption.ForeColor = [Drawing.ColorTranslator]::FromHtml('#009c73')
        $label.Text = '정상적으로 실행 중입니다.'
        $urls.Text = "http://localhost:5173`r`nhttp://192.168.0.48:5173"
        $start.Enabled = $false
        $urls.SelectionStart = 0
        $urls.SelectionLength = 0
        $form.ActiveControl = $browser
        $form.StartPosition = 'Manual'
        $form.Location = New-Object Drawing.Point(-32000,-32000)
        $form.ShowInTaskbar = $false
        $form.Show()
        [Windows.Forms.Application]::DoEvents()
        $bitmap = New-Object Drawing.Bitmap($form.Width,$form.Height)
        $form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)))
        $bitmap.Save($PreviewPath,[Drawing.Imaging.ImageFormat]::Png)
        $form.Hide()
        $bitmap.Dispose(); $timer.Dispose(); $form.Dispose()
        return
    }
    $form.Add_Shown({ try { Start-Backend } catch { Show-Error $_.Exception.Message } })
    $timer.Start()
    [Windows.Forms.Application]::Run($form)
    $timer.Dispose()
    $form.Dispose()
} catch { Show-Error $_.Exception.Message }
finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
