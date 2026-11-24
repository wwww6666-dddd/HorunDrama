; HorunDrama 安装器 —— 自己写的 NSIS 脚本（不再用 electron-builder 的模板）
;
; 为什么不用 electron-builder 的 NSIS 模板：
;   1) oneClick 模式把安装目录算成 %LOCALAPPDATA%\Programs\@horundesktop；
;   2) 改成 assisted（oneClick:false）后它又会塞 INSTALL_MODE_PER_ALL_USERS_REQUIRED，
;      按"为所有用户安装"来跑，静默/无管理员时行为就乱了；
;   3) 它的"程序还在运行"检查用 PowerShell 的 $_.Path.StartsWith('$INSTDIR')，
;      $INSTDIR 为空时恒真 → 会把整机进程当成 HorunDrama 去强杀，杀不完就弹
;      「HorunDrama 无法关闭」卡死安装。
; 这个脚本只做最基本的事，全部按 **当前用户** 安装（不需要管理员、不弹 UAC）：
;   选择目录 → 结束旧进程 → 复制文件 → 桌面/开始菜单快捷方式 → 卸载登记。
;
; 编译（scripts/build-installer.mjs 调用）：
;   makensis /INPUTCHARSET UTF8 -DPAYLOAD=<win-unpacked> -DVERSION=x.y.z -DOUTFILE=<exe> -DICON=<ico> setup.nsi
; 支持 /S（静默）、/D=<目录>（指定安装目录，必须是最后一个参数、不加引号）。

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
RequestExecutionLevel user
BrandingText "HorunDrama ${VERSION}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APP_NAME "HorunDrama"
!define APP_PUBLISHER "Horun"
!define APP_KEY "Software\HorunDrama"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\HorunDrama"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "${APP_KEY}" "InstallLocation"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_NAME}.exe"
!define MUI_FINISHPAGE_RUN_PARAMETERS "--no-sandbox"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APP_NAME}"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; 只按镜像名结束进程：不做路径前缀匹配，也不会阻塞（结束不掉也继续装）
!macro KillRunning
  nsExec::Exec 'taskkill /f /im "${APP_NAME}.exe"'
  Pop $0
  nsExec::Exec 'taskkill /f /im "${APP_NAME}Core.exe"'
  Pop $0
  ; taskkill 返回后进程退出/释放 exe 句柄有时还需要一小段时间。
  ; 先轮询最多 10 秒；仍占用文件就停止安装，避免 NSIS 给出 Retry/Ignore 并留下半安装状态。
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$deadline=(Get-Date).AddSeconds(10); while ((Get-Process -Name HorunDrama,HorunDramaCore -ErrorAction SilentlyContinue) -and (Get-Date) -lt $$deadline) { Start-Sleep -Milliseconds 250 }; if (Get-Process -Name HorunDrama,HorunDramaCore -ErrorAction SilentlyContinue) { exit 1 }"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "无法关闭 HorunDrama。请先退出软件，再重新运行安装程序。"
    Abort
  ${EndIf}
!macroend

Function .onInit
  ; 2.0.6 及更早（electron-builder oneClick）装到了 @horundesktop，顺手清掉
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\@horundesktop\${APP_NAME}.exe"
    RMDir /r "$LOCALAPPDATA\Programs\@horundesktop"
  ${EndIf}
  !insertmacro KillRunning
FunctionEnd

Section "安装" INSTALL_SECTION
  ; 先确认用户选择的目录确实可写，避免 File /r 失败后出现 Retry/Ignore。
  CreateDirectory "$INSTDIR"
  ClearErrors
  FileOpen $R0 "$INSTDIR\.horundrama-write-test" w
  IfErrors targetNotWritable
  FileClose $R0
  Delete "$INSTDIR\.horundrama-write-test"

  ; 只移除两个可能被旧进程锁定的程序文件；绝不递归删除整个目标目录，
  ; 以免误删用户放在安装目录旁的数据或文件。
  IfFileExists "$INSTDIR\${APP_NAME}.exe" 0 mainExeReady
  SetFileAttributes "$INSTDIR\${APP_NAME}.exe" NORMAL
  Delete "$INSTDIR\${APP_NAME}.exe"
  IfFileExists "$INSTDIR\${APP_NAME}.exe" mainExeLocked 0
mainExeReady:
  IfFileExists "$INSTDIR\${APP_NAME}Core.exe" 0 coreExeReady
  SetFileAttributes "$INSTDIR\${APP_NAME}Core.exe" NORMAL
  Delete "$INSTDIR\${APP_NAME}Core.exe"
  IfFileExists "$INSTDIR\${APP_NAME}Core.exe" coreExeLocked 0
coreExeReady:
  Goto filesReady

targetNotWritable:
  MessageBox MB_ICONSTOP|MB_OK "无法写入安装目录：$INSTDIR。请选择当前用户有写入权限的目录。"
  Abort
mainExeLocked:
  MessageBox MB_ICONSTOP|MB_OK "无法替换 $INSTDIR\${APP_NAME}.exe。请关闭 HorunDrama 后重试。"
  Abort
coreExeLocked:
  MessageBox MB_ICONSTOP|MB_OK "无法替换 $INSTDIR\${APP_NAME}Core.exe。请关闭 HorunDrama 后重试。"
  Abort
filesReady:

  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*.*"

  ; 核心程序设为隐藏，资源管理器里只看到一个 HorunDrama.exe
  ; （用 attrib 而不是 System::Call：System::Call 写错语法会让整个 Section 直接中断，
  ;   表现就是"文件复制完了、快捷方式和卸载登记却没写"，踩过）
  nsExec::Exec 'attrib +h "$INSTDIR\${APP_NAME}Core.exe"'
  Pop $0

  ; 桌面 + 开始菜单快捷方式（按当前用户）
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "--no-sandbox" "$INSTDIR\${APP_NAME}.exe" 0
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "--no-sandbox" "$INSTDIR\${APP_NAME}.exe" 0

  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"

  ; 卸载登记（设置 → 应用 里能看到、能卸载）
  WriteRegStr HKCU "${APP_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_NAME}.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall ${APP_NAME}.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\Uninstall ${APP_NAME}.exe$\" /S"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Function un.onInit
  ; 卸载器的 $INSTDIR 从注册表取；取不到再退回卸载器所在目录
  ReadRegStr $INSTDIR HKCU "${APP_KEY}" "InstallLocation"
  ${If} $INSTDIR == ""
    StrCpy $INSTDIR $EXEDIR
  ${EndIf}
  !insertmacro KillRunning
FunctionEnd

Section "Uninstall"
  ; 先删自己造的东西，再删程序文件
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  Delete "$INSTDIR\Uninstall ${APP_NAME}.exe"
  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${APP_KEY}"
SectionEnd
