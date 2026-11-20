import os
import time
from typing import Dict, Any, Optional
from backend.modules.tiktok_uploader import TikTokUploader
from backend.database import log_event
from backend.logger import get_logger

logger = get_logger("multi_uploader")

class MultiPlatformUploader:
    """
    Trình tự động đăng video lên TikTok
    Điều khiển qua trình duyệt Antidetect (GPM-Login)
    """
    def __init__(self):
        self.tiktok = TikTokUploader()

    def upload(
        self,
        platform: str = "tiktok",
        profile_id: str = "",
        video_path: str = "",
        title: str = "",
        tags: str = "#viral #fyp #trending",
        browser_type: str = "auto",
        auto_post: bool = True,
        close_browser_on_finish: bool = False,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Đăng video lên TikTok qua GPM-Login.
        Tự động quản lý khóa Profile Busy Lock để tránh tranh chấp browser đa luồng.
        """
        from backend.modules.tiktok_tracker import set_profile_busy
        set_profile_busy(profile_id, True)
        try:
            return self.tiktok.upload_via_gpm(
                gpm_profile_id=profile_id,
                video_path=video_path,
                title=title,
                tags=tags,
                auto_post=auto_post,
                close_browser_on_finish=close_browser_on_finish,
                browser_type=browser_type,
                enable_warmup=kwargs.get("enable_warmup", False),
                warmup_minutes=kwargs.get("warmup_minutes", None)
            )
        finally:
            set_profile_busy(profile_id, False)

multi_uploader = MultiPlatformUploader()
