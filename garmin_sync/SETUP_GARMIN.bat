@echo off
cd /d "%~dp0"
echo ===================================================
echo   Garmin Connect Setup & One-Time Login
echo ===================================================
python setup_garmin.py
echo.
pause
