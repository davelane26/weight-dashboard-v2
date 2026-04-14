@echo off
:: Sets up Windows Task Scheduler to run Garmin sync every hour
:: Run this ONCE as Administrator

set SCRIPT_DIR=%~dp0
set TASK_NAME=GarminLocalSync
set BAT_FILE=%SCRIPT_DIR%RUN_SYNC.bat

echo Setting up Garmin Local Sync task...
echo Script folder: %SCRIPT_DIR%

:: Delete old task if it exists
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create new task — runs every hour, starts now
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
    echo [OK] Task created! Garmin will sync every hour automatically.
    echo.
    echo Running first sync now...
    call "%BAT_FILE%"
    echo.
    echo Check local_sync.log in this folder to see results.
) else (
    echo.
    echo [FAIL] Could not create task. Try right-clicking this file and running as Administrator.
)

pause
