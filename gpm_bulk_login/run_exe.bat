@echo off
cd /d "%~dp0"
if exist "dist\TikTok_GPM_Bulk_Login\TikTok_GPM_Bulk_Login.exe" (
    start "" "dist\TikTok_GPM_Bulk_Login\TikTok_GPM_Bulk_Login.exe"
) else (
    echo [ERROR] Executable not found in dist\TikTok_GPM_Bulk_Login\TikTok_GPM_Bulk_Login.exe
    pause
)

