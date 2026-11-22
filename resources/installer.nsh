!macro customHeader
  ; Auto-append "\PrismVault" when user browses to a drive root (e.g. J:\ -> J:\PrismVault)
  ; or any parent folder (e.g. D:\Apps -> D:\Apps\PrismVault)
  InstallDir "$LOCALAPPDATA\Programs\PrismVault"
  ; Keep Install button enabled even if user manually types a drive root (instFilesPre appends \PrismVault)
  AllowRootDirInstall true
!macroend
