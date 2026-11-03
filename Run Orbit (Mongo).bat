@echo off
setlocal
cd /d "%~dp0"
set NEXT_TELEMETRY_DISABLED=1
set PORT=3002
set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE%" (
  echo Could not find the Node.js runtime bundled with Codex.
  pause
  exit /b 1
)
"%NODE%" ".\scripts\dev.mjs"
pause
