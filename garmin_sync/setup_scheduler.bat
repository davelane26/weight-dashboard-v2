@echo off
REM ── Setup Windows Task Scheduler for Garmin Sync ────────────
 REM Runs sync_garmin.py --today every 15 minutes
REM Run this script AS ADMINISTRATOR

SET TASK_NAME=GarminSync
SET SCRIPT_DIR=%~dp0
SET PYTHON=%SCRIPT_DIR%.venv\Scripts\python.exe
SET SCRIPT=%SCRIPT_DIR%sync_garmin.py

echo.
echo 🐶 Setting up Garmin Sync scheduled task...
echo    Task: %TASK_NAME%
echo    Script: %SCRIPT%
echo    Python: %PYTHON%
echo    Interval: Every 15 minutes
echo.

REM Delete existing task if it exists
schtasks /delete /tn "%TASK_NAME%" /f 2>nul

REM Create the task - runs every 15 minutes
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "\"%PYTHON%\" \"%SCRIPT%\" --today" ^
  /sc minute ^
  /mo 15 ^
  /f

IF %ERRORLEVEL% EQU 0 (
  echo.
  echo ✅ Task created successfully!
  echo    It will run every 15 minutes.
  echo.
  echo    To check status:  schtasks /query /tn "%TASK_NAME%"
  echo    To run now:       schtasks /run /tn "%TASK_NAME%"
  echo    To delete:        schtasks /delete /tn "%TASK_NAME%" /f
) ELSE (
  echo.
  echo ❌ Failed to create task. Try running as Administrator.
)

pause
