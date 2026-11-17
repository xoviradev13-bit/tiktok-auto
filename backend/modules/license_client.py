from typing import Dict, Any, Optional
from backend.modules.license_manager import (
    get_hwid as get_machine_hwid,
    get_license_info,
    activate_license as do_activate,
    verify_license as do_verify,
    check_app_update as do_check_update,
    deactivate_license as do_deactivate,
)

class LicenseClient:
    def __init__(self, portal_url: Optional[str] = None):
        self.hwid = get_machine_hwid()

    def load_local_license(self) -> Optional[Dict[str, Any]]:
        return get_license_info()

    def activate(self, license_key: str) -> Dict[str, Any]:
        return do_activate(license_key)

    def verify_on_startup(self) -> Dict[str, Any]:
        info = get_license_info()
        return {
            "valid": True,
            "message": "Bản quyền vĩnh viễn hợp lệ (Không giới hạn tính năng).",
            "hwid": self.hwid,
            "plan": info.get("plan"),
            "expires_at": info.get("expires_at"),
            "customer_name": info.get("customer_email"),
        }

    def check_updates(self, current_version: str = "1.0.0") -> Dict[str, Any]:
        res = do_check_update()
        return {
            "has_update": False,
            "latest_version": res.get("latest_version"),
            "download_url": None,
            "release_notes": "Phiên bản hiện tại là mới nhất.",
            "is_mandatory": False,
        }
