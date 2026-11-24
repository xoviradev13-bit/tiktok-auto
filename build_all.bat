@echo off
title ClipFlow - Build Executable & Installer
color 0b

echo ========================================================
echo   CLIPFLOW & AI VIDEO ENGINE - BUILD PIPELINE
echo ========================================================
echo.

REM 0. PyArmor Obfuscation (Mã hóa chống decompile)
echo [0/3] Dang ma hoa cac module bao mat bang PyArmor...
python obfuscate_core.py
if %errorlevel% neq 0 (
    echo [CANH BAO] Qua trinh ma hoa PyArmor gap su co, tiep tuc voi PyInstaller goc...
)

REM 1. PyInstaller Build
echo [1/3] Dang dong goi Executable voi PyInstaller...
python -m PyInstaller --clean --noconfirm ClipFlow.spec
if %errorlevel% neq 0 (
    echo [LOI] Qua trinh dong goi PyInstaller that bai!
    pause
    exit /b 1
)

REM 2. Code Signing & Inno Setup
echo [2/3] Dang ky so Authenticode va bien dich Installer...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build_installer.ps1

if %errorlevel% neq 0 (
    echo [LOI] Qua trinh bien dich Installer that bai!
    pause
    exit /b 1
)

echo.
echo ========================================================
echo [HOAN TAT THU MUC OUTPUT]:
echo 1. Bo cai dat: dist_installer\ClipFlow_Setup_v1.0.0.exe
echo 2. File chay truc tiep: dist\ClipFlow\ClipFlow.exe
echo 3. Chung chi so: dist_installer\ClipFlow_Developer.cer
echo ========================================================
echo.
pause
