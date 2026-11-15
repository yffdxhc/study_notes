@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] Node.js not found in PATH.
  echo       Install Node.js first, then run this again.
  echo.
  pause
  exit /b 1
)
node "src\build.mjs" --open
if errorlevel 1 (
  echo.
  echo   [x] Build failed. See the messages above.
  pause
  exit /b 1
)
exit /b 0