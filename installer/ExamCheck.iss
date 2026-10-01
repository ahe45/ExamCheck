#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
[Setup]
AppId={{BD33D457-7884-4E6F-9F49-4E54C94C712A}
AppName=ExamCheck
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\ExamCheck
DefaultGroupName=ExamCheck
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=output
OutputBaseFilename=ExamCheck-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
AppMutex=Local\ExamCheckInstallerLauncher
CloseApplications=no
UninstallDisplayName=ExamCheck

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 실행 아이콘 만들기"; GroupDescription: "바로가기:"

[Icons]
Name: "{group}\ExamCheck 실행"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\runtime\launcher.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\ExamCheck 실행"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\runtime\launcher.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\runtime\launcher.ps1"""; Description: "ExamCheck 실행"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := not CheckForMutexes('Local\ExamCheckInstallerLauncher');
  if not Result then
    MsgBox('ExamCheck 실행 창을 먼저 종료해 주세요.', mbError, MB_OK);
end;
// Data lives outside {app}. Uninstall deliberately has no data-deletion rule.
