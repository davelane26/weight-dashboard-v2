@echo off
cd /d "%~dp0"
echo.
echo ===========================================
echo   Garmin Session Setup
echo ===========================================
echo.
echo Option 1: Auto-login (run from home, no VPN)
echo Option 2: Paste token from Chrome DevTools (works anywhere)
echo.
set /p CHOICE="Which option? (1 or 2): "
echo.

if "%CHOICE%"=="1" (
    .venv\Scripts\python.exe generate_session.py
) else (
    .venv\Scripts\python.exe build_session_from_token.py
)

echo.
pause
