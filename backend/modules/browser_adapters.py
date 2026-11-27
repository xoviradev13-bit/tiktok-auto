import os
import time
import socket
import threading
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from backend.database import log_event
from backend.logger import get_logger

logger = get_logger("browser_adapters")

class BaseBrowserAdapter(ABC):
    """Lớp cơ sở trừu tượng cho trình duyệt Antidetect"""
    
    @abstractmethod
    def check_health(self) -> Dict[str, Any]:
        """Kiểm tra ứng dụng có đang chạy trên máy tính không"""
        pass

    @abstractmethod
    def list_profiles(self) -> List[Dict[str, Any]]:
        """Lấy danh sách tất cả các profiles"""
        pass

    @abstractmethod
    def start_profile(self, profile_id: str, invisible: Optional[bool] = None, grid_slot: Optional[int] = None) -> Optional[str]:
        """
        Khởi động profile và trả về chuỗi kết nối CDP 
        (dạng '127.0.0.1:port' hoặc 'ws://...') cho Playwright kết nối
        """
        pass

    @abstractmethod
    def stop_profile(self, profile_id: str) -> bool:
        """Đóng profile"""
        pass


class GPMAdapter(BaseBrowserAdapter):
    """Adapter tích hợp duy nhất: GPMLogin App"""
    def __init__(self):
        from backend.modules.gpm_client import gpm_client
        self.client = gpm_client

    def check_health(self) -> Dict[str, Any]:
        h = self.client.check_health()
        return {
            "browser": "gpm",
            "name": "GPMLogin",
            "running": h.get("running", False),
            "profile_count": h.get("profile_count", 0),
            "message": h.get("message", "")
        }

    def list_profiles(self) -> List[Dict[str, Any]]:
        return self.client.get_profiles()

    def start_profile(self, profile_id: str, invisible: Optional[bool] = None, grid_slot: Optional[int] = None) -> Optional[str]:
        return self.client.start_profile(profile_id, invisible=invisible, grid_slot=grid_slot)

    def stop_profile(self, profile_id: str) -> bool:
        return self.client.stop_profile(profile_id)


class UnifiedBrowserManager:
    """
    Bộ quản lý tập trung trình duyệt GPMLogin App.
    """
    def __init__(self):
        self.adapters: Dict[str, BaseBrowserAdapter] = {
            "gpm": GPMAdapter(),
        }

    def get_active_browser(self) -> str:
        return "gpm"

    @property
    def active_browser(self) -> str:
        return "gpm"

    def get_active_adapter(self) -> Optional[BaseBrowserAdapter]:
        return self.adapters.get("gpm")

    def set_active_browser(self, browser_type: str) -> bool:
        return True

    def get_adapter(self, browser_type: str = "gpm") -> Optional[BaseBrowserAdapter]:
        return self.adapters.get("gpm")

    def scan_all_browsers(self) -> List[Dict[str, Any]]:
        """Trả về trạng thái của GPMLogin App"""
        adapter = self.adapters["gpm"]
        try:
            status = adapter.check_health()
            status["is_selected"] = True
            return [status]
        except Exception as e:
            return [{
                "browser": "gpm",
                "running": False,
                "profile_count": 0,
                "is_selected": True,
                "message": str(e)
            }]

    def get_selected_profiles(self) -> List[Dict[str, Any]]:
        """Lấy danh sách profiles từ GPMLogin App"""
        adapter = self.adapters.get("gpm")
        if adapter:
            try:
                profiles = adapter.list_profiles()
                for p in profiles:
                    p["browser_type"] = "gpm"
                return profiles
            except Exception as e:
                logger.error(f"Lỗi lấy profile GPMLogin: {e}")
        return []

    def get_all_profiles(self) -> List[Dict[str, Any]]:
        return self.get_selected_profiles()

    def start_profile(self, profile_id: str, browser_type: Optional[str] = None, invisible: Optional[bool] = None, grid_slot: Optional[int] = None) -> Optional[str]:
        adapter = self.get_adapter("gpm")
        return adapter.start_profile(profile_id, invisible=invisible, grid_slot=grid_slot) if adapter else None

    def stop_profile(self, profile_id: str, browser_type: Optional[str] = None) -> bool:
        adapter = self.get_adapter("gpm")
        return adapter.stop_profile(profile_id) if adapter else False

browser_manager = UnifiedBrowserManager()
