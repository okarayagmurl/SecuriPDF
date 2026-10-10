; The Explorer menu is written by the app itself (shell_menu.rs) under HKCU,
; so the uninstaller has to remove it or the entries would point at a missing exe.
!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SecuriPDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.udf\shell\SecuriPDF"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".doc"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".docx"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".rtf"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".odt"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".xls"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".xlsx"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".ods"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".ppt"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".pptx"
  !insertmacro SECURIPDF_DELETE_OFFICE_MENU ".odp"
!macroend

!macro SECURIPDF_DELETE_OFFICE_MENU EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\SecuriPDF"
!macroend
