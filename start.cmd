@echo off
setlocal
cd /d "%~dp0"
if exist "release\CodexModelConfig-1.0.0-win-x64.exe" (
  start "" "release\CodexModelConfig-1.0.0-win-x64.exe"
  exit /b 0
)
if exist "release\win-unpacked\Codex Model Manager.exe" (
  start "" "release\win-unpacked\Codex Model Manager.exe"
  exit /b 0
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install from https://nodejs.org/
  pause
  exit /b 1
)
npm.cmd start -- %*
if errorlevel 1 pause
