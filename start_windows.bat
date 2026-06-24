@echo off
setlocal

chcp 65001 >nul
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_windows.ps1" %*

echo.
echo Server stopped.
pause
