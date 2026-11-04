; =====================================================================
;  Raut — установщик для Windows (NSIS 3, Unicode, per-user, без UAC)
;  Собирается на Linux: makensis из electron-builder-binaries.
;  Определения передаются скриптом scripts/build-installer.sh:
;    /DRAUT_PAYLOAD=...  /DRAUT_OUTFILE=...  /DRAUT_ICON=...
; =====================================================================
Unicode true

!ifndef RAUT_PUBLIC_URL
  !define RAUT_PUBLIC_URL ""
!endif
; Если задан адрес центрального сервера, установленное приложение
; открывает сразу его — пользователь только регистрируется.
!if "${RAUT_PUBLIC_URL}" != ""
  !define RAUT_URL_ARG ' --public-url "${RAUT_PUBLIC_URL}"'
!else
  !define RAUT_URL_ARG ''
!endif

!ifndef RAUT_VERSION
  !define RAUT_VERSION "1.0.2"
!endif
!define APPNAME "Raut"
!define COMPANY "Raut"
!define APPVERSION "${RAUT_VERSION}"

Name "${APPNAME} ${APPVERSION}"
OutFile "${RAUT_OUTFILE}"
InstallDir "$LOCALAPPDATA\Raut"
InstallDirRegKey HKCU "Software\Raut" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "Raut · независимая связь"
ShowInstDetails show
ShowUninstDetails show
AllowSkipFiles off

VIProductVersion "1.0.2.0"
VIAddVersionKey /LANG=1049 "ProductName" "Raut"
VIAddVersionKey /LANG=1049 "FileDescription" "Установщик Raut — голос, экран и чат"
VIAddVersionKey /LANG=1049 "FileVersion" "1.0.2.0"
VIAddVersionKey /LANG=1049 "ProductVersion" "1.0.2.0"
VIAddVersionKey /LANG=1049 "CompanyName" "Raut"
VIAddVersionKey /LANG=1049 "LegalCopyright" "Raut, MIT License"
VIAddVersionKey /LANG=1049 "OriginalFilename" "RautSetup.exe"
VIAddVersionKey /LANG=1033 "ProductName" "Raut"
VIAddVersionKey /LANG=1033 "FileDescription" "Raut setup — voice, screen share and chat"
VIAddVersionKey /LANG=1033 "FileVersion" "1.0.2.0"
VIAddVersionKey /LANG=1033 "ProductVersion" "1.0.2.0"
VIAddVersionKey /LANG=1033 "CompanyName" "Raut"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Raut, MIT License"
VIAddVersionKey /LANG=1033 "OriginalFilename" "RautSetup.exe"

; ------------------------------- Modern UI -------------------------------
!define MUI_ICON "${RAUT_ICON}"
!define MUI_UNICON "${RAUT_ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Установка Raut"
!define MUI_WELCOMEPAGE_TEXT "Друзья, чат, голос Opus 48 кГц и демонстрация экрана. Скачали — и общаетесь: ничего создавать и настраивать не нужно.$\r$\n$\r$\nПрава администратора не требуются: программа ставится в папку текущего пользователя."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Папка установки. По умолчанию — профиль текущего пользователя."
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_TITLE "Raut установлен"
!define MUI_FINISHPAGE_TEXT "Готово! Зарегистрируйтесь или войдите — друзья, чат и звонки уже работают.$\r$\n$\r$\nНикакой консоли и настроек: сервер запускается сам и не показывает окон."
!define MUI_FINISHPAGE_RUN "$INSTDIR\bin\nodew.exe"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchRaut
!define MUI_FINISHPAGE_RUN_TEXT "Запустить Raut"
!define MUI_FINISHPAGE_LINK "Открыть краткую инструкцию"
!define MUI_FINISHPAGE_LINK_LOCATION "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!include "WinMessages.nsh"
!include "MUI2.nsh"

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

; Запуск — напрямую nodew.exe (GUI-подсистема PE), без WSH/VBS,
; без скрытых окон и БЕЗ консоли. Логи пишутся в app\data\server.log.
Function LaunchRaut
  ExecShell "open" "$INSTDIR\bin\nodew.exe" '"$INSTDIR\app\server\index.js" --client "$INSTDIR\app\client" --data "$INSTDIR\app\data" --host 0.0.0.0 --port 8787 --open --no-console${RAUT_URL_ARG}'
FunctionEnd

; ------------------------------- Секции -------------------------------
Section "Клиент Raut" SEC_CORE
  SectionIn RO
  SetOutPath "$INSTDIR\app\client"
  File /r "${RAUT_PAYLOAD}\client\*.*"
  SetOutPath "$INSTDIR"
  ; Новое имя файла — Windows не возьмёт закешированный старый значок
  Delete "$INSTDIR\Raut.ico"
  File "${RAUT_PAYLOAD}\Raut-logo.ico"
  File "${RAUT_PAYLOAD}\README.txt"
  File "${RAUT_PAYLOAD}\LICENSE.txt"
  File "${RAUT_PAYLOAD}\BUILDINFO.txt"
  WriteRegStr HKCU "Software\Raut" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Локальный сервер (Node.js)" SEC_SERVER
  SetOutPath "$INSTDIR\bin"
  File "${RAUT_PAYLOAD}\bin\nodew.exe"
  SetOutPath "$INSTDIR\app\server"
  File "${RAUT_PAYLOAD}\server\index.js"
  File "${RAUT_PAYLOAD}\server\ws.js"
SectionEnd

Section "Ярлыки в меню «Пуск»" SEC_SHORTCUTS
  SectionIn RO
  CreateDirectory "$SMPROGRAMS\Raut"
  ; свёрнутое, но видимое окно — не «скрытый процесс»
  CreateShortcut "$SMPROGRAMS\Raut\Raut.lnk" "$INSTDIR\bin\nodew.exe" '"$INSTDIR\app\server\index.js" --client "$INSTDIR\app\client" --data "$INSTDIR\app\data" --host 0.0.0.0 --port 8787 --open --no-console${RAUT_URL_ARG}' "$INSTDIR\Raut-logo.ico" 0 SW_SHOWNORMAL
  ; обычное окно: видны логи и LAN-адреса для друзей
  CreateShortcut "$SMPROGRAMS\Raut\Удалить Raut.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Raut-logo.ico" 0
  CreateShortcut "$SMPROGRAMS\Raut\Инструкция.lnk" "$INSTDIR\README.txt"
  CreateShortcut "$SMPROGRAMS\Raut\Состав сборки.lnk" "$INSTDIR\BUILDINFO.txt"
SectionEnd

Section "Ярлык на рабочем столе" SEC_DESKTOP
  CreateShortcut "$DESKTOP\Raut.lnk" "$INSTDIR\bin\nodew.exe" '"$INSTDIR\app\server\index.js" --client "$INSTDIR\app\client" --data "$INSTDIR\app\data" --host 0.0.0.0 --port 8787 --open --no-console${RAUT_URL_ARG}' "$INSTDIR\Raut-logo.ico" 0 SW_SHOWNORMAL
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_CORE} "Веб-клиент, лаунчер и иконка. Устанавливается всегда."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_SERVER} "Сервер аккаунтов, друзей, чата и звонков. Работает сам, без консоли и без настроек."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_SHORTCUTS} "Ярлыки запуска и удаления в меню «Пуск»."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "Быстрый запуск с рабочего стола."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; --------------------------- Реестр / «Программы» ---------------------------
Section "-Registry"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "DisplayName" "Raut"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "DisplayIcon" "$INSTDIR\Raut-logo.ico,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "URLInfoAbout" "https://github.com/MatronixOwner/Raut"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "HelpLink" "$INSTDIR\README.txt"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut" "EstimatedSize" 95000
SectionEnd

; -------------------------------- Удаление --------------------------------
Section "Uninstall"
  Delete "$SMPROGRAMS\Raut\Raut.lnk"
  Delete "$SMPROGRAMS\Raut\Удалить Raut.lnk"
  Delete "$SMPROGRAMS\Raut\Инструкция.lnk"
  Delete "$SMPROGRAMS\Raut\Состав сборки.lnk"
  RMDir "$SMPROGRAMS\Raut"
  Delete "$DESKTOP\Raut.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Raut"
  DeleteRegKey HKCU "Software\Raut"

  MessageBox MB_YESNO|MB_ICONQUESTION "Сохранить историю сообщений и вложения?$\r$\nОни останутся в папке %APPDATA%\Raut\data." IDYES keep_data
  RMDir /r "$INSTDIR\app\data"
  Goto data_done
keep_data:
  CreateDirectory "$APPDATA\Raut"
  RMDir /r "$APPDATA\Raut\data"
  Rename "$INSTDIR\app\data" "$APPDATA\Raut\data"
data_done:
  RMDir /r "$INSTDIR"
SectionEnd

; Сброс кэша значков Windows: новый логотип сразу появится на ярлыке.
Section "-Обновление значков"
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
SectionEnd
