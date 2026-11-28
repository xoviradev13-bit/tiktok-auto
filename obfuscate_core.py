"""
Script tự động obfuscate toàn bộ core backend modules bằng PyArmor để chống dịch ngược (Anti-Reverse Engineering).
"""
import os
import sys
import shutil
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
DIST_OBF = ROOT_DIR / "dist_obf"

CRITICAL_MODULES = [
    "license_manager.py",
    "license_client.py",
    "diagnostics.py",
    "browser_adapters.py",
    "account_health.py",
    "session_reader.py",
    "multi_uploader.py",
    "local_ingestion.py",
    "proton_vpn_controller.py",
    "channel_evaluator.py",
    "tray_manager.py",
    "account_warmup.py",
    "yt_downloader.py",
    "multi_downloader.py",
    "api_v2_routes.py",
    "gpm_client.py",
    "distributor.py",
    "metrics_tracker.py",
    "notifier.py",
    "wireproxy_manager.py",
    "tiktok_uploader.py",
    "tiktok_tracker.py",
    "engagement_bot.py",
    "ai_video_engine.py",
    "proxy_pool.py"
]

def obfuscate_all_core_modules():
    print("=" * 65)
    print(" [ClipFlow] TIẾN HÀNH MÃ HÓA TOÀN BỘ CORE BACKEND CHỐNG DỊCH NGƯỢC")
    print("=" * 65)

    if DIST_OBF.exists():
        shutil.rmtree(DIST_OBF, ignore_errors=True)
    DIST_OBF.mkdir(parents=True, exist_ok=True)

    target_paths = []
    for m in CRITICAL_MODULES:
        p = ROOT_DIR / "backend" / "modules" / m
        if p.exists():
            target_paths.append(str(p))

    print(f"[*] Tìm thấy {len(target_paths)}/{len(CRITICAL_MODULES)} modules core cần mã hóa...")

    cmd = [
        sys.executable, "-m", "pyarmor.cli", "gen",
        "-O", str(DIST_OBF)
    ] + target_paths

    res = subprocess.run(cmd, cwd=str(ROOT_DIR))

    if res.returncode == 0:
        obf_files = list(DIST_OBF.glob("*.py"))
        runtime_files = list(DIST_OBF.glob("pyarmor_runtime_*/*"))
        print(f"\n[OK] Đã mã hóa thành công {len(obf_files)} core modules và tạo {len(runtime_files)} runtime files!")
        return True
    else:
        print(f"\n[!] Quá trình mã hóa thất bại (Code: {res.returncode})")
        return False

if __name__ == "__main__":
    ok = obfuscate_all_core_modules()
    sys.exit(0 if ok else 1)
