@echo off
setlocal
cd /d "%~dp0"
echo.
echo USALB Radio - Windows broadcaster setup
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-usabl-broadcaster.ps1"
if errorlevel 1 (
  echo.
  echo Setup could not start. Read the message above and try again.
  pause
)