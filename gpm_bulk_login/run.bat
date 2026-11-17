@echo off
chcp 65001 >nul
title TikTok Bulk Login - GPMLogin Global

cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found in system PATH!
    echo Please install Python 3.10+ from python.org and ensure "Add to PATH" is checked.
    pause
    exit /b 1
)

if "%~1"=="" (
    start "" python app_gui.py
) else (
    python bulk_login.py "%~1"
    pause
)
