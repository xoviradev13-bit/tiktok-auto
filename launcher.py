import os
import sys
import subprocess
from pathlib import Path

def get_version_from_manifest() -> str:
    """Đọc phiên bản trực tiếp từ manifest hệ thống tệp thay vì kết nối máy chủ web"""
    base_dir = Path(__file__).resolve().parent
    manifest_candidates = [
        base_dir / "app.manifest",
        base_dir / "manifest.json"
    ]
    for mpath in manifest_candidates:
        if mpath.exists():
            try:
                if mpath.suffix.lower() == ".manifest":
                    import xml.etree.ElementTree as ET
                    tree = ET.parse(str(mpath))
                    root = tree.getroot()
                    for elem in root.iter():
                        if elem.tag.endswith("assemblyIdentity"):
                            ver = elem.attrib.get("version")
                            if ver:
                                parts = ver.split(".")
                                if len(parts) == 4 and parts[-1] == "0":
                                    return ".".join(parts[:3])
                                return ver
                elif mpath.suffix.lower() == ".json":
                    import json
                    data = json.loads(mpath.read_text(encoding="utf-8"))
                    if "version" in data:
                        return str(data["version"])
            except Exception:
                pass
    return "1.0.0"

CURRENT_VERSION = get_version_from_manifest()

def print_banner():
    print("=" * 60)
    print(f"      SHORTSSTACK AI STUDIO - LAUNCHER")
    print(f"                 Phiên bản hiện tại: v{CURRENT_VERSION}")
    print("=" * 60)

def launch_main_app():
    """Khởi động ứng dụng chính"""
    print("\n[OK] Đang khởi động hệ thống ShortsStack Studio...")
    main_py = Path(__file__).resolve().parent / "main.py"
    
    if getattr(sys, "frozen", False):
        app_exe = Path(sys.executable).parent / "ShortsStack.exe"
        if app_exe.exists():
            subprocess.Popen([str(app_exe)])
            sys.exit(0)

    os.system(f'"{sys.executable}" "{main_py}"')

if __name__ == "__main__":
    print_banner()
    launch_main_app()
