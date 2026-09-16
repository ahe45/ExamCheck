param([switch]$Elevated)

$ErrorActionPreference = 'Stop'
$script:firewallScriptPath = $PSCommandPath
$script:firewallRuleName = 'ExamCheck-Web-TCP-5173'

function Test-ExamCheckAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-ExamCheckFirewallRule {
    $rules = @(Get-NetFirewallRule -PolicyStore PersistentStore -Name $script:firewallRuleName -ErrorAction SilentlyContinue)
    if ($rules.Count -ne 1) { return $false }
    $rule = $rules[0]
    if ($rule.Enabled -ne 'True' -or $rule.Direction -ne 'Inbound' -or $rule.Action -ne 'Allow' -or $rule.Profile -ne 'Any') {
        return $false
    }
    $port = $rule | Get-NetFirewallPortFilter
    $address = $rule | Get-NetFirewallAddressFilter
    $application = $rule | Get-NetFirewallApplicationFilter
    $service = $rule | Get-NetFirewallServiceFilter
    return (
        $port.Protocol -in @('TCP', '6') -and
        (@($port.LocalPort) -join ',') -eq '5173' -and
        (@($port.RemotePort) -join ',') -eq 'Any' -and
        (@($address.LocalAddress) -join ',') -eq 'Any' -and
        (@($address.RemoteAddress) -join ',') -eq 'LocalSubnet' -and
        $application.Program -eq 'Any' -and $service.Service -eq 'Any'
    )
}

function Ensure-ExamCheckFirewall {
    param([switch]$IsElevatedChild)

    # A normal launch only reads the rule. Elevate the firewall helper, not the web/API servers.
    $ready = $false
    try { $ready = Test-ExamCheckFirewallRule } catch { }
    if ($ready) {
        Write-Host 'ExamCheck firewall rule is ready: TCP 5173 from the local subnet.'
        return
    }

    if (-not (Test-ExamCheckAdministrator)) {
        if ($IsElevatedChild) { throw 'Administrator permission was not granted.' }
        Write-Host 'Windows will request administrator permission to configure the ExamCheck firewall rule.'
        $quotedPath = $script:firewallScriptPath.Replace("'", "''")
        $command = "& '$quotedPath' -Elevated; exit " + '$LASTEXITCODE'
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $child = Start-Process -FilePath $powershell -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
        )
        if ($child.ExitCode -ne 0) { throw 'Firewall setup failed. See log\firewall.log for details.' }
        Write-Host 'ExamCheck firewall rule configured: TCP 5173 from the local subnet.'
        return
    }

    $settings = @{
        PolicyStore = 'PersistentStore'
        Name = $script:firewallRuleName
        Direction = 'Inbound'
        Action = 'Allow'
        Enabled = 'True'
        Profile = 'Any'
        Protocol = 'TCP'
        LocalPort = 5173
        RemotePort = 'Any'
        LocalAddress = 'Any'
        RemoteAddress = 'LocalSubnet'
        Program = 'Any'
        Service = 'Any'
        InterfaceType = 'Any'
        InterfaceAlias = 'Any'
    }
    $existing = Get-NetFirewallRule -PolicyStore PersistentStore -Name $script:firewallRuleName -ErrorAction SilentlyContinue
    if ($existing) {
        Set-NetFirewallRule @settings | Out-Null
    } else {
        New-NetFirewallRule @settings -DisplayName 'ExamCheck Web (TCP 5173)' -Description 'Allow ExamCheck web access from the local subnet.' | Out-Null
    }
    if (-not (Test-ExamCheckFirewallRule)) { throw 'The ExamCheck firewall rule could not be verified.' }
    Write-Host 'ExamCheck firewall rule configured: TCP 5173 from the local subnet.'
}

# Dot-sourcing permits isolated verification with mocked firewall commands.
if ($MyInvocation.InvocationName -ne '.') {
    $transcriptStarted = $false
    try {
        if ($Elevated) {
            $logDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'log'
            New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
            Start-Transcript -Path (Join-Path $logDirectory 'firewall.log') -Append | Out-Null
            $transcriptStarted = $true
        }
        Ensure-ExamCheckFirewall -IsElevatedChild:$Elevated
        exit 0
    } catch {
        Write-Host "ExamCheck firewall setup failed: $($_.Exception.Message)"
        Write-Host 'Allow the administrator prompt and retry start-server.bat, or ask the server administrator to configure the rule.'
        exit 1
    } finally {
        if ($transcriptStarted) { Stop-Transcript | Out-Null }
    }
}
