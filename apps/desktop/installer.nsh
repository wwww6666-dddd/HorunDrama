; HorunDrama · 安装器钩子
;
; 三个必须在这里处理的问题，都是实测出来的：
;
; 1) 升级安装报 "不能打开要写入的文件: ...\Uninstall HorunDrama.exe"
;    上一次安装/卸载残留的 Uninstall HorunDrama.exe 或正在运行的 HorunDrama.exe 还占着文件。
;    安装一开始先结束旧进程。
;
; 2) 这台机器上 Electron 不带 --no-sandbox 会直接崩在 JS 执行之前
;    （退出码 0x80000003，栈里是 electron::fuses::IsLoadBrowserProcessSpecificV8SnapshotEnabled，
;    EXCEPTION_BREAKPOINT）。实测：加 --no-sandbox 能正常起，不加必崩，而且崩得太早，
;    程序里来不及自救。所以快捷方式必须自带这个参数。
;
; 3) NSIS 自带的 CreateShortCut 在受限会话里会失败（我们的日志里三条全 ErrFlag=1）。
;    所以改用 PowerShell 的 WScript.Shell 建快捷方式，它对会话限制更宽容；
;    两条路都留，成功任一即可。

!macro customInit
  DetailPrint "关闭正在运行的HorunDrama..."
  nsExec::ExecToLog 'taskkill /f /im "Uninstall HorunDrama.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /im "HorunDrama.exe"'
  Pop $0
  Sleep 700
!macroend

!macro customInstall
  ; 核心程序设为隐藏：资源管理器默认不显示隐藏文件，用户只会看到一个 HorunDrama.exe
  nsExec::ExecToLog 'attrib +h "$INSTDIR\HorunDramaCore.exe"'
  Pop $0
  ; 兜底启动脚本：HorunDrama.exe 本身是启动器（会带上必要参数再拉起 HorunDramaCore.exe），
  ; 所以这里直接调它就行；留着是怕有人误删了快捷方式。
  FileOpen $0 "$INSTDIR\以兼容模式启动.cmd" w
  FileWrite $0 "@echo off$\r$\n"
  FileWrite $0 "rem HorunDrama.exe 就是启动器，会自动带上 --no-sandbox 再拉起核心程序。$\r$\n"
  FileWrite $0 "start $\"$\" $\"%~dp0HorunDrama.exe$\"$\r$\n"
  FileClose $0

  ; 主路径：PowerShell 建快捷方式（NSIS 的 CreateShortCut 在受限会话里会失败）
  StrCpy $R0 "$\"$INSTDIR\HorunDrama.exe$\""
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$w=New-Object -ComObject WScript.Shell; $$s=$$w.CreateShortcut([Environment]::GetFolderPath('"'"'Desktop'"'"') + '"'"'\HorunDrama.lnk'"'"'); $$s.TargetPath='"'"'$INSTDIR\HorunDrama.exe'"'"'; $$s.Arguments='"'"'--no-sandbox'"'"'; $$s.WorkingDirectory='"'"'$INSTDIR'"'"'; $$s.IconLocation='"'"'$INSTDIR\HorunDrama.exe,0'"'"'; $$s.Save()"'
  Pop $1
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d=[Environment]::GetFolderPath('"'"'Programs'"'"') + '"'"'\HorunDrama'"'"'; New-Item -ItemType Directory -Force -Path $$d | Out-Null; $$w=New-Object -ComObject WScript.Shell; $$s=$$w.CreateShortcut($$d + '"'"'\HorunDrama.lnk'"'"'); $$s.TargetPath='"'"'$INSTDIR\HorunDrama.exe'"'"'; $$s.Arguments='"'"'--no-sandbox'"'"'; $$s.WorkingDirectory='"'"'$INSTDIR'"'"'; $$s.Save()"'
  Pop $2

  ; 备用：NSIS 内建方式，上面失败时兜底
  ClearErrors
  CreateShortCut "$PROFILE\Desktop\HorunDrama.lnk" "$INSTDIR\HorunDrama.exe" "--no-sandbox" "$INSTDIR\HorunDrama.exe" 0
  IfErrors 0 +2
    StrCpy $3 "内建创建失败"
  CreateDirectory "$SMPROGRAMS\HorunDrama"
  ClearErrors
  CreateShortCut "$SMPROGRAMS\HorunDrama\HorunDrama.lnk" "$INSTDIR\HorunDrama.exe" "--no-sandbox" "$INSTDIR\HorunDrama.exe" 0
  IfErrors 0 +2
    StrCpy $4 "内建创建失败"

  ; 诊断信息落到安装目录，装完可以直接核对
  FileOpen $9 "$INSTDIR\安装信息.txt" w
  FileWrite $9 "安装目录: $INSTDIR$\r$\n"
  FileWrite $9 "桌面快捷方式（PowerShell）: $1$\r$\n"
  FileWrite $9 "开始菜单快捷方式（PowerShell）: $2$\r$\n"
  FileWrite $9 "桌面快捷方式（NSIS 兜底）: $3$\r$\n"
  FileWrite $9 "开始菜单快捷方式（NSIS 兜底）: $4$\r$\n"
  FileWrite $9 "$\r$\n这台机器上 Electron 必须带 --no-sandbox 才能启动。$\r$\n"
  FileWrite $9 "请使用桌面上的「HorunDrama」快捷方式，或本目录下的「以兼容模式启动.cmd」。$\r$\n"
  FileClose $9
!macroend

; 装完直接带参数启动一次，用户点「完成」就能看到窗口
!macro customFinish
  Exec '"$INSTDIR\HorunDrama.exe" --no-sandbox'
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'taskkill /f /im "HorunDrama.exe"'
  Pop $0
  Sleep 500
  Delete "$DESKTOP\HorunDrama.lnk"
  Delete "$PROFILE\Desktop\HorunDrama.lnk"
  Delete "$SMPROGRAMS\HorunDrama\HorunDrama.lnk"
  RMDir "$SMPROGRAMS\HorunDrama"
!macroend
