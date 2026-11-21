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

; 4) electron-builder 自带的"程序还在运行"检查（CHECK_APP_RUNNING）会误判：
;    它用 PowerShell 判断
;      Get-CimInstance Win32_Process | ? { $_.Path.StartsWith('$INSTDIR', ...) }
;    而 $INSTDIR 在某些时机（例如静默安装 / 目录页还没执行）还是空字符串，
;    **StartsWith('') 对任何路径都成立** → 它会把机器上几乎所有进程都当成 HorunDrama，
;    然后 Stop-Process -Force 强杀，永远杀不干净，最后弹
;    「HorunDrama 无法关闭。请手动关闭它，然后点击重试以继续。」
;    （静默安装则直接退出码 2，2.0.6 的"装了没反应"就是这么来的。）
;    选了个很宽的安装目录（D:\ 之类）也会误判。
;    我们的程序是"启动器 HorunDrama.exe + 核心 HorunDramaCore.exe"两个镜像，
;    按镜像名关就够了，所以这里整套覆盖掉：只按名字 taskkill，然后放行。
;
;    注意：这里用的是 electron-builder 支持的 `customCheckAppRunning` 钩子。
;    （实测：我们的 installer.nsh 比 allowOnlyOneInstallerInstance.nsh 先 include，
;    所以 !ifmacrodef 能看到这个宏；直接 !undef 重定义 CHECK_APP_RUNNING 会报
;    "macro named CHECK_APP_RUNNING already exists"。）

!macro customCheckAppRunning
  DetailPrint "关闭正在运行的 HorunDrama（按进程名）..."
  FileOpen $9 "$TEMP\horun-hook.txt" w
  FileWrite $9 "hook=ON$\r$\nINSTDIR=$INSTDIR$\r$\nLOCALAPPDATA=$LOCALAPPDATA$\r$\n"
  FileClose $9
  nsExec::ExecToLog 'taskkill /f /im "HorunDrama.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /im "HorunDramaCore.exe"'
  Pop $0
  Sleep 400
!macroend

!macro customInit
  DetailPrint "关闭正在运行的HorunDrama..."
  nsExec::ExecToLog 'taskkill /f /im "Uninstall HorunDrama.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /im "HorunDrama.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /f /im "HorunDramaCore.exe"'
  Pop $0
  Sleep 700

  ; 2.0.6 及更早是 oneClick 安装器，electron-builder 在这种情况下用 package.json 的
  ; name（@horun/desktop）当目录名，结果装到 %LOCALAPPDATA%\Programs\@horundesktop。
  ; 2.0.7 起改成"先选目录"的安装器，目录名改用 productName（HorunDrama）；
  ; 这里把旧目录清掉，免得机器上留两份程序（数据在 %APPDATA%\HorunDrama，不受影响）。
  IfFileExists "$LOCALAPPDATA\Programs\@horundesktop\Uninstall HorunDrama.exe" 0 legacyDone
    DetailPrint "清理旧版安装目录（@horundesktop）..."
    RMDir /r "$LOCALAPPDATA\Programs\@horundesktop"
  legacyDone:
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

  ; 自己写安装信息：electron-builder 的 registryAddInstallInfo 在这套 assisted 配置下
  ; 没写出"卸载"项（实测 HKCU/HKLM 的 Uninstall 里都找不到），导致
  ;   1) 设置 → 应用里看不到 HorunDrama；
  ;   2) 安装目录里的 Uninstall HorunDrama.exe 因为不知道 $INSTDIR 而什么都不删（静默退出 0）。
  ; 这里用我们自己的键补上，卸载时也在 customUnInstall 里删掉。
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "DisplayName" "HorunDrama"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "Publisher" "Horun"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "DisplayIcon" "$INSTDIR\HorunDrama.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "UninstallString" "$\"$INSTDIR\Uninstall HorunDrama.exe$\""
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "QuietUninstallString" "$\"$INSTDIR\Uninstall HorunDrama.exe$\" /S"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama" "NoRepair" 1
  ; 我们自己的一份，用来在卸载时把 $INSTDIR 找回来
  WriteRegStr HKCU "Software\HorunDrama" "InstallLocation" "$INSTDIR"
!macroend

; 装完直接带参数启动一次，用户点「完成」就能看到窗口
!macro customFinish
  Exec '"$INSTDIR\HorunDrama.exe" --no-sandbox'
!macroend

; 卸载时 $INSTDIR 可能为空（直接双击卸载器时就是这样），从我们写的键里取回来，
; 不然整个卸载函数会对着空路径删文件，等于什么都不做。
!macro customUnInit
  ${if} $INSTDIR == ""
    ReadRegStr $0 HKCU "Software\HorunDrama" "InstallLocation"
    ${if} $0 != ""
      StrCpy $INSTDIR $0
    ${endif}
  ${endif}
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'taskkill /f /im "HorunDrama.exe"'
  Pop $0
  Sleep 500
  Delete "$DESKTOP\HorunDrama.lnk"
  Delete "$PROFILE\Desktop\HorunDrama.lnk"
  Delete "$SMPROGRAMS\HorunDrama\HorunDrama.lnk"
  RMDir "$SMPROGRAMS\HorunDrama"
  ; customInstall 里手写的文件，NSIS 的文件清单里没有，要自己删
  Delete "$INSTDIR\安装信息.txt"
  Delete "$INSTDIR\以兼容模式启动.cmd"
  Delete "$INSTDIR\portable.txt"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama"
  DeleteRegKey HKCU "Software\HorunDrama"
!macroend
