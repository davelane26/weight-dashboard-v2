@echo off
:: Run the Glapp headless sync and append output to sync.log.
:: This file is what Windows Task Scheduler calls.

cd /d "%~dp0"

:: Use the local venv if it exists; else fall back to system python.
if exist ".glapp_venv\Scripts\python.exe" (
    ".glapp_venv\Scripts\python.exe" glapp_sync.py >> sync.log 2>&1
) else (
    python glapp_sync.py >> sync.log 2>&1
)
