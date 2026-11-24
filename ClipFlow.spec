# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from pathlib import Path

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=['.', 'dist_obf'],
    binaries=[],
    datas=[
        ('frontend', 'frontend'),
        ('logo', 'logo'),
        ('.env.example', '.'),
        ('tools', 'tools'),
    ],
    hiddenimports=[
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'fastapi',
        'fastapi.staticfiles',
        'fastapi.middleware.cors',
        'starlette',
        'starlette.middleware.base',
        'pydantic',
        'pystray',
        'pystray._win32',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'playwright',
        'imageio_ffmpeg',
        'yt_dlp',
        'requests',
        'httpx',
        'sqlite3',
        'winreg',
        'webview',
        'backend',
        'backend.app',
        'backend.config',
        'backend.database',
        'backend.logger',
        'backend.scheduler',
        'backend.modules',
        'backend.modules.tray_manager',
        'backend.modules.gpm_client',
        'backend.modules.yt_scanner',
        'backend.modules.yt_downloader',
        'backend.modules.ai_video_engine',
        'backend.modules.tiktok_uploader',
        'backend.modules.metrics_tracker',
        'backend.modules.notifier',
        'backend.modules.yt_monitor',
        'backend.modules.tiktok_tracker',
        'backend.modules.diagnostics',
        'pyarmor_runtime_000000',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'unittest'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# --- PYARMOR OBFUSCATION INTEGRATION (ANTI-REVERSE ENGINEERING) ---
obf_dir = os.path.abspath('dist_obf')
if os.path.exists(obf_dir):
    print(">>> [PyArmor] Patcher: Dang thay the ma nguon bang ma hoa chong dich nguoc (Anti-Reverse)...")
    patched_count = 0
    # Thay thế các file nguồn trong pure
    for i in range(len(a.pure)):
        mod_name = a.pure[i][0]
        if mod_name.startswith('backend.modules.'):
            base_mod = mod_name.split('.')[-1] + '.py'
            obf_file = os.path.join(obf_dir, base_mod)
            if os.path.exists(obf_file):
                a.pure[i] = (mod_name, obf_file, a.pure[i][2])
                patched_count += 1
    print(f">>> [PyArmor] Da tich hop thanh cong {patched_count} modules ma hoa chong reverse vao PYZ bundle!")

    # Bổ sung pyarmor runtime C-extension vào datas
    runtime_dir = os.path.join(obf_dir, 'pyarmor_runtime_000000')
    if os.path.exists(runtime_dir):
        for r_file in os.listdir(runtime_dir):
            src_f = os.path.join(runtime_dir, r_file)
            if os.path.isfile(src_f):
                a.datas.append((f'pyarmor_runtime_000000/{r_file}', src_f, 'DATA'))

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ClipFlow',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # Disabling UPX compression prevents heuristic AV false positives
    console=False, # Windowed desktop app
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='logo/app-logo.ico',
    version='version_info.txt',
    manifest='app.manifest',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='ClipFlow',
)
