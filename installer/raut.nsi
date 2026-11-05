; =====================================================================
;  Raut — установщик для Windows (NSIS 3, Unicode, на пользователя, без UAC)
;
;  Собирается на Linux/macOS/Windows:  node scripts/build-windows.mjs
;  Определения передаёт сборщик:
;    /DRAUT_PAYLOAD=...  /DRAUT_OUTFILE=...  /DRAUT_ICON=...
;    /DRAUT_VERSION=0.2.0
; =====================================================================
Unicode true

!ifndef RAUT_VERSION
  !define RAUT_VERSION "0.2.0"
!endif
!ifndef RAUT_PAYLOAD
  !error "Не задан RAUT_PAYLOAD"
!endif
!ifndef RAUT_OUTFILE
  !define RAUT_OUTFILE "RautSetup.exe"
!endif
!ifndef RAUT_ICON
  !define RAUT_ICON "${RAUT_PAYLOAD}\Raut.ico"
!endif

!define APP_NAME "Raut"
!define APP_VERSION "${RAUT_VERSION}"
!define APP_EXE "Raut.exe"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "${RAUT_OUTFILE}"
InstallDir "$LOCALAPPDATA\Raut"
InstallDirRegKey HKCU "Software\Raut" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "Raut · голос, видео и серверы для своих"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "0.2.0.0"
VIAddVersionKey /LANG=1049 "ProductName" "Raut"
VIAddVersionKey /LANG=1049 "FileDescription" "Raut — мессенджер с голосом и видео"
VIAddVersionKey /LANG=1049 "FileVersion" "${APP_VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductVersion" "${APP_VERSION}.0"
VIAddVersionKey /LANG=1049 "CompanyName" "Raut"
VIAddVersionKey /LANG=1049 "LegalCopyright" "Raut, MIT License"
VIAddVersionKey /LANG=1049 "OriginalFilename" "RautSetup.exe"
VIAddVersionKey /LANG=1033 "ProductName" "Raut"
VIAddVersionKey /LANG=1033 "FileDescription" "Raut — voice, video and servers"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}.0"
VIAddVersionKey /LANG=1033 "CompanyName" "Raut"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Raut, MIT License"
VIAddVersionKey /LANG=1033 "OriginalFilename" "RautSetup.exe"

; ------------------------------- Modern UI -------------------------------
!define MUI_ICON "${RAUT_ICON}"
!define MUI_UNICON "${RAUT_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Установка Raut"
!define MUI_WELCOMEPAGE_TEXT "Raut — ваш собственный мессенджер: серверы, каналы, голос, видео и демонстрация экрана.$\r$\n$\r$\nПереписка шифруется на устройстве (ECDH P-256 + AES-256-GCM), а микрофон проходит через нейросеть-шумодав GTCRN.$\r$\n$\r$\nПрава администратора не нужны: программа ставится в профиль пользователя."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Куда установить Raut. По умолчанию — папка текущего пользователя."
!define MUI_FINISHPAGE_TITLE "Raut установлен"
!define MUI_FINISHPAGE_TEXT "Готово! Запустите Raut — сервер поднимется сам и откроется окно входа.$\r$\n$\r$\nНа Windows 10/11 приложение открывается в отдельном окне, на старых системах — в браузере.$\r$\n$\r$\nПодключить друзей: «Войти по приглашению» → код сервера."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить Raut"
!define MUI_FINISHPAGE_LINK "Краткая инструкция"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!include "WinMessages.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${RAUT_PAYLOAD}\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"
!insertmacro MUI_LANGUAGE "English"

; ------------------------------- секции ---------------------------------
Section "Приложение Raut" SEC_CORE
  SectionIn RO
  ; при обновлении поверх: просим работающий сервер завершиться.
  ; (Raut.exe — GUI-подсистема, консольного вывода нет, поэтому через флаг)
  WriteINIStr "$INSTDIR\data\stop.flag" "raut" "stop" "1"

  SetOutPath "$INSTDIR"
  File /r "${RAUT_PAYLOAD}\*.*"

  WriteRegStr HKCU "Software\Raut" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Raut" "Version" "${APP_VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; меню «Пуск»
  CreateDirectory "$SMPROGRAMS\Raut"
  CreateShortCut "$SMPROGRAMS\Raut\Raut.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\Raut\Остановить Raut.lnk" "$INSTDIR\${APP_EXE}" "--stop" "$INSTDIR\${APP_EXE}" 0
  CreateShortCut "$SMPROGRAMS\Raut\Удалить Raut.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Ярлык на рабочем столе" SEC_DESKTOP
  CreateShortCut "$DESKTOP\Raut.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
SectionEnd

Section "Запускать при входе в Windows" SEC_AUTOSTART
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Raut" '"$INSTDIR\${APP_EXE}" --minimized'
SectionEnd

Section "Uninstall"
  ; флаг остановки + короткая пауза, чтобы сервер успел закрыть файлы
  WriteINIStr "$INSTDIR\data\stop.flag" "raut" "stop" "1"
  Sleep 1200

  Delete "$DESKTOP\Raut.lnk"
  Delete "$SMPROGRAMS\Raut\Raut.lnk"
  Delete "$SMPROGRAMS\Raut\Остановить Raut.lnk"
  Delete "$SMPROGRAMS\Raut\Удалить Raut.lnk"
  RMDir "$SMPROGRAMS\Raut"

  ; данные пользователя (история, файлы, ключи) по умолчанию оставляем
  ${If} ${FileExists} "$INSTDIR\data\*.*"
    MessageBox MB_YESNO|MB_ICONQUESTION "Удалить также переписку и файлы Raut (папка data)?" IDNO keep_data
      RMDir /r "$INSTDIR\data"
    keep_data:
  ${EndIf}

  RMDir /r "$INSTDIR"

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Raut"
  DeleteRegKey HKCU "Software\Raut"
SectionEnd

; ------------------------------ описание ---------------------------------
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_CORE} "Сервер Raut, веб-клиент и запускатор приложения."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "Ярлык Raut на рабочем столе."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_AUTOSTART} "Автоматически поднимать сервер при входе в Windows, чтобы друзья всегда могли подключиться."
!insertmacro MUI_FUNCTION_DESCRIPTION_END
