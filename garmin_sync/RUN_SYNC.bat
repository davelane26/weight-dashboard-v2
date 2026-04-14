@echo off
:: Run Garmin Local Sync and log output
:: This file is called by Windows Task Scheduler

cd /d "%~dp0"
python garmin_local_sync.py >> local_sync.log 2>&1
