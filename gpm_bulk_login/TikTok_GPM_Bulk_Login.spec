# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['C:\\Users\\datng\\tiktok-farm\\gpm_bulk_login\\app_gui.py'],
    pathex=[],
    binaries=[],
    datas=[('C:\\Users\\datng\\AppData\\Local\\Python\\pythoncore-3.14-64\\Lib\\site-packages\\playwright\\driver', 'playwright/driver'), ('C:\\Users\\datng\\tiktok-farm\\gpm_bulk_login\\config.json', '.'), ('C:\\Users\\datng\\tiktok-farm\\gpm_bulk_login\\sample_accounts.csv', '.')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='TikTok_GPM_Bulk_Login',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['C:\\Users\\datng\\tiktok-farm\\logo\\app-logo.ico'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='TikTok_GPM_Bulk_Login',
)
