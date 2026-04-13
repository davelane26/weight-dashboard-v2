@echo off
cd /d "%~dp0"
echo.
echo ===========================================
echo   Garmin Session Setup - Run this at home!
echo ===========================================
echo.
.venv\Scripts\python.exe generate_session.py
echo.
pause
