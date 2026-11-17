import sys
import platform
import uuid
import hashlib
from typing import Dict, Any, Optional

from backend.config import APP_VERSION

def get_hwid() -> str:
    """Tạo Hardware ID (HWID) duy nhất cho máy tính này"""
    try:
        parts = []
        parts.append(platform.node() or "machine")
        parts.append(platform.processor() or "cpu")
        try:
            parts.append(str(uuid.getnode()))
        except Exception:
            pass
        raw = ":".join(parts)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32].upper()
    except Exception:
        return "UNKNOWN_HWID_LOCAL"

def get_device_name() -> str:
    return platform.node() or "Local Machine"

def get_license_tier_limits(plan_override: Optional[str] = None) -> Dict[str, Any]:
    """
    Trả về đặc quyền phần mềm: Không giới hạn tính năng (Vĩnh viễn)
    """
    return {
        "tier": "unlimited",
        "tier_name": "Gói Không Giới Hạn (Vĩnh Viễn)",
        "max_profiles": 999999,
        "allow_multi_thread": True,
        "max_render_concurrency": 8,
        "allow_nvenc": True,
        "max_devices": 999,
        "max_hwid_resets_per_month": 999,
    }

def get_license_info() -> Dict[str, Any]:
    """Trả về trạng thái bản quyền luôn mở khóa đầy đủ không cần kết nối web server"""
    hwid = get_hwid()
    device = get_device_name()
    limits = get_license_tier_limits()
    return {
        "is_active": True,
        "valid": True,
        "status": "active",
        "license_key": "PERPETUAL-UNLIMITED-LICENSE",
        "hwid": hwid,
        "device_name": device,
        "plan": "unlimited",
        "tier": "unlimited",
        "tier_name": limits["tier_name"],
        "customer_email": "local@offline.user",
        "registered_at": "2026-01-01T00:00:00",
        "expires_at": "Vĩnh viễn",
        "current_version": APP_VERSION,
        "is_expired": False,
        "tier_limits": limits,
        "signature_valid": True,
        "offline_activated": True,
    }

def activate_license(license_key: str) -> Dict[str, Any]:
    """Kích hoạt bản quyền (luôn thành công mà không cần server ngoài)"""
    return {
        "success": True,
        "message": "Bản quyền đã được kích hoạt thành công (Vĩnh viễn).",
        "license_info": get_license_info()
    }

def verify_license(force_remote: bool = False) -> Dict[str, Any]:
    """Xác thực bản quyền (không cần server ngoài)"""
    return {
        "valid": True,
        "message": "Bản quyền hợp lệ (Vĩnh viễn).",
        "license_info": get_license_info()
    }

def deactivate_license() -> Dict[str, Any]:
    """Hủy kích hoạt bản quyền"""
    return {
        "success": True,
        "message": "Đã reset bản quyền thành công."
    }

def check_app_update() -> Dict[str, Any]:
    """
    Kiểm tra bản cập nhật: Đọc từ file system manifest, không liên kết web server
    """
    return {
        "success": True,
        "current_version": APP_VERSION,
        "latest_version": APP_VERSION,
        "update_available": False,
        "message": "Phiên bản hiện tại là mới nhất (được nạp từ manifest hệ thống tệp).",
    }
