!macro customHeader
  ; Auto-append "\PrismVault" when user browses to a drive root (e.g. J:\ -> J:\PrismVault)
  ; or any parent folder (e.g. D:\Apps -> D:\Apps\PrismVault)
  InstallDir "$LOCALAPPDATA\Programs\PrismVault"
  ; Keep Install button enabled even if user manually types a drive root (instFilesPre appends \PrismVault)
  AllowRootDirInstall true
!macroend

!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    DetailPrint `正在通知后台运行的 "${PRODUCT_NAME}" 安全保存并退出...`
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      nsExec::Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit-running`
      Sleep 700
    ${EndIf}

    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      ${IfNot} ${isUpdated}
      ${AndIfNot} ${Silent}
        MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK +2
        Quit
      ${EndIf}
      nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      Sleep 500
    ${EndIf}
  ${EndIf}
!macroend
