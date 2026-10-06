$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this regression test without administrator elevation.'
}
. (Join-Path $PSScriptRoot 'runtime/data-permissions.ps1')
$data = Join-Path $PSScriptRoot ('test-data\permissions-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $data -Force | Out-Null
# Reproduce the folder created by the old launcher on its first successful run.
$legacy = New-Object Security.AccessControl.DirectorySecurity
$legacy.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity.User, (New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
    $legacy.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
}
Set-Acl -LiteralPath $data -AclObject $legacy
$owner = (Get-Acl -LiteralPath $data).Owner
$child = Join-Path $data 'database'
New-Item -ItemType Directory -Path $child -Force | Out-Null
$existingFile = Join-Path $child 'preserved.txt'
[IO.File]::WriteAllText($existingFile, 'existing database content')
for ($attempt = 1; $attempt -le 3; $attempt++) {
    Initialize-ExamCheckDataPermissions -DataDirectory $data
    $acl = Get-Acl -LiteralPath $data
    if ($acl.Owner -ne $owner -or -not $acl.AreAccessRulesProtected) { throw 'Owner or inheritance changed incorrectly.' }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 2) { throw 'Unexpected data access rules.' }
    foreach ($sid in @($identity.User.Value, 'S-1-5-18')) {
        $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })
        if ($rule.Count -ne 1 -or $rule[0].FileSystemRights -ne 'FullControl' -or
            $rule[0].InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or
            $rule[0].AccessControlType -ne 'Allow') { throw 'Required private inherited permissions are missing.' }
    }
    if ([IO.File]::ReadAllText($existingFile) -ne 'existing database content') { throw 'Existing data changed.' }
    [IO.File]::WriteAllText((Join-Path $child "restart-$attempt.txt"), 'writable without elevation')
}
Write-Host 'Legacy protected folder and three repeated starts without administrator elevation passed; existing data and owner retained.'
