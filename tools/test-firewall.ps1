$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\deploy\ensure-firewall.ps1')

function Assert-Check($condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function Reset-Fixture {
    $script:rule = $null
    $script:portFilter = $null
    $script:addressFilter = $null
    $script:admin = $false
    $script:adminChecks = 0
    $script:created = 0
    $script:updated = 0
    $script:elevations = 0
    $script:cancelElevation = $false
    $script:childExitCode = 0
    $script:savedSettings = @{}
}

function Set-FixtureRule($settings) {
    $script:savedSettings = $settings
    $script:rule = [pscustomobject]@{ Enabled = 'True'; Direction = 'Inbound'; Action = 'Allow'; Profile = 'Any' }
    $script:portFilter = [pscustomobject]@{ Protocol = 'TCP'; LocalPort = '5173'; RemotePort = 'Any' }
    $script:addressFilter = [pscustomobject]@{ LocalAddress = 'Any'; RemoteAddress = 'LocalSubnet' }
}

# These mocks never read or modify the machine's actual firewall or trigger UAC.
function Get-NetFirewallRule {
    param($PolicyStore, $Name, $ErrorAction)
    Assert-Check ($PolicyStore -eq 'PersistentStore') 'Unexpected policy store.'
    Assert-Check ($Name -eq 'ExamCheck-Web-TCP-5173') 'Must target only the ExamCheck rule.'
    return $script:rule
}
function Get-NetFirewallPortFilter {
    param([Parameter(ValueFromPipeline=$true)]$InputObject)
    return $script:portFilter
}
function Get-NetFirewallAddressFilter {
    param([Parameter(ValueFromPipeline=$true)]$InputObject)
    return $script:addressFilter
}
function Get-NetFirewallApplicationFilter {
    param([Parameter(ValueFromPipeline=$true)]$InputObject)
    return [pscustomobject]@{ Program = 'Any' }
}
function Get-NetFirewallServiceFilter {
    param([Parameter(ValueFromPipeline=$true)]$InputObject)
    return [pscustomobject]@{ Service = 'Any' }
}
function Test-ExamCheckAdministrator {
    $script:adminChecks++
    return $script:admin
}
function New-NetFirewallRule {
    param($PolicyStore, $Name, $Direction, $Action, $Enabled, $Profile, $Protocol, $LocalPort, $RemotePort,
        $LocalAddress, $RemoteAddress, $Program, $Service, $InterfaceType, $InterfaceAlias, $DisplayName, $Description)
    $script:created++
    Set-FixtureRule $PSBoundParameters
}
function Set-NetFirewallRule {
    param($PolicyStore, $Name, $Direction, $Action, $Enabled, $Profile, $Protocol, $LocalPort, $RemotePort,
        $LocalAddress, $RemoteAddress, $Program, $Service, $InterfaceType, $InterfaceAlias)
    $script:updated++
    Set-FixtureRule $PSBoundParameters
}
function Start-Process {
    param($FilePath, $Verb, $WindowStyle, [switch]$Wait, [switch]$PassThru, $ArgumentList)
    $script:elevations++
    Assert-Check ($Verb -eq 'RunAs' -and $WindowStyle -eq 'Hidden' -and $Wait -and $PassThru) 'Incorrect elevation options.'
    $command = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($ArgumentList[-1]))
    Assert-Check ($command.Contains("it''s\ensure-firewall.ps1' -Elevated")) 'Helper path quoting was lost.'
    Assert-Check (-not $command.Contains('start-server.bat')) 'The application must not be elevated.'
    if ($script:cancelElevation) { throw 'The operation was canceled by the user.' }
    return [pscustomobject]@{ ExitCode = $script:childExitCode }
}

Reset-Fixture
$script:admin = $true
Ensure-ExamCheckFirewall
Assert-Check ($script:created -eq 1 -and $script:updated -eq 0) 'Missing rule was not created exactly once.'
Assert-Check ($script:savedSettings.LocalPort -eq 5173 -and $script:savedSettings.Protocol -eq 'TCP') 'Incorrect port scope.'
Assert-Check ($script:savedSettings.RemoteAddress -eq 'LocalSubnet' -and $script:savedSettings.Profile -eq 'Any') 'Incorrect network scope.'

$script:adminChecks = 0
Ensure-ExamCheckFirewall
Assert-Check ($script:created -eq 1 -and $script:adminChecks -eq 0) 'Existing rule must skip mutation and elevation.'

$script:rule.Enabled = 'False'
Ensure-ExamCheckFirewall
Assert-Check ($script:updated -eq 1 -and $script:created -eq 1) 'Disabled rule must be repaired without duplication.'
$script:addressFilter.RemoteAddress = 'Any'
Ensure-ExamCheckFirewall
Assert-Check ($script:updated -eq 2) 'Unexpected rule scope must be normalized.'

Reset-Fixture
$script:firewallScriptPath = "C:\Fixture path\it's\ensure-firewall.ps1"
Ensure-ExamCheckFirewall
Assert-Check ($script:elevations -eq 1 -and $script:created -eq 0) 'Non-admin must use the elevated helper.'

foreach ($failure in @('cancel', 'failed', 'not-admin')) {
    Reset-Fixture
    $script:cancelElevation = $failure -eq 'cancel'
    if ($failure -eq 'failed') { $script:childExitCode = 1 }
    $caught = $false
    try { Ensure-ExamCheckFirewall -IsElevatedChild:($failure -eq 'not-admin') } catch { $caught = $true }
    Assert-Check $caught "Failure was silently accepted: $failure"
    Assert-Check ($script:created -eq 0 -and $script:updated -eq 0) 'Failed elevation must not change rules.'
}
Write-Host 'PASS: create, repeat, repair, scope, elevation, cancellation and failure handling. No real firewall rules changed.'
