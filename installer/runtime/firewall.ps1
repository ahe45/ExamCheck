param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
try {
    $name = 'ExamCheck-Installed-Web-5173'
    $existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
    if ($existing) {
        $port = $existing | Get-NetFirewallPortFilter
        $address = $existing | Get-NetFirewallAddressFilter
        if ($existing.Enabled -eq 'True' -and $existing.Direction -eq 'Inbound' -and $existing.Action -eq 'Allow' -and $port.LocalPort -eq '5173' -and $port.Protocol -in @('TCP','6') -and $address.RemoteAddress -eq 'LocalSubnet') { exit 0 }
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        if ($Elevated) { throw 'Administrator permission was not granted.' }
        $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Elevated"
        exit $child.ExitCode
    }
    $parameters = @{
        Name = $name; Direction = 'Inbound'; Action = 'Allow'; Enabled = 'True'
        Profile = 'Any'; Protocol = 'TCP'; LocalPort = 5173; RemoteAddress = 'LocalSubnet'
    }
    if ($existing) { Set-NetFirewallRule @parameters | Out-Null }
    else { New-NetFirewallRule @parameters -DisplayName 'ExamCheck installed web server' | Out-Null }
    exit 0
} catch { exit 1 }
