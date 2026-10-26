; Associate a known existing local library on first installation.
; The absolute path is detected locally and is never baked into a release.
!macro customInstall
  WriteRegStr HKCU "Software\OpenQuestionStudio" "ApplicationPath" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ReadRegStr $0 HKCU "Software\OpenQuestionStudio" "LibraryPath"
  ${If} $0 == ""
    ${If} ${FileExists} "$EXEDIR\..\Start-App.cmd"
    ${AndIf} ${FileExists} "$EXEDIR\..\data\records.json"
      GetFullPathName $0 "$EXEDIR\..\data"
      WriteRegStr HKCU "Software\OpenQuestionStudio" "LibraryPath" "$0"
    ${ElseIf} ${FileExists} "$EXEDIR\portable-mode.json"
    ${AndIf} ${FileExists} "$EXEDIR\data\records.json"
      GetFullPathName $0 "$EXEDIR\data"
      WriteRegStr HKCU "Software\OpenQuestionStudio" "LibraryPath" "$0"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\OpenQuestionStudio" "ApplicationPath"
!macroend
