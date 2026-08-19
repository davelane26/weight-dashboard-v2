@echo off
REM ============================================================================
REM  Samsung Health Bridge - one-time setup for djtwo
REM
REM  Registers a Scheduled Task that runs sync_and_push.py every hour, and
REM  triggers an immediate first run.
REM
REM  Run this ONCE as Administrator from the samsung_health_bridge folder.
REM ============================================================================

setlocal

set "BRIDGE_DIR=%~dp0"
set "SCRIPT=%BRIDGE_DIR%sync_and_push.py"
set "TASK_NAME=SamsungHealthBridge"

echo.
echo === Samsung Health Bridge Setup ===
echo.

REM ---- Sanity checks ---------------------------------------------------------

where python >nul 2>&1
if errorlevel 1 (
    echo [error] python not on PATH. Install Python 3.10+ and re-run.
    exit /b 1
)

where rclone >nul 2>&1
if errorlevel 1 (
    echo [error] rclone not on PATH.
    echo         Install from https://rclone.org/downloads/ and re-run.
    echo         Then configure a Google Drive remote with: rclone config
    exit /b 1
)

where git >nul 2>&1
if errorlevel 1 (
    echo [error] git not on PATH. Install Git for Windows and re-run.
    exit /b 1
)

if not exist "%BRIDGE_DIR%bridge_config.json" (
    echo [error] bridge_config.json missing.
    echo         Copy bridge_config.example.json to bridge_config.json and edit.
    exit /b 1
)

echo [ok] python, rclone, git, and bridge_config.json all present.
echo.

REM ---- Register the Scheduled Task -------------------------------------------

echo Registering Scheduled Task "%TASK_NAME%" (hourly)...
schtasks /Create ^
    /TN "%TASK_NAME%" ^
    /TR "python \"%SCRIPT%\"" ^
    /SC HOURLY ^
    /MO 1 ^
    /F ^
    /RL LIMITED
if errorlevel 1 (
    echo [error] Failed to register scheduled task.
    exit /b 1
)
echo [ok] Scheduled Task registered.
echo.

REM ---- Kick off an immediate first run ---------------------------------------

echo Triggering first run now...
schtasks /Run /TN "%TASK_NAME%"
echo.
echo [done] Setup complete.
echo.
echo Watch the first-run output with:
echo     type "%BRIDGE_DIR%sync.log"
echo.
echo Manual re-run:  schtasks /Run /TN %TASK_NAME%
echo Manual disable: schtasks /Delete /TN %TASK_NAME% /F
echo.

endlocal
