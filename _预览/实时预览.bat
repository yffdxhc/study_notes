@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [x] Node.js not found in PATH.
  echo.
  pause
  exit /b 1
)
echo.
echo   Starting live preview server (close this window to stop)...
echo.
node "src\serve.mjs"
pause