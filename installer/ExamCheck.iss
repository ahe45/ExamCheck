#ifndef AppVersion
  #define AppVersion "0.1.8"
#endif
[Setup]
AppId={{BD33D457-7884-4E6F-9F49-4E54C94C712A}
AppName=가번호 관리 시스템
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\ExamCheck
DefaultGroupName=가번호 관리 시스템
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=output
OutputBaseFilename=가번호 관리 시스템_{#AppVersion}
SetupIconFile=assets\app.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
AppMutex=Local\ExamCheckInstallerLauncher
CloseApplications=no
UninstallDisplayName=가번호 관리 시스템
UninstallDisplayIcon={app}\가번호 관리 시스템.exe

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 실행 아이콘 만들기"; GroupDescription: "바로가기:"

[Icons]
Name: "{group}\가번호 관리 시스템"; Filename: "{app}\가번호 관리 시스템.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\가번호 관리 시스템"; Filename: "{app}\가번호 관리 시스템.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\가번호 관리 시스템.exe"; Description: "가번호 관리 시스템 실행"; Flags: nowait postinstall skipifsilent

[InstallDelete]
Type: files; Name: "{app}\ExamCheck.cmd"
Type: files; Name: "{autodesktop}\ExamCheck 실행.lnk"
Type: files; Name: "{userprograms}\ExamCheck\ExamCheck 실행.lnk"

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := not CheckForMutexes('Local\ExamCheckInstallerLauncher');
  if not Result then
    MsgBox('ExamCheck 실행 창을 먼저 종료해 주세요.', mbError, MB_OK);
end;
// Data lives outside {app}. Uninstall deliberately has no data-deletion rule.
