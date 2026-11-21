import os
import socket
import platform
from pathlib import Path
from fastapi import APIRouter, HTTPException, Body
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from backend.database import get_connection, log_campaign_event, log_event
from backend.logger import get_logger
from backend.modules.browser_adapters import browser_manager
from backend.modules.multi_downloader import multi_downloader
from backend.modules.multi_uploader import multi_uploader
from backend.modules.local_ingestion import local_ingestor, is_rss_scan_enabled, set_rss_scan_enabled
from backend.modules.license_client import LicenseClient, get_machine_hwid

logger = get_logger("api_v2_routes")

router = APIRouter(prefix="/api/v2", tags=["v2_features"])

# --- 1. Trình Duyệt GPMLogin ---
class SelectBrowserRequest(BaseModel):
    browser: str = "gpm"

@router.get("/browsers/active")
def get_active_browser():
    """Lấy trình duyệt đang được sử dụng (GPMLogin)"""
    active = "gpm"
    options = [
        {"id": "gpm", "name": "GPMLogin", "desc": "GPMLogin App Integration"},
    ]
    return {
        "active_browser": active,
        "options": options,
        "browsers_status": browser_manager.scan_all_browsers()
    }

@router.post("/browsers/select")
def set_active_browser(req: SelectBrowserRequest):
    """Xác nhận sử dụng GPMLogin App"""
    browser_manager.set_active_browser("gpm")
    return {
        "success": True,
        "active_browser": "gpm",
        "message": "Đang sử dụng GPMLogin App!"
    }

@router.get("/browsers/status")
def get_browsers_status():
    """Kiểm tra trạng thái GPMLogin App"""
    return {
        "active_browser": "gpm",
        "browsers": browser_manager.scan_all_browsers()
    }

@router.get("/browsers/profiles")
def get_all_profiles(browser: Optional[str] = None):
    """
    Lấy danh sách profile từ GPMLogin App
    """
    return {
        "profiles": browser_manager.get_selected_profiles(),
        "selected_browser": "gpm"
    }

# --- 2. Quản Lý Nạp Thư Mục Cục Bộ & Tắt Quét RSS ---
@router.get("/pipeline/rss_status")
def get_rss_status():
    """Kiểm tra quét RSS tự động đang bật hay tắt"""
    return {
        "rss_scan_enabled": is_rss_scan_enabled()
    }

class ToggleRSSRequest(BaseModel):
    enabled: bool

@router.post("/pipeline/toggle_rss")
def toggle_rss_mode(req: ToggleRSSRequest):
    """Bật / Tắt chế độ quét RSS YouTube tự động"""
    success = set_rss_scan_enabled(req.enabled)
    return {
        "success": success,
        "rss_scan_enabled": req.enabled,
        "message": f"Chế độ quét RSS đã {'bật' if req.enabled else 'tắt'}"
    }

class ScanFolderRequest(BaseModel):
    folder_path: str

@router.post("/pipeline/scan_folder")
def scan_local_folder(req: ScanFolderRequest):
    """Quét thư mục máy tính để tìm các file video có sẵn"""
    files = local_ingestor.scan_folder(req.folder_path)
    return {
        "count": len(files),
        "files": files
    }

class IngestVideosRequest(BaseModel):
    file_paths: List[str]
    channel_id: Optional[str] = "LOCAL_IMPORT"
    auto_render: Optional[bool] = True

@router.post("/pipeline/ingest_videos")
def ingest_videos(req: IngestVideosRequest):
    """Nạp danh sách video vào hệ thống để render AI và xếp hàng đăng"""
    result = local_ingestor.ingest_local_videos(
        file_paths=req.file_paths,
        channel_id=req.channel_id,
        auto_render=req.auto_render
    )
    return result

# --- 3. Tải Video Đa Nền Tảng ---
def get_direct_download_dir() -> Path:
    """Lấy thư mục tải về cho Direct Links từ Cài đặt hoặc mặc định data/downloads/Direct Links"""
    from backend.config import DOWNLOADS_DIR
    from backend.database import get_connection
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'direct_download_dir'")
        row = cursor.fetchone()
        conn.close()
        if row and row[0] and row[0].strip():
            p = Path(row[0].strip())
            p.mkdir(parents=True, exist_ok=True)
            return p
    except Exception:
        pass
    p = DOWNLOADS_DIR / "Direct Links"
    p.mkdir(parents=True, exist_ok=True)
    return p

class DownloadRequest(BaseModel):
    url: str

class DownloaderSettingsRequest(BaseModel):
    direct_download_dir: str

@router.get("/downloader/settings")
def get_downloader_settings():
    """Lấy cấu hình thư mục lưu video Direct Links hiện tại"""
    from backend.config import DOWNLOADS_DIR
    from backend.database import get_connection
    current_dir = ""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM settings WHERE key = 'direct_download_dir'")
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            current_dir = row[0].strip()
    except Exception:
        pass
    default_dir = str(DOWNLOADS_DIR / "Direct Links")
    return {
        "status": "success",
        "direct_download_dir": current_dir or default_dir,
        "default_dir": default_dir,
        "is_custom": bool(current_dir and current_dir != default_dir)
    }

@router.post("/downloader/settings")
def save_downloader_settings(req: DownloaderSettingsRequest):
    """Cập nhật thư mục lưu video Direct Links theo người dùng chọn"""
    from backend.database import get_connection
    path = req.direct_download_dir.strip()
    if path:
        try:
            p = Path(path)
            p.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Đường dẫn thư mục không hợp lệ: {e}")
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('direct_download_dir', ?)", (path,))
    conn.commit()
    conn.close()
    return {"status": "success", "direct_download_dir": path, "message": "Đã cập nhật thư mục tải Direct Links thành công!"}

active_download_tasks = {}

def record_downloaded_video_to_db(url: str, result: dict):
    """Ghi nhận video mới tải thành công vào CSDL và đồng bộ thư viện"""
    try:
        from backend.database import get_connection
        import hashlib
        conn = get_connection()
        cursor = conn.cursor()
        f_path = result.get("file_path", "")
        f_name = Path(f_path).name if f_path else ""
        vid_id = result.get("video_id") or f"local_{hashlib.md5(f_name.encode('utf-8', errors='ignore')).hexdigest()[:8]}"
        title = result.get("title") or f_name
        platform = result.get("platform") or multi_downloader.detect_platform(url)
        duration = result.get("duration", 0)
        cursor.execute("""
            INSERT INTO videos (channel_id, yt_video_id, title, original_url, duration, download_path, status, platform, created_at)
            VALUES ('Direct Links', ?, ?, ?, ?, ?, 'downloaded', ?, datetime('now', 'localtime'))
            ON CONFLICT(yt_video_id) DO UPDATE SET
                download_path=excluded.download_path,
                title=excluded.title,
                original_url=excluded.original_url,
                platform=excluded.platform,
                status='downloaded'
        """, (vid_id, title, url, duration, f_path, platform))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Lỗi ghi video tải về vào DB: {e}")

    try:
        from backend.app import sync_local_videos_with_db
        sync_local_videos_with_db()
    except Exception:
        pass

@router.post("/downloader/start")
def start_multi_download(req: DownloadRequest):
    """Bắt đầu tải video bất đồng bộ với live progress tracking"""
    import uuid
    import threading
    task_id = str(uuid.uuid4())[:8]
    target_dir = get_direct_download_dir()

    active_download_tasks[task_id] = {
        "task_id": task_id,
        "url": req.url,
        "status": "downloading",
        "percent": 0.0,
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "speed": "",
        "eta": "",
        "message": "Đang kết nối & phân tích liên kết...",
        "title": "",
        "file_path": "",
        "error": None
    }

    def _worker():
        def _cb(pct, dl, total, speed, eta, msg, title=""):
            t = active_download_tasks.get(task_id)
            if t:
                t["percent"] = pct
                t["downloaded_bytes"] = dl
                t["total_bytes"] = total
                if speed: t["speed"] = speed
                if eta: t["eta"] = eta
                if msg: t["message"] = msg
                if title and not t.get("title"): t["title"] = title

        try:
            res = multi_downloader.download(req.url, output_dir=target_dir, progress_callback=_cb)
            t = active_download_tasks.get(task_id)
            if not res.get("success"):
                if t:
                    t["status"] = "failed"
                    t["error"] = res.get("message", "Lỗi tải video")
                    t["message"] = t["error"]
                return

            record_downloaded_video_to_db(req.url, res)
            if t:
                t["status"] = "completed"
                t["percent"] = 100.0
                t["file_path"] = res.get("file_path", "")
                t["title"] = res.get("title", "") or t.get("title", "")
                t["message"] = "Tải thành công và đã đồng bộ vào kho video!"
        except Exception as e:
            logger.error(f"Lỗi worker tải video: {e}")
            t = active_download_tasks.get(task_id)
            if t:
                t["status"] = "failed"
                t["error"] = str(e)
                t["message"] = f"Lỗi: {str(e)}"

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    return {"status": "started", "task_id": task_id, "message": "Đang tải video trong nền..."}

@router.get("/downloader/progress/{task_id}")
def get_download_progress(task_id: str):
    """Lấy trạng thái & phần trăm tiến độ tải theo thời gian thực"""
    if task_id not in active_download_tasks:
        raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình tải này")
    return active_download_tasks[task_id]

@router.post("/downloader/download")
def download_multi_platform(req: DownloadRequest):
    """
    Tải video sạch không watermark từ:
    Douyin, Xiaohongshu/RedNote, YouTube, Facebook, Instagram, Weibo, Bilibili
    Lưu tự động vào thư mục Direct Links được cấu hình và đồng bộ thư viện
    """
    target_dir = get_direct_download_dir()
    result = multi_downloader.download(req.url, output_dir=target_dir)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Lỗi tải video"))
    record_downloaded_video_to_db(req.url, result)
    return result

# --- 4. Đăng Video Đa Nền Tảng ---
class PublishRequest(BaseModel):
    platform: str # 'tiktok' | 'youtube' | 'facebook'
    profile_id: str
    video_path: str
    title: str
    tags: Optional[str] = "#viral #fyp"
    browser_type: Optional[str] = "auto"
    auto_post: Optional[bool] = True

@router.post("/uploader/publish")
def publish_video(req: PublishRequest):
    """Đăng video lên TikTok, YouTube Shorts, hoặc Facebook Reels"""
    result = multi_uploader.upload(
        platform=req.platform,
        profile_id=req.profile_id,
        video_path=req.video_path,
        title=req.title,
        tags=req.tags,
        browser_type=req.browser_type,
        auto_post=req.auto_post
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("message", "Lỗi đăng video"))
    return result

# --- 5. Bản Quyền & HWID ---
@router.get("/license/info")
def get_license_info():
    """Lấy thông tin HWID và trạng thái bản quyền vĩnh viễn"""
    client = LicenseClient()
    local = client.load_local_license()
    hwid = get_machine_hwid()
    return {
        "hwid": hwid,
        "is_activated": True,
        "license_data": local
    }

class ActivateLicenseRequest(BaseModel):
    license_key: str

@router.post("/license/activate")
def activate_license(req: ActivateLicenseRequest):
    """Bản quyền luôn hợp lệ vĩnh viễn"""
    return {
        "success": True,
        "message": "Bản quyền vĩnh viễn đã được kích hoạt thành công!"
    }

class ChannelVoiceSettingsRequest(BaseModel):
    channel_id: str
    tts_engine: str = "edge-tts"

@router.post("/channels/voice_settings")
def update_channel_voice_settings(req: ChannelVoiceSettingsRequest):
    """Cập nhật cấu hình giọng đọc AI Edge-TTS cho Kênh"""
    try:
        from backend.database import get_connection
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE channels 
            SET tts_engine = ?
            WHERE channel_id = ?
        """, (req.tts_engine, req.channel_id))
        conn.commit()
        conn.close()
        return {"success": True, "message": f"Đã cập nhật giọng đọc AI cho kênh {req.channel_id}!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi cập nhật cài đặt kênh: {str(e)}")

# --- 7. Quản Lý Thư Viện Video (Video Management) ---
@router.get("/videos/library")
def get_videos_library(limit: int = 150):
    """Lấy danh sách tất cả các video đã tải hoặc nạp từ ổ cứng (Bao gồm RSS YouTube & Direct Links)"""
    try:
        # Tự động đồng bộ hóa các video trên đĩa (RSS, Direct Links, Local) trước khi trả về
        try:
            from backend.app import sync_local_videos_with_db
            sync_local_videos_with_db()
        except Exception:
            pass

        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT v.id, v.channel_id, v.yt_video_id, v.title, v.original_url, v.duration, 
                   v.download_path, v.rendered_path, v.status, v.created_at, v.platform,
                   c.title AS channel_title, c.display_name AS channel_display_name
            FROM videos v
            LEFT JOIN channels c ON v.channel_id = c.channel_id
            ORDER BY v.id DESC LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        conn.close()

        videos = []
        for r in rows:
            v_dict = dict(r)
            p = v_dict.get("download_path")
            rp = v_dict.get("rendered_path")
            active_p = p if (p and os.path.exists(p)) else (rp if (rp and os.path.exists(rp)) else None)
            v_dict["file_exists"] = bool(active_p)
            if active_p:
                try:
                    v_dict["size_mb"] = round(os.path.getsize(active_p) / (1024 * 1024), 2)
                except Exception:
                    v_dict["size_mb"] = 0
            else:
                v_dict["size_mb"] = 0

            # Xác định tên nguồn / kênh (RSS YouTube, Direct Links hoặc Cục bộ)
            ch_title = v_dict.get("channel_display_name") or v_dict.get("channel_title")
            raw_ch = v_dict.get("channel_id")
            if ch_title:
                source_name = ch_title
                source_type = "youtube"
            elif raw_ch and raw_ch not in ("LOCAL", "None", ""):
                source_name = raw_ch
                source_type = "direct" if "direct" in raw_ch.lower() else "channel"
            elif p and "Direct Links" in p:
                source_name = "Direct Links"
                source_type = "direct"
            elif p:
                parent_dir = Path(p).parent.name
                source_name = parent_dir if parent_dir else "Direct Links"
                source_type = "direct" if "direct" in source_name.lower() else "local"
            else:
                source_name = "Direct Links"
                source_type = "direct"

            # Tự động nhận diện nền tảng (Platform: YouTube, Facebook, Instagram, Douyin, RedNote/Xiaohongshu, Bilibili, Weibo, TikTok, Local)
            plat = (v_dict.get("platform") or "").lower()
            orig = (v_dict.get("original_url") or "").lower()
            p_str = (p or "").lower()
            yt_id = str(v_dict.get("yt_video_id") or "")

            if not plat or plat == "generic":
                if orig:
                    plat = multi_downloader.detect_platform(orig)
                elif "douyin" in p_str:
                    plat = "douyin"
                elif "rednote" in p_str:
                    plat = "rednote"
                elif "xiaohongshu" in p_str or "xhs" in p_str:
                    plat = "xiaohongshu"
                elif "bilibili" in p_str:
                    plat = "bilibili"
                elif "weibo" in p_str:
                    plat = "weibo"
                elif "facebook" in p_str or "fb" in p_str:
                    plat = "facebook"
                elif "instagram" in p_str:
                    plat = "instagram"
                elif "tiktok" in p_str:
                    plat = "tiktok"
                elif ch_title or (len(yt_id) == 11 and not yt_id.startswith("local_")):
                    plat = "youtube"
                elif "local" in (raw_ch or "").lower() or "local" in p_str:
                    plat = "local"
                else:
                    plat = "youtube" if source_type == "youtube" else "direct"

            v_dict["platform"] = plat
            v_dict["source_name"] = source_name
            v_dict["source_type"] = source_type
            v_dict["channel_id"] = source_name
            videos.append(v_dict)

        return {"videos": videos, "total": len(videos)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/videos/{video_id}")
def delete_video(video_id: int):
    """Xóa video khỏi hệ thống và dọn dẹp file vật lý nếu có"""
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT download_path, rendered_path FROM videos WHERE id = ?", (video_id,))
        row = cursor.fetchone()
        if row:
            p_dl = row["download_path"]
            if p_dl and os.path.exists(p_dl):
                try:
                    os.remove(p_dl)
                except Exception:
                    pass
            p_ren = row["rendered_path"]
            if p_ren and os.path.exists(p_ren):
                try:
                    os.remove(p_ren)
                except Exception:
                    pass
        cursor.execute("DELETE FROM videos WHERE id = ?", (video_id,))
        cursor.execute("DELETE FROM upload_tasks WHERE video_id = ?", (video_id,))
        conn.commit()
        conn.close()
        return {"success": True, "message": "Đã xóa video khỏi danh sách"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/system/info")
def get_system_info():
    """Lấy thông tin máy trạm (Computer Name, OS, Trình duyệt đang hoạt động)"""
    hostname = socket.gethostname()
    os_name = f"{platform.system()} {platform.release()}"
    active_b = browser_manager.get_active_browser()
    adapter = browser_manager.get_adapter(active_b)
    is_online = False
    if adapter:
        try:
            is_online = bool(adapter.check_health().get("running", False))
        except Exception:
            is_online = False
    
    return {
        "status": "success",
        "computer_name": hostname,
        "os": os_name,
        "active_browser": active_b,
        "browser_online": is_online
    }

@router.post("/campaigns/{campaign_id}/scan_and_ingest_local")
def campaign_scan_and_ingest_local(campaign_id: int):
    """Quét thư mục video cục bộ của chiến dịch và nạp vào hàng đợi render AI"""
    from backend.database import get_connection, log_campaign_event
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, local_folder_path, source_mode FROM campaigns WHERE id = ?", (campaign_id,))
    camp = cursor.fetchone()
    conn.close()
    
    if not camp:
        raise HTTPException(status_code=404, detail="Không tìm thấy chiến dịch")
        
    folder = camp["local_folder_path"]
    if not folder or not os.path.isdir(folder):
        raise HTTPException(status_code=400, detail=f"Thư mục '{folder}' không tồn tại trên máy tính")
        
    # Quét video trong thư mục
    scan_res = local_ingestor.scan_folder(folder)
    if isinstance(scan_res, list):
        files = [f.get("file_path") or f.get("path") for f in scan_res if isinstance(f, dict) and (f.get("file_path") or f.get("path"))]
    elif isinstance(scan_res, dict):
        files = [f.get("file_path") or f.get("path") for f in scan_res.get("files", []) if isinstance(f, dict) and (f.get("file_path") or f.get("path"))]
    else:
        files = []
    if not files:
        return {"status": "warning", "message": f"Không tìm thấy file video nào trong thư mục {folder}", "added": 0}
        
    ingest_res = local_ingestor.ingest_local_videos(files, channel_id=f"CAMP_{campaign_id}")
    log_campaign_event(campaign_id, "INFO", "ingest", f"Đã nạp {ingest_res.get('added_count', 0)} video từ thư mục {folder} vào quy trình render")
    
    return {
        "status": "success",
        "message": f"Đã nạp thành công {ingest_res.get('added_count', 0)} video từ '{folder}' vào hàng đợi Render AI!",
        "added_count": ingest_res.get("added_count", 0),
        "total_files": len(files)
    }
