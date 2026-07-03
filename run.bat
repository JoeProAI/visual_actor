@echo off
rem Visual Actor — start the local server (Windows). Equivalent to run.sh.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\windows_start_server.ps1" %*
