; Explorer menu keys are written by the app (shell_menu.rs) under HKCU.
; The uninstaller must delete them or they would point at a missing exe.
; Helper macros must be defined before the Tauri hook macros that call them.
!macro SECURIPDF_DELETE_MENU EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SecuriPDF"
!macroend

!macro SECURIPDF_APP_PATH EXE
  StrCpy $R8 ""
  ClearErrors
  ReadRegStr $R8 HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\${EXE}" ""
  StrCmp $R8 "" 0 securipdf_skip_office
  StrCpy $R8 ""
  ClearErrors
  ReadRegStr $R8 HKLM "Software\Wow6432Node\Microsoft\Windows\CurrentVersion\App Paths\${EXE}" ""
  StrCmp $R8 "" 0 securipdf_skip_office
  StrCpy $R8 ""
  ClearErrors
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\${EXE}" ""
  StrCmp $R8 "" 0 securipdf_skip_office
!macroend

; Tauri 2 always inserts these four names from installerHooks.
!macro NSIS_HOOK_PREINSTALL
!macroend
!macro NSIS_HOOK_POSTINSTALL
  ; SCCM / Intune: set SECURIPDF_LICENSE to a .lic before silent /S install.
  ClearErrors
  ReadEnvStr $R9 SECURIPDF_LICENSE
  StrCmp $R9 "" securipdf_skip_license 0
    CreateDirectory "$LOCALAPPDATA\net.entera.securipdf.desktop\license"
    CopyFiles /SILENT "$R9" "$LOCALAPPDATA\net.entera.securipdf.desktop\license\deployed.lic"
    ClearErrors
    CreateDirectory "$COMMONAPPDATA\Entera\SecuriPDF"
    CopyFiles /SILENT "$R9" "$COMMONAPPDATA\Entera\SecuriPDF\license.lic"
  securipdf_skip_license:
  IfSilent securipdf_skip_office
  StrCmp $PassiveMode "1" securipdf_skip_office
  !insertmacro SECURIPDF_APP_PATH "WINWORD.EXE"
  !insertmacro SECURIPDF_APP_PATH "EXCEL.EXE"
  !insertmacro SECURIPDF_APP_PATH "POWERPNT.EXE"
  !insertmacro SECURIPDF_APP_PATH "soffice.exe"
  StrCpy $R8 ""
  ClearErrors
  EnumRegKey $R8 HKLM "Software\LibreOffice\LibreOffice" 0
  IfErrors 0 securipdf_skip_office
  StrCpy $R8 ""
  ClearErrors
  EnumRegKey $R8 HKLM "Software\Wow6432Node\LibreOffice\LibreOffice" 0
  IfErrors 0 securipdf_skip_office
  StrCmp $LANGUAGE "1055" 0 securipdf_office_en
    MessageBox MB_OK|MB_ICONINFORMATION "Word, Excel ve PowerPoint dönüşümü için Microsoft Office gerekir. Office yoksa Office belgesinden PDF, kurulu LibreOffice ile yapılır. İkisi de yoksa bu dönüşümler çalışmaz. PDF'i Word belgesine çevirmek için Word şarttır. Diğer PDF araçları Office istemez."
    Goto securipdf_skip_office
  securipdf_office_en:
    MessageBox MB_OK|MB_ICONINFORMATION "Word, Excel and PowerPoint conversion needs Microsoft Office. Without Office, an Office document can still become a PDF through LibreOffice. If neither is installed, those conversions do not run. Turning a PDF into Word requires Word. The other PDF tools do not need Office."
  securipdf_skip_office:
!macroend
!macro NSIS_HOOK_PREUNINSTALL
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro SECURIPDF_DELETE_MENU ".pdf"
  !insertmacro SECURIPDF_DELETE_MENU ".udf"
  !insertmacro SECURIPDF_DELETE_MENU ".doc"
  !insertmacro SECURIPDF_DELETE_MENU ".docx"
  !insertmacro SECURIPDF_DELETE_MENU ".rtf"
  !insertmacro SECURIPDF_DELETE_MENU ".odt"
  !insertmacro SECURIPDF_DELETE_MENU ".xls"
  !insertmacro SECURIPDF_DELETE_MENU ".xlsx"
  !insertmacro SECURIPDF_DELETE_MENU ".ods"
  !insertmacro SECURIPDF_DELETE_MENU ".ppt"
  !insertmacro SECURIPDF_DELETE_MENU ".pptx"
  !insertmacro SECURIPDF_DELETE_MENU ".odp"
!macroend
