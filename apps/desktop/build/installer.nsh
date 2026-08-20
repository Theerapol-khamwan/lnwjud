!macro customInstall
  ; Resolve the shortcut from the actual end-user install directory at install time.
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\lnwjud.lnk" "$INSTDIR\lnwjud.exe" "" "$INSTDIR\lnwjud.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\lnwjud.lnk"
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to keep your user settings and workspaces data?$\n$\n(กด 'Yes' เพื่อเก็บข้อมูลการตั้งค่าและ Workspace ไว้$\nกด 'No' เพื่อลบข้อมูลผู้ใช้ทั้งหมดออกจากเครื่อง)" IDYES keepData
    RMDir /r "$APPDATA\lnwjud"
    RMDir /r "$LOCALAPPDATA\lnwjud"
    RMDir /r "$LOCALAPPDATA\lnwjud-updater"
  keepData:
!macroend
