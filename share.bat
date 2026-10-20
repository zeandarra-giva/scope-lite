@echo off
rem Scope Lite, shared: the team can open it from their own browsers and
rem everyone files suggestions into the same list (kept on this computer).
setlocal
cd /d "%~dp0"
title Scope Lite (shared)
call "%~dp0run.bat" -Lan %*
