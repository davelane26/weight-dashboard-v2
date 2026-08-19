@echo off
:: One-time setup: register RUN_SYNC.bat to run every hour via Windows
:: Task Scheduler. Right-click and "Run as Administrator" for /rl HIGHEST.

set SCRIPT_DIR=%~dp0
set TASK_NAME=GlappShotSync
set BAT_FILE=%SCRIPT_DIR%RUN_SYNC.bat

echo Setting up Glapp Shot Sync scheduled task...
echo Script folder: %SCRIPT_DIR%

:: Wipe any prior version of the task so re-runs of this script are clean.
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Hourly cadence starting at :00. Overkill for shots (which land weekly),
:: but harmless and idempotent — the scraper writes the same JSON to the
:: same inbox path, dedupe happens on the dashboard side by shot id.
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "\"%BAT_FILE%\"" ^
  /sc hourly ^
  /mo 1 ^
  /st 00:00 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %ERRORLEVEL% == 0 (
    echo.
    echo [OK] Task created. Running first sync now...
    call "%BAT_FILE%"
    echo.
    echo Check sync.log in this folder to see the result.
) else (
    echo.
    echo [FAIL] Could not create task. Run this file as Administrator.
)

pause
