# Windows OCR helper

This helper is deliberately separate from the TypeScript process. `Windows.Media.Ocr` requires package identity for desktop use, so the normal NSIS application keeps its existing installer while a signed sparse package supplies identity for this helper.

The helper reads one JSON request per stdin line and writes one `{ ok, value }` response per stdout line. It accepts the existing `vision` OCR payload (`action: "ocr"`, `image_base64`) and returns `available: false` when package identity or a supported user-profile language is unavailable.

Build on a Windows machine with the .NET 8 SDK:

```powershell
dotnet publish .\native\windows-ocr\lnwjud-windows-ocr.csproj -c Release -r win-x64 -o .\native\windows-ocr\bin
```

The runtime discovers the helper through `LNWJUD_WINDOWS_OCR_HELPER` or the packaged `windows-ocr\lnwjud-windows-ocr.exe` location. Until a signed sparse package is registered, the public `vision` OCR action remains truthfully unavailable.

The manifest is a release template only. A release pipeline must replace the placeholder publisher, sign the sparse package, register its external location, and include the published helper next to the NSIS application resources. No certificate or private key belongs in this repository.
