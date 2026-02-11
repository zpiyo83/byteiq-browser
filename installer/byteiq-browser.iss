[Setup]
AppName=Byteiq Browser
AppVersion=0.1.0
DefaultDirName={autopf}\Byteiq Browser
DefaultGroupName=Byteiq Browser
OutputDir=dist\installer
OutputBaseFilename=ByteiqBrowserSetup
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64

[Files]
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Byteiq Browser"; Filename: "{app}\byteiq-browser.exe"
Name: "{commondesktop}\Byteiq Browser"; Filename: "{app}\byteiq-browser.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务"; Flags: unchecked

[Run]
Filename: "{app}\byteiq-browser.exe"; Description: "启动 Byteiq Browser"; Flags: nowait postinstall skipifsilent
