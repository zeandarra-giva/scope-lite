@echo off
rem Scope Lite: double-click to start. Opens in your browser at http://127.0.0.1:8080
rem Only this computer can open it. Use share.bat to let the team in.
setlocal
cd /d "%~dp0"
title Scope Lite
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" %*
if errorlevel 1 (
  echo.
  echo The Scope Lite server could not start, so it will open without it.
  echo Suggestions will be saved in this browser only until the server runs.
  start "" "%~dp0index.html"
  pause
)
