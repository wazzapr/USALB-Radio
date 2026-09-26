#define MyAppName "USALB Broadcaster"
#define MyAppVersion "1.0.5"
#define MyAppPublisher "USALB Radio"
#define MyAppExeName "USALB.Broadcaster.exe"

[Setup]
AppId={{B6C8D2D7-4A4C-4D2D-9B11-8E6D5E6E8A01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\USALB Broadcaster
DefaultGroupName=USALB Broadcaster
OutputDir=.\installer-output
OutputBaseFilename=USALB-Broadcaster-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\USALB Broadcaster"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\USALB Broadcaster"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch USALB Broadcaster"; Flags: nowait postinstall skipifsilent
