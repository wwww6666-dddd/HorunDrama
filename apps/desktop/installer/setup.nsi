; HorunDrama 安装器 —— 自己写的 NSIS 脚本（不再用 electron-builder 的模板）
;
; 为什么不用 electron-builder 的 NSIS 模板：
;   1) oneClick 模式把安装目录算成 %LOCALAPPDATA%\Programs\@horundesktop；
;   2) 改成 assisted（oneClick:false）后它又会塞 INSTALL_MODE_PER_ALL_USERS_REQUIRED，
;      按"为所有用户安装"来跑，静默/无管理员时行为就乱了；
;   3) 它的"程序还在运行"检查用 PowerShell 的 $_.Path.StartsWith('$INSTDIR')，
;      $INSTDIR 为空时恒真 → 会把整机进程当成 HorunDrama 去强杀，杀不完就弹
;      「HorunDrama 无法关闭」卡死安装。
; 这个脚本默认按 **当前用户** 安装，默认目录不弹 UAC：
;   显示 GPL 许可证 → 选择目录 → 检查目标目录可写 → 检查目标程序文件是否被占用 →
;   复制文件 → 创建快捷方式和卸载登记。
; 参考 electron-builder / Unsloth Desktop 的成熟做法：不全局要求管理员；先对
; $INSTDIR 做一次真实写入探针，只有目标目录确实不可写且当前不是管理员时，才用
; ShellExecute 的 runas 谓词重启自身并要求一次 UAC，重启后带 /RELAUNCH 防止循环。
; 这样低完整性启动、受控文件夹访问和自定义受保护目录不会被误判为“所有文件都写不进去”。
;
; 编译（scripts/build-installer.mjs 调用）：
;   makensis /INPUTCHARSET UTF8 -DPAYLOAD=<win-unpacked> -DVERSION=x.y.z -DOUTFILE=<exe> -DICON=<ico> setup.nsi
; 支持 /S（静默）、/D=<目录>（指定安装目录，必须是最后一个参数、不加引号）。

Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 32
RequestExecutionLevel user
; 不让 NSIS 在写失败时静默选择 Ignore，避免“安装完成但文件缺失”。
AllowSkipFiles off
BrandingText "HorunDrama ${VERSION}"
Var RELAUNCHED

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
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_NAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APP_NAME}"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  StrCpy $RELAUNCHED "0"
  ${GetParameters} $R0
  ${GetOptions} $R0 "/RELAUNCH" $R1
  ; GetOptions 找不到时设置错误位；找到了就清除错误位。
  IfErrors +2 0
    StrCpy $RELAUNCHED "1"
FunctionEnd

; 真实写入探针只用于判断是否需要一次 UAC 重启：
; - 默认 %LOCALAPPDATA% 在普通桌面令牌下可写，不会弹 UAC；
; - 低完整性/受保护目录在普通令牌下不可写，重启到管理员令牌后再装；
; - /RELAUNCH 已重启过一次仍失败时直接给出明确错误，绝不循环。
Function EnsureInstallDirWritable
  ClearErrors
  SetOutPath "$INSTDIR"
  IfErrors ensureDirFailed

  FileOpen $0 "$INSTDIR\.horundrama-write-probe" w
  IfErrors ensureDirFailed
  FileWrite $0 "probe"
  FileClose $0
  Delete "$INSTDIR\.horundrama-write-probe"
  Return

ensureDirFailed:
  Delete "$INSTDIR\.horundrama-write-probe"

  ${If} $RELAUNCHED == "1"
    MessageBox MB_ICONSTOP|MB_OK "安装目录仍不可写：$INSTDIR$\r$\n$\r$\n请改选当前用户有写入权限的目录，或以管理员身份运行安装程序。" /SD IDOK
    Abort
  ${EndIf}

  System::Call 'shell32::IsUserAnAdmin() i .r0'
  ${If} $0 == 1
    MessageBox MB_ICONSTOP|MB_OK "当前已是管理员权限，但仍无法写入：$INSTDIR$\r$\n$\r$\n请检查目录权限、只读属性或安全软件拦截。" /SD IDOK
    Abort
  ${EndIf}

  MessageBox MB_ICONINFORMATION|MB_TOPMOST|MB_OK "安装目录需要管理员权限，安装程序将以管理员身份重新启动。$\r$\n$\r$\n$INSTDIR" /SD IDOK
  ExecShell "runas" "$EXEPATH" "$CMDLINE /RELAUNCH /D=$INSTDIR"
  Quit
FunctionEnd

Section "安装" INSTALL_SECTION
  Call EnsureInstallDirWritable

  ; 只移除两个可能被旧进程锁定的程序文件；绝不递归删除整个目标目录，
  ; 以免误删用户放在安装目录旁的数据或文件。
  ; 旧版安装可能留下隐藏的卸载清单；它是编译期文件，不属于运行载荷。
  SetFileAttributes "$INSTDIR\.horundrama-uninstall.nsh" NORMAL
  Delete "$INSTDIR\.horundrama-uninstall.nsh"
  Delete "$INSTDIR\horundrama-uninstall.nsh"
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

mainExeLocked:
  MessageBox MB_ICONSTOP|MB_OK "无法替换 $INSTDIR\${APP_NAME}.exe。请关闭 HorunDrama 后重试。"
  Abort
coreExeLocked:
  MessageBox MB_ICONSTOP|MB_OK "无法替换 $INSTDIR\${APP_NAME}Core.exe。请关闭 HorunDrama 后重试。"
  Abort
filesReady:

  ClearErrors
  SetOutPath "$INSTDIR"
  ; .horundrama-uninstall.nsh 只用于编译卸载段，不能复制到安装目录：
  ; 旧版把它当普通载荷复制，遇到只读/隐藏残留时会弹“不能打开要写入的文件”。
  ; /nonfatal 让真正的权限/占用错误落到下面的 IfErrors，而不是卡在 Retry/Ignore 对话框。
  File /nonfatal /r /x ".horundrama-uninstall.nsh" "${PAYLOAD}\*.*"
  IfErrors copyFailed
  Goto filesCopied
copyFailed:
  MessageBox MB_ICONSTOP|MB_OK "复制安装文件失败：$INSTDIR。$\r$\n$\r$\n请改选当前用户有写入权限的目录（推荐默认的 %LOCALAPPDATA%\Programs\HorunDrama），或关闭“受控文件夹访问”/杀毒软件后重试。"
  Abort
filesCopied:

  ; 核心程序设为隐藏，资源管理器里只看到一个 HorunDrama.exe
  ; （用 attrib 而不是 System::Call：System::Call 写错语法会让整个 Section 直接中断，
  ;   表现就是"文件复制完了、快捷方式和卸载登记却没写"，踩过）
  nsExec::Exec 'attrib +h "$INSTDIR\${APP_NAME}Core.exe"'
  Pop $0

  ; 桌面 + 开始菜单快捷方式（按当前用户）
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "" "$INSTDIR\${APP_NAME}.exe" 0
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_NAME}.exe" "" "$INSTDIR\${APP_NAME}.exe" 0

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
FunctionEnd

Section "Uninstall"
  ; 只删除安装载荷清单中的文件，保留用户放在安装目录中的其他内容。
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  !include "${PAYLOAD}\.horundrama-uninstall.nsh"
  Delete "$INSTDIR\Uninstall ${APP_NAME}.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "${APP_KEY}"
SectionEnd
