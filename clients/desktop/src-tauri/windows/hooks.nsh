; Explorer menu keys are written by the app (shell_menu.rs) under HKCU.
; The uninstaller must delete them or they would point at a missing exe.
; Helper macros must be defined before the Tauri hook macros that call them.
!macro SECURIPDF_DELETE_MENU EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SecuriPDF"
!macroend

; Tauri 2 always inserts these four names from installerHooks.
!macro NSIS_HOOK_PREINSTALL
!macroend
!macro NSIS_HOOK_POSTINSTALL
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
