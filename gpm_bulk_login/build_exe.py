#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Build Standalone Executable for TikTok Bulk Login GUI
Using PyInstaller
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

# Locate Playwright driver
import playwright
pw_driver_dir = Path(playwright.__file__).resolve().parent / "driver"

icon_path = ROOT_DIR / "logo" / "app-logo.ico"

cmd = [
    sys.executable,
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--windowed",
    "--name=TikTok_GPM_Bulk_Login",
    f"--add-data={pw_driver_dir};playwright/driver",
    f"--add-data={BASE_DIR / 'config.json'};.",
    f"--add-data={BASE_DIR / 'sample_accounts.csv'};.",
]

if icon_path.exists():
    cmd.append(f"--icon={icon_path}")

cmd.append(str(BASE_DIR / "app_gui.py"))

print("Running PyInstaller build command:")
print(" ".join(cmd))
res = subprocess.run(cmd, cwd=str(BASE_DIR))

if res.returncode == 0:
    print("\n✅ Build succeeded!")
    dist_dir = BASE_DIR / "dist" / "TikTok_GPM_Bulk_Login"
    print(f"Executable directory: {dist_dir}")
    print(f"Exe file: {dist_dir / 'TikTok_GPM_Bulk_Login.exe'}")
else:
    print("\n❌ Build failed with code:", res.returncode)

