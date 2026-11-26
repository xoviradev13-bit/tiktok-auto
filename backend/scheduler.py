import os
import time
import json
import random
import threading
import concurrent.futures
from datetime import datetime, timedelta
from backend.database import log_event, get_connection
from backend.modules.yt_monitor import yt_monitor
from backend.modules.distributor import distributor
from backend.modules.tiktok_uploader import tiktok_uploader

def is_retryable_upload_error(error_msg: str) -> bool:
    """
    Phân loại lỗi upload TikTok:
    - Trả về True nếu là lỗi mạng, proxy, browser crash, kết nối GPM, timeout giao diện.
    - Trả về False nếu là lỗi tài khoản bị cấm, captcha/xác minh, hết hạn phiên đăng nhập, file lỗi.
    """
    if not error_msg:
        return True
    e = error_msg.lower()
    # 1. Các lỗi TUYỆT ĐỐI KHÔNG RETRY (cần can thiệp người dùng / nguy hiểm cho tài khoản)
    non_retryable_keywords = [
        "captcha", "xác minh", "verification", "puzzle", "slide to verify",
        "bị cấm", "bị khóa", "suspended", "banned", "restricted", "hạn chế",
        "vi phạm", "community guidelines", "tiêu chuẩn cộng đồng",
        "hết phiên", "chưa đăng nhập", "session expired", "logged out", "đăng nhập lại", "vui lòng đăng nhập",
        "không tìm thấy file", "file không tồn tại", "video không hợp lệ", "định dạng không hỗ trợ",
        "dung lượng vượt quá", "file is missing", "bản quyền", "copyright", "nội dung trùng lặp"
    ]
    for kw in non_retryable_keywords:
        if kw in e:
            return False
    # 2. Các lỗi TỰ ĐỘNG THỬ LẠI ĐƯỢC (lỗi tạm thời, mạng, proxy, GPM timeout, browser)
    retryable_keywords = [
        "proxy", "timeout", "timed out", "kết nối", "connection", "err_proxy", "err_connection",
        "econnreset", "econnrefused", "etimedout", "net::err", "network",
        "gpm", "cổng debug", "không thể khởi chạy", "remote_debugging_address", "browser closed", "target closed",
        "không tìm thấy nút", "nút đăng bị vô hiệu hóa", "chưa tải xong", "iframe", "dropzone",
        "upload timeout", "waiting for selector", "page crash", "navigation timeout", "detached",
        "navigation failed", "disconnected", "reset by peer", "refused"
    ]
    for kw in retryable_keywords:
        if kw in e:
            return True
    # Mặc định an toàn: nếu không có dấu hiệu vi phạm/captcha, cho phép retry
    return True


class BackgroundScheduler:
    """
    Điều phối các tác vụ chạy ngầm định kỳ:
    1. Quét RSS kênh YouTube (mỗi 15 phút) -> Tải video mới
    2. Kiểm tra hàng đợi đăng bài (mỗi 5 phút) -> Khởi chạy upload qua GPMLogin
    3. Watchdog chống treo task & Auto-Retry thông minh
    """
    def __init__(self):
        self.is_running = False
        self._thread = None
        self.rss_interval_minutes = 15
        self.upload_interval_seconds = 60
        self.auto_download = True
        self.auto_render = True
        self.save_by_channel_folder = False
        self.max_videos_per_scan = 5
        self.channel_delay_seconds = 2
        # Cấu hình Auto-Retry thông minh
        self.auto_retry_enabled = True
        self.max_retries = 2
        self.retry_delay_minutes = 15
        # Cấu hình Watchdog chống treo task
        self.watchdog_enabled = True
        self.stuck_timeout_minutes = 15
        # Giãn cách an toàn tối thiểu giữa các lần đăng trên cùng 1 tài khoản (phút)
        self.min_account_cooldown_minutes = 60
        # Cấu hình đa luồng tải lên song song đa tài khoản (GPM & GenLogin farm)
        # Mặc định an toàn là 1 luồng để laptop 8GB RAM hoạt động mượt mà, không bị tràn RAM
        self.max_parallel_uploads = 1
        self._active_uploading_profiles = set()
        self._active_upload_lock = threading.Lock()
        self._upload_pool = concurrent.futures.ThreadPoolExecutor(max_workers=20, thread_name_prefix="UploadWorker")
        
        # Cấu hình đa luồng xử lý quy mô lớn (Mega-Scale Farm: 3000-4000 kênh & 1000 profiles)
        self.rss_concurrent_workers = 15
        self.profile_sync_concurrent_workers = 3
        
        # Cấu hình quét follower định kỳ & giờ cố định hàng ngày
        self.follower_scan_enabled = True
        self.follower_scan_mode = "daily_times"  # "daily_times" hoặc "interval"
        self.follower_scan_times = "08:00, 20:00"
        self.follower_scan_interval_hours = 6
        self._triggered_follower_scans = set()
        self.last_follower_scan = 0
        
        self.load_settings()
    def load_settings(self):
        """Đọc cấu hình scheduler từ SQLite settings table"""
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings")
            db_settings = dict(cursor.fetchall())
            conn.close()
            if "scheduler_interval_minutes" in db_settings:
                self.rss_interval_minutes = max(1, int(db_settings["scheduler_interval_minutes"]))
            if "upload_interval_seconds" in db_settings:
                self.upload_interval_seconds = max(10, int(db_settings["upload_interval_seconds"]))
            if "auto_download" in db_settings:
                self.auto_download = db_settings["auto_download"] == "1"
            if "auto_render" in db_settings:
                self.auto_render = db_settings["auto_render"] == "1"
            if "save_by_channel_folder" in db_settings:
                self.save_by_channel_folder = db_settings["save_by_channel_folder"] == "1"
            if "max_videos_per_scan" in db_settings:
                self.max_videos_per_scan = max(1, int(db_settings["max_videos_per_scan"]))
            if "channel_delay_seconds" in db_settings:
                self.channel_delay_seconds = max(0, int(db_settings["channel_delay_seconds"]))
            if "upload_auto_retry" in db_settings:
                self.auto_retry_enabled = db_settings["upload_auto_retry"] == "1"
            if "upload_max_retries" in db_settings:
                self.max_retries = max(1, int(db_settings["upload_max_retries"]))
            if "upload_retry_delay_minutes" in db_settings:
                self.retry_delay_minutes = max(1, int(db_settings["upload_retry_delay_minutes"]))
            if "watchdog_enabled" in db_settings:
                self.watchdog_enabled = db_settings["watchdog_enabled"] == "1"
            if "upload_stuck_timeout_minutes" in db_settings:
                self.stuck_timeout_minutes = max(5, int(db_settings["upload_stuck_timeout_minutes"]))
            if "min_account_cooldown_minutes" in db_settings:
                self.min_account_cooldown_minutes = max(15, int(db_settings["min_account_cooldown_minutes"]))
            elif "min_post_interval_minutes" in db_settings:
                self.min_account_cooldown_minutes = max(15, int(db_settings["min_post_interval_minutes"]))
            if "max_parallel_uploads" in db_settings:
                try:
                    self.max_parallel_uploads = max(1, min(20, int(db_settings["max_parallel_uploads"])))
                except Exception:
                    pass
            if "rss_concurrent_workers" in db_settings:
                try:
                    self.rss_concurrent_workers = max(1, min(50, int(db_settings["rss_concurrent_workers"])))
                except Exception:
                    pass
            if "profile_sync_concurrent_workers" in db_settings:
                try:
                    self.profile_sync_concurrent_workers = max(1, min(10, int(db_settings["profile_sync_concurrent_workers"])))
                except Exception:
                    pass
            if "follower_scan_enabled" in db_settings:
                self.follower_scan_enabled = db_settings["follower_scan_enabled"] == "1"
            if "follower_scan_mode" in db_settings:
                self.follower_scan_mode = db_settings["follower_scan_mode"]
            if "follower_scan_times" in db_settings:
                self.follower_scan_times = db_settings["follower_scan_times"]
            if "follower_scan_interval_hours" in db_settings:
                self.follower_scan_interval_hours = max(1, int(db_settings["follower_scan_interval_hours"]))
        except Exception as e:
            log_event("WARNING", f"Lỗi đọc cấu hình scheduler từ DB: {e}")
    def update_config(self, interval_minutes=None, upload_interval_seconds=None, auto_download=None, auto_render=None,
                      max_videos_per_scan=None, channel_delay_seconds=None, save_by_channel_folder=None,
                      auto_retry_enabled=None, max_retries=None, retry_delay_minutes=None,
                      watchdog_enabled=None, stuck_timeout_minutes=None, min_account_cooldown_minutes=None,
                      max_parallel_uploads=None, rss_concurrent_workers=None, profile_sync_concurrent_workers=None):
        """Cập nhật cấu hình runtime ngay lập tức"""
        if interval_minutes is not None:
            self.rss_interval_minutes = max(1, int(interval_minutes))
        if upload_interval_seconds is not None:
            self.upload_interval_seconds = max(10, int(upload_interval_seconds))
        if auto_download is not None:
            self.auto_download = bool(auto_download)
        if auto_render is not None:
            self.auto_render = bool(auto_render)
        if save_by_channel_folder is not None:
            self.save_by_channel_folder = bool(save_by_channel_folder)
        if max_videos_per_scan is not None:
            self.max_videos_per_scan = max(1, int(max_videos_per_scan))
        if channel_delay_seconds is not None:
            self.channel_delay_seconds = max(0, int(channel_delay_seconds))
        if auto_retry_enabled is not None:
            self.auto_retry_enabled = bool(auto_retry_enabled)
        if max_retries is not None:
            self.max_retries = max(1, int(max_retries))
        if retry_delay_minutes is not None:
            self.retry_delay_minutes = max(1, int(retry_delay_minutes))
        if watchdog_enabled is not None:
            self.watchdog_enabled = bool(watchdog_enabled)
        if stuck_timeout_minutes is not None:
            self.stuck_timeout_minutes = max(5, int(stuck_timeout_minutes))
        if min_account_cooldown_minutes is not None:
            self.min_account_cooldown_minutes = max(15, int(min_account_cooldown_minutes))
        if max_parallel_uploads is not None:
            self.max_parallel_uploads = max(1, min(20, int(max_parallel_uploads)))
        if rss_concurrent_workers is not None:
            self.rss_concurrent_workers = max(1, min(50, int(rss_concurrent_workers)))
        if profile_sync_concurrent_workers is not None:
            self.profile_sync_concurrent_workers = max(1, min(10, int(profile_sync_concurrent_workers)))
    def update_follower_config(self, enabled=None, mode=None, times=None, interval_hours=None):
        """Cập nhật cấu hình quét follower runtime"""
        if enabled is not None:
            self.follower_scan_enabled = bool(enabled)
        if mode is not None:
            self.follower_scan_mode = str(mode)
        if times is not None:
            self.follower_scan_times = str(times)
        if interval_hours is not None:
            self.follower_scan_interval_hours = max(1, int(interval_hours))
    def _recover_stuck_tasks(self, is_startup: bool = False):
        """
        Watchdog chống treo (Stuck Recovery):
        - is_startup=True: Khởi động hệ thống, tự động reset tất cả các task dở dang ở 'processing' về 'queued'
        - is_startup=False: Quét runtime, tự động reset các task ở 'processing' quá stuck_timeout_minutes
        """
        try:
            conn = get_connection()
            cursor = conn.cursor()
            now_dt = datetime.now()
            now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
            if is_startup:
                cursor.execute("""
                    SELECT ut.id, ut.video_id, ut.title, gp.gpm_id
                    FROM upload_tasks ut
                    LEFT JOIN gpm_profiles gp ON ut.gpm_profile_id = gp.id
                    WHERE ut.status = 'processing'
                """)
                stuck_tasks = cursor.fetchall()
                for t in stuck_tasks:
                    tid = t["id"]
                    cursor.execute("""
                        UPDATE upload_tasks
                        SET status = 'queued',
                            processing_started_at = NULL,
                            error_message = 'Tự động phục hồi sau khi khởi động lại ứng dụng/máy tính'
                        WHERE id = ?
                    """, (tid,))
                    conn.commit()
                    try:
                        from backend.modules.tiktok_tracker import set_profile_busy
                        if t["gpm_id"]:
                            set_profile_busy(t["gpm_id"], False)
                    except Exception:
                        pass
                    log_event("INFO", f"[WATCHDOG] 🚀 Khởi động hệ thống: Đã tự động phục hồi Task #{tid} (bị dở dang do tắt ứng dụng) về 'queued' để đăng lại.")
                conn.close()
                return
            # Runtime check
            if not self.watchdog_enabled:
                conn.close()
                return
            timeout_delta = timedelta(minutes=self.stuck_timeout_minutes)
            cursor.execute("""
                SELECT ut.id, ut.video_id, ut.title, gp.gpm_id, ut.processing_started_at,
                       COALESCE(ut.retry_count, 0) as retry_count
                FROM upload_tasks ut
                LEFT JOIN gpm_profiles gp ON ut.gpm_profile_id = gp.id
                WHERE ut.status = 'processing'
            """)
            running_tasks = cursor.fetchall()
            for t in running_tasks:
                tid = t["id"]
                p_start_str = t["processing_started_at"]
                is_stuck = False
                if p_start_str:
                    try:
                        p_start = datetime.strptime(p_start_str, "%Y-%m-%d %H:%M:%S")
                        if now_dt - p_start > timeout_delta:
                            is_stuck = True
                    except Exception:
                        is_stuck = True
                else:
                    # Gán thời gian nếu chưa có
                    cursor.execute("UPDATE upload_tasks SET processing_started_at = ? WHERE id = ?", (now_str, tid))
                    conn.commit()
                    continue
                if is_stuck:
                    gpm_id = t["gpm_id"] or ""
                    try:
                        from backend.modules.tiktok_tracker import set_profile_busy
                        if gpm_id:
                            set_profile_busy(gpm_id, False)
                    except Exception:
                        pass
                    cur_retries = t["retry_count"]
                    if self.auto_retry_enabled and cur_retries < self.max_retries:
                        next_retry = cur_retries + 1
                        retry_time = (now_dt + timedelta(minutes=self.retry_delay_minutes)).strftime("%Y-%m-%d %H:%M:%S")
                        cursor.execute("""
                            UPDATE upload_tasks
                            SET status = 'queued',
                                retry_count = ?,
                                retry_after = ?,
                                scheduled_time = ?,
                                processing_started_at = NULL,
                                error_message = ?
                            WHERE id = ?
                        """, (
                            next_retry,
                            retry_time,
                            retry_time,
                            f"[Watchdog] Bị treo quá {self.stuck_timeout_minutes} phút, tự động thử lại {next_retry}/{self.max_retries}",
                            tid
                        ))
                        conn.commit()
                        log_event("WARNING", f"[WATCHDOG] ⚠️ Tác vụ #{tid} (GPM: {gpm_id}) bị treo ở trạng thái 'processing' quá {self.stuck_timeout_minutes} phút! Tự động chuyển về 'queued' để thử lại lần {next_retry}/{self.max_retries} vào lúc {retry_time}.")
                    else:
                        fail_reason = f"Thất bại: Tác vụ bị treo quá {self.stuck_timeout_minutes} phút (đã thử lại {cur_retries}/{self.max_retries} lần)."
                        cursor.execute("""
                            UPDATE upload_tasks
                            SET status = 'failed',
                                processing_started_at = NULL,
                                error_message = ?
                            WHERE id = ?
                        """, (fail_reason, tid))
                        conn.commit()
                        log_event("WARNING", f"[WATCHDOG] ❌ Tác vụ #{tid} (GPM: {gpm_id}) bị treo quá {self.stuck_timeout_minutes} phút và đã hết số lần thử lại ({cur_retries}/{self.max_retries}). Đánh dấu thất bại hẳn.")
                        try:
                            from backend.modules.notifier import notifier
                            threading.Thread(
                                target=notifier.send_issue_alert,
                                kwargs={
                                    "title": f"Tác Vụ Upload #{tid} Bị Treo",
                                    "message": f"Tác vụ tải video lên profile GPMLogin '{gpm_id}' bị treo quá {self.stuck_timeout_minutes} phút và đã vượt quá {self.max_retries} lần thử lại.",
                                    "solution": "1️⃣ Mở Profile GPMLogin kiểm tra tab trình duyệt TikTok xem có bị đơ hoặc lỗi mạng không.\n2️⃣ Khởi động lại GPMLogin hoặc kiểm tra kết nối Proxy.",
                                    "severity": "HIGH",
                                    "details": f"Task #{tid} | Profile: {gpm_id}"
                                },
                                daemon=True
                            ).start()
                        except Exception:
                            pass
            conn.close()
        except Exception as ex:
            log_event("WARNING", f"[WATCHDOG] Lỗi khi xử lý phục hồi task treo: {ex}")
    def start(self):
        if self.is_running:
            return
        self.is_running = True
        # 0. Watchdog: Phục hồi ngay các task bị dở dang (processing) do tắt máy/khởi động lại
        try:
            self._recover_stuck_tasks(is_startup=True)
        except Exception as e:
            log_event("WARNING", f"[WATCHDOG] Lỗi kiểm tra task dở dang khi khởi động: {e}")
        # 1. Thread riêng cho hàng đợi Upload (chạy độc lập, không bị block bởi download/render video)
        self._upload_thread = threading.Thread(target=self._upload_loop, daemon=True, name="UploadWorker")
        self._upload_thread.start()
        # 2. Thread riêng cho quét RSS và tải/render video
        self._rss_thread = threading.Thread(target=self._rss_loop, daemon=True, name="RSSScanner")
        self._rss_thread.start()
        # 3. Thread riêng cho bảo trì định kỳ (dọn file, quét follower, báo cáo telegram)
        self._maintenance_thread = threading.Thread(target=self._maintenance_loop, daemon=True, name="MaintenanceWorker")
        self._maintenance_thread.start()
        log_event("INFO", f"Background Scheduler đã khởi động (Upload worker: {self.upload_interval_seconds}s, RSS worker: {self.rss_interval_minutes}p, Auto-Retry: {'BẬT' if self.auto_retry_enabled else 'TẮT'}, Watchdog: {'BẬT' if self.watchdog_enabled else 'TẮT'}).")
    def stop(self):
        self.is_running = False
    def _upload_loop(self):
        """Vòng lặp xử lý hàng đợi Upload độc lập - KHÔNG BAO GIỜ bị nghẽn bởi render video"""
        last_upload_check = 0
        last_watchdog_check = 0
        while self.is_running:
            # Kiểm tra trạng thái bản quyền: Nếu máy chưa kích hoạt key -> Không xử lý hàng đợi upload
            try:
                from backend.modules.license_manager import get_license_info
                if not get_license_info().get("is_active"):
                    time.sleep(10)
                    continue
            except Exception:
                pass

            now = time.time()
            # Watchdog kiểm tra các task bị treo > stuck_timeout_minutes (quét mỗi 30 giây)
            if self.watchdog_enabled and (now - last_watchdog_check >= 30):
                try:
                    self._recover_stuck_tasks(is_startup=False)
                except Exception as e:
                    log_event("WARNING", f"[WATCHDOG] Lỗi quét task treo định kỳ: {e}")
                last_watchdog_check = time.time()
            upload_delay_secs = max(5, self.upload_interval_seconds)
            if now - last_upload_check >= upload_delay_secs:
                try:
                    self._process_pending_uploads()
                except Exception as e:
                    log_event("WARNING", f"[UPLOAD WORKER] Lỗi xử lý hàng đợi upload: {str(e)}")
                last_upload_check = time.time()
            # Xử lý các nhiệm vụ tương tác 30 phút vàng (Pin comment & Auto-reply)
            if now - last_upload_check >= 10:
                try:
                    self._process_pending_engagements()
                except Exception as e:
                    log_event("WARNING", f"[ENGAGEMENT WORKER] Lỗi xử lý tương tác 30 phút vàng: {str(e)}")
            time.sleep(3)
    def _rss_loop(self):
        """Vòng lặp quét RSS, tải video và render AI chạy ngầm riêng biệt"""
        last_rss_check = 0
        while self.is_running:
            # Kiểm tra trạng thái bản quyền: Nếu máy chưa kích hoạt key -> Không quét hoặc tải video ngầm
            try:
                from backend.modules.license_manager import get_license_info
                if not get_license_info().get("is_active"):
                    time.sleep(15)
                    continue
            except Exception:
                pass

            now = time.time()
            rss_delay_secs = max(60, self.rss_interval_minutes * 60)
            if now - last_rss_check >= rss_delay_secs:
                if self.auto_download:
                    try:
                        total_new = yt_monitor.scan_all_monitored_channels(
                            max_per_channel=self.max_videos_per_scan,
                            delay=float(self.channel_delay_seconds),
                            max_workers=self.rss_concurrent_workers
                        )
                        if total_new > 0:
                            log_event("INFO", f"[RSS WORKER] Đã quét chu kỳ ({self.rss_interval_minutes}p): phát hiện và tải về {total_new} video mới qua RSS.")
                    except Exception as e:
                        log_event("WARNING", f"[RSS WORKER] Lỗi quét RSS: {str(e)}")
                last_rss_check = time.time()
            time.sleep(5)
    def _maintenance_loop(self):
        """Vòng lặp xử lý dọn dẹp file, quét follower và báo cáo telegram"""
        last_cleanup_check = 0
        while self.is_running:
            now = time.time()
            # 1. Tự động kiểm tra dọn dẹp file MP4 đã đăng quá hạn và file log cũ > 30 ngày (mỗi 1 giờ)
            if now - last_cleanup_check > 3600:
                try:
                    from backend.app import cleanup_uploaded_files
                    cleanup_uploaded_files()
                except Exception:
                    pass
                try:
                    from backend.logger import cleanup_old_daily_logs
                    cleanup_old_daily_logs(retention_days=30)
                except Exception:
                    pass
                last_cleanup_check = time.time()
            # 2. Tự động kiểm tra lịch quét chỉ số / Follower TikTok định kỳ
            try:
                self._check_and_trigger_follower_scan(now)
            except Exception:
                pass
            # 3. Tự động kiểm tra lịch gửi Báo cáo hoạt động ngày tới các kênh Telegram
            try:
                self._check_and_trigger_daily_reports(now)
            except Exception:
                pass
            # 4. Tự động kiểm tra lịch lướt TikTok nuôi nick cho các Chiến Dịch "Chỉ Warm-up"
            try:
                self._check_and_trigger_warmup_only_campaigns(now)
            except Exception as e:
                log_event("WARNING", f"[WARM-UP SCHEDULER] Lỗi kiểm tra lịch nuôi nick: {e}")
            time.sleep(10)
    def _check_and_trigger_daily_reports(self, now):
        """Kiểm tra và tự động gửi Báo cáo hoạt động ngày cho các nhóm Telegram theo daily_report_time"""
        now_hm = datetime.now().strftime("%H:%M")
        today_str = datetime.now().strftime("%Y-%m-%d")
        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, name, chat_id, daily_report_time, last_daily_report 
                FROM telegram_channels 
                WHERE is_active = 1 AND notify_daily_report = 1
            ''')
            channels = cursor.fetchall()
            for ch in channels:
                ch_id = ch["id"]
                target_time = (ch["daily_report_time"] or "21:00").strip()
                last_report = ch["last_daily_report"] or ""
                if target_time == now_hm and last_report != today_str:
                    # Cập nhật ngay để không bị bắn lặp lại trong phút đó
                    cursor.execute("UPDATE telegram_channels SET last_daily_report = ? WHERE id = ?", (today_str, ch_id))
                    conn.commit()
                    ch_name = ch["name"]
                    chat_target = ch["chat_id"]
                    def _async_send_report(cid=chat_target, cname=ch_name):
                        try:
                            from backend.modules.notifier import notifier
                            log_event("INFO", f"[SCHEDULER] ⏰ Gửi báo cáo ngày tự động ({now_hm}) tới kênh Telegram '{cname}'")
                            notifier.send_daily_report(report_date=today_str, target_chat_id=cid)
                        except Exception as ex:
                            log_event("WARNING", f"[SCHEDULER] Lỗi gửi báo cáo ngày tới '{cname}': {ex}")
                    threading.Thread(target=_async_send_report, daemon=True).start()
            conn.close()
        except Exception:
            pass

    def _check_and_trigger_warmup_only_campaigns(self, now):
        """
        Quét và kích hoạt chu kỳ lướt TikTok nuôi nick cho các Chiến Dịch 'Chỉ Warm-up' (Warm-up Only)
        - Hoàn toàn KHÔNG tải video, KHÔNG render, KHÔNG upload.
        - Tự động mở profile theo các khung giờ lên lịch (post_schedule) và thứ trong tuần (post_days_of_week)
        - Lướt feed For You, xem video ngẫu nhiên, thả tim để tạo Trust Score & Cookie
        """
        now_dt = datetime.now()
        today_str = now_dt.strftime("%Y-%m-%d")
        now_hm = now_dt.strftime("%H:%M")
        weekday_map = {0: "mon", 1: "tue", 2: "wed", 3: "thu", 4: "fri", 5: "sat", 6: "sun"}
        cur_dow = weekday_map.get(now_dt.weekday(), "mon")

        try:
            conn = get_connection()
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, name, gpm_profile_ids, gpm_profile_id, post_schedule, 
                       post_days_of_week, warmup_duration_mins
                FROM campaigns
                WHERE is_active = 1 AND warmup_only = 1
            """)
            warmup_camps = [dict(r) for r in cursor.fetchall()]
            conn.close()

            if not warmup_camps:
                return

            if not hasattr(self, "_triggered_warmup_slots"):
                self._triggered_warmup_slots = set()

            for camp in warmup_camps:
                camp_id = camp["id"]
                camp_name = camp["name"] or f"Chiến dịch #{camp_id}"
                dows = (camp.get("post_days_of_week") or "mon,tue,wed,thu,fri,sat,sun").lower().split(",")
                if cur_dow not in [d.strip() for d in dows]:
                    continue

                raw_slots = [s.strip() for s in (camp.get("post_schedule") or "11:30, 18:00, 20:30").split(",") if s.strip()]
                for slot in raw_slots:
                    if slot == now_hm:
                        slot_key = f"warmup_{camp_id}_{today_str}_{slot}"
                        if slot_key in self._triggered_warmup_slots:
                            continue
                        self._triggered_warmup_slots.add(slot_key)
                        # Dọn dẹp cache ngày cũ
                        self._triggered_warmup_slots = {k for k in self._triggered_warmup_slots if today_str in k}

                        gpm_ids = []
                        if camp.get("gpm_profile_ids"):
                            try:
                                loaded = json.loads(camp["gpm_profile_ids"])
                                if isinstance(loaded, list):
                                    gpm_ids = [int(x) for x in loaded if x]
                            except Exception:
                                pass
                        if not gpm_ids and camp.get("gpm_profile_id"):
                            gpm_ids = [int(camp["gpm_profile_id"])]

                        if not gpm_ids:
                            continue

                        duration = float(camp.get("warmup_duration_mins") or 10.0)
                        log_event("INFO", f"🌱 [WARM-UP SCHEDULER] ⏰ Đến khung giờ {slot} của chiến dịch '{camp_name}'. Bắt đầu phiên lướt feed nuôi nick ({duration:.0f} phút/profile) cho {len(gpm_ids)} profiles.")

                        threading.Thread(
                            target=self._run_campaign_warmup_session,
                            args=(camp_id, camp_name, gpm_ids, duration),
                            daemon=True,
                            name=f"Warmup_{camp_id}_{slot}"
                        ).start()
        except Exception as ex:
            log_event("WARNING", f"[WARM-UP SCHEDULER] Lỗi kiểm tra lịch nuôi nick: {ex}")

    def _run_campaign_warmup_session(self, camp_id: int, camp_name: str, gpm_db_ids: list, duration_minutes: float):
        """Thực thi phiên lướt TikTok nuôi nick tuần tự hoặc song song an toàn cho từng profile"""
        from backend.modules.account_warmup import account_warmup
        from backend.modules.gpm_client import gpm_client
        from backend.modules.tiktok_tracker import set_profile_busy
        from playwright.sync_api import sync_playwright

        try:
            conn = get_connection()
            cursor = conn.cursor()
            placeholders = ",".join("?" * len(gpm_db_ids))
            cursor.execute(f"SELECT id, gpm_id, name, browser_type FROM gpm_profiles WHERE id IN ({placeholders})", tuple(gpm_db_ids))
            profiles = [dict(r) for r in cursor.fetchall()]
            conn.close()
        except Exception as ex:
            log_event("WARNING", f"[WARM-UP] Không thể lấy thông tin profiles cho chiến dịch #{camp_id}: {ex}")
            return

        for p in profiles:
            gid = p.get("gpm_id")
            p_name = p.get("name") or gid
            if not gid:
                continue

            set_profile_busy(gid, True)
            try:
                log_event("INFO", f"🔥 [WARM-UP ONLY] Chiến dịch '{camp_name}': Đang khởi động profile '{p_name}' ({gid}) để lướt TikTok {duration_minutes:.0f} phút...")
                gpm_client.ensure_gpm_running()
                remote_addr = gpm_client.start_profile(gid)
                if not remote_addr:
                    log_event("WARNING", f"[WARM-UP ONLY] Không thể khởi động profile '{p_name}' ({gid})")
                    continue

                with sync_playwright() as pw:
                    browser = pw.chromium.connect_over_cdp(f"http://{remote_addr}")
                    cdp_target = remote_addr if (remote_addr.startswith("ws://") or remote_addr.startswith("http://")) else f"http://{remote_addr}"
                    browser = pw.chromium.connect_over_cdp(cdp_target)
                    contexts = browser.contexts
                    context = contexts[0] if contexts else browser.new_context()
                    page = context.pages[0] if context.pages else context.new_page()

                    res = account_warmup.run_feed_warmup(page, duration_minutes=duration_minutes, gpm_profile_id=gid)
                    try:
                        browser.close()
                    except Exception:
                        pass

                # Ghi lịch sử chiến dịch
                conn2 = get_connection()
                c2 = conn2.cursor()
                c2.execute("""
                    INSERT INTO campaign_logs (campaign_id, level, action, message, details)
                    VALUES (?, 'SUCCESS', 'warmup', ?, ?)
                """, (
                    camp_id,
                    f"Đã hoàn thành phiên lướt TikTok nuôi nick cho profile '{p_name}': xem {res.get('videos_watched', 0)} video, {res.get('likes_given', 0)} like trong {res.get('duration_minutes', 0)} phút.",
                    json.dumps(res, ensure_ascii=False)
                ))
                conn2.commit()
                conn2.close()

            except Exception as e:
                log_event("WARNING", f"[WARM-UP ONLY] Lỗi khi warm-up profile '{p_name}': {e}")
            finally:
                try:
                    gpm_client.stop_profile(gid)
                except Exception:
                    pass
                set_profile_busy(gid, False)
                time.sleep(5)

    def _check_and_trigger_follower_scan(self, now: float):
        """Kiểm tra thời gian và kích hoạt quét follower tự động theo cấu hình"""
        if not self.follower_scan_enabled:
            return
        should_trigger = False
        today_str = datetime.now().strftime("%Y-%m-%d")
        now_hm = datetime.now().strftime("%H:%M")
        if self.follower_scan_mode == "daily_times":
            # Ví dụ: "08:00, 20:00"
            raw_times = [t.strip() for t in self.follower_scan_times.split(",") if t.strip()]
            for t in raw_times:
                if t == now_hm:
                    trigger_key = f"{today_str}_{t}"
                    if trigger_key not in self._triggered_follower_scans:
                        self._triggered_follower_scans.add(trigger_key)
                        self._triggered_follower_scans = {k for k in self._triggered_follower_scans if k.startswith(today_str)}
                        should_trigger = True
                        break
        elif self.follower_scan_mode == "interval":
            interval_secs = max(1800, self.follower_scan_interval_hours * 3600)
            if self.last_follower_scan == 0:
                self.last_follower_scan = now
            elif now - self.last_follower_scan > interval_secs:
                should_trigger = True
        if should_trigger:
            self.last_follower_scan = now
            def _async_scan():
                try:
                    from backend.modules.tiktok_tracker import tiktok_tracker
                    log_event("INFO", f"[SCHEDULER] ⏰ Kích hoạt quét Follower tự động ({self.follower_scan_mode}) với {self.profile_sync_concurrent_workers} luồng...")
                    tiktok_tracker.scan_all_profiles(max_workers=self.profile_sync_concurrent_workers)
                except Exception as e:
                    log_event("WARNING", f"[SCHEDULER] Lỗi quét follower tự động: {e}")
            t = threading.Thread(target=_async_scan, daemon=True)
            t.start()
    def _process_pending_uploads(self):
        if not self.is_running:
            return

        with self._active_upload_lock:
            available_slots = max(0, self.max_parallel_uploads - len(self._active_uploading_profiles))
        if available_slots <= 0:
            return

        conn = get_connection()
        cursor = conn.cursor()
        now_dt = datetime.now()
        now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")

        # Lấy các task đang ở trạng thái queued và tới giờ đăng (thỏa mãn cả scheduled_time và retry_after)
        cursor.execute('''
        SELECT ut.id, ut.video_id, ut.title, ut.tags, 
               COALESCE(NULLIF(ut.video_path, ''), v.rendered_path) as rendered_path, 
               gp.gpm_id, ut.gpm_profile_id, COALESCE(ut.retry_count, 0) as retry_count,
               v.channel_id, COALESCE(ut.part_number, 1) as part_number,
               gp.tiktok_username, COALESCE(ut.variant_tag, '') as variant_tag,
               COALESCE(ut.hook_copy, '') as hook_copy
        FROM upload_tasks ut
        JOIN videos v ON ut.video_id = v.id
        JOIN gpm_profiles gp ON ut.gpm_profile_id = gp.id
        WHERE ut.status = 'queued' 
          AND (ut.scheduled_time IS NULL OR ut.scheduled_time <= ?)
          AND (ut.retry_after IS NULL OR ut.retry_after <= ?)
        ORDER BY ut.scheduled_time ASC, ut.id ASC
        LIMIT 60
        ''', (now_str, now_str))
        candidates = cursor.fetchall()
        
        from backend.modules.tiktok_tracker import is_profile_busy
        from backend.database import get_linked_profile_ids

        tasks_to_dispatch = []
        dispatched_profiles = set()
        dispatched_linked_ids = set()

        for cand_row in candidates:
            cand = dict(cand_row)
            gpm_id = cand["gpm_id"]
            cand_profile_id = cand["gpm_profile_id"]
            cand_video_id = cand["video_id"]
            cand_part_num = cand["part_number"] or 1

            # Edge Case Guard 1: Kiểm tra chiến dịch sở hữu video có đang bị tắt (is_active = 0) hoặc xóa không
            try:
                ch_id = cand.get("channel_id")
                if ch_id:
                    cursor.execute("""
                        SELECT is_active FROM campaigns
                        WHERE (channel_id = ? OR channel_ids LIKE ?)
                        ORDER BY id DESC LIMIT 1
                    """, (ch_id, f"%{ch_id}%"))
                    camp_active_row = cursor.fetchone()
                    # Nếu có chiến dịch liên kết và chiến dịch đang tắt -> Tạm hoãn task, không đăng bài
                    if camp_active_row and camp_active_row["is_active"] == 0:
                        continue
            except Exception:
                pass

            # Edge Case Guard 2: Kiểm tra Profile có còn thuộc chiến dịch hay đã bị gỡ/đổi chiến dịch
            try:
                if ch_id:
                    cursor.execute("""
                        SELECT gpm_profile_id, gpm_profile_ids FROM campaigns
                        WHERE (channel_id = ? OR channel_ids LIKE ?) AND is_active = 1
                        ORDER BY id DESC LIMIT 1
                    """, (ch_id, f"%{ch_id}%"))
                    camp_profiles_row = cursor.fetchone()
                    if camp_profiles_row:
                        raw_gpms = camp_profiles_row["gpm_profile_ids"] or ""
                        valid_pids = set()
                        if camp_profiles_row["gpm_profile_id"]:
                            valid_pids.add(int(camp_profiles_row["gpm_profile_id"]))
                        if raw_gpms:
                            try:
                                for x in json.loads(raw_gpms):
                                    valid_pids.add(int(x))
                            except Exception:
                                pass
                        # Nếu danh sách profile của chiến dịch đã thay đổi và không còn nick này -> Tự động reassign hoặc hoãn
                        if valid_pids and cand_profile_id not in valid_pids:
                            # Reassign sang 1 profile hợp lệ đang còn trong chiến dịch
                            new_pid = next(iter(valid_pids))
                            cursor.execute("UPDATE upload_tasks SET gpm_profile_id = ? WHERE id = ?", (new_pid, cand["id"]))
                            conn.commit()
                            log_event("INFO", f"[UPLOAD WORKER] 🔄 Profile #{cand_profile_id} đã bị gỡ khỏi chiến dịch. Tự động chuyển Task #{cand['id']} sang profile #{new_pid}.")
                            cand_profile_id = new_pid
            except Exception:
                pass

            # Bỏ qua nếu profile này đang được worker khác upload hoặc đang bận
            with self._active_upload_lock:
                if gpm_id in self._active_uploading_profiles:
                    continue
            if gpm_id in dispatched_profiles or is_profile_busy(gpm_id):
                continue

            # 1. Bảo vệ chỉ số 30 phút đầu (First 30 Minutes Rule / Peak Traffic Guard):
            # Tuyệt đối không đăng vào khung giờ chết ban đêm (00:00 - 06:45) khi lượng người dùng hoạt động thấp nhất.
            current_hour = now_dt.hour
            if 0 <= current_hour < 7:
                morning_slot = now_dt.replace(hour=7, minute=15, second=0) + timedelta(minutes=random.randint(0, 45))
                morning_str = morning_slot.strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("UPDATE upload_tasks SET scheduled_time = ? WHERE id = ?", (morning_str, cand["id"]))
                conn.commit()
                log_event("INFO", f"[UPLOAD WORKER] 🌙 Khung giờ chết ({current_hour:02d}:{now_dt.minute:02d}). Tự động hoãn Task #{cand['id']} tới khung giờ vàng buổi sáng ({morning_str}) để tối ưu tương tác 30 phút đầu.")
                continue

            # Khóa tuần tự Part (Series Sequencing Lock):
            # Nếu task này là Part 2, Part 3... thì BẮT BUỘC các Part trước của cùng video_id phải đã đăng thành công ('completed')
            if cand_part_num > 1:
                cursor.execute("""
                    SELECT COUNT(*) FROM upload_tasks
                    WHERE video_id = ? AND part_number < ? AND status != 'completed'
                """, (cand_video_id, cand_part_num))
                uncompleted_prev = cursor.fetchone()[0]
                if uncompleted_prev > 0:
                    # Part trước chưa upload xong -> Bỏ qua task này, nhường lượt cho Part trước hoặc video khác
                    continue

            # Ưu tiên lấy cấu hình giãn cách riêng của Chiến dịch (nếu có), nếu không có thì dùng Cấu hình toàn cục (Global)
            cooldown_mins = self.min_account_cooldown_minutes
            try:
                ch_id = cand["channel_id"]
                if ch_id:
                    cursor.execute("""
                        SELECT min_post_interval_minutes FROM campaigns
                        WHERE (channel_id = ? OR channel_ids LIKE ?) 
                          AND min_post_interval_minutes IS NOT NULL 
                          AND min_post_interval_minutes > 0
                        ORDER BY id DESC LIMIT 1
                    """, (ch_id, f"%{ch_id}%"))
                    c_row = cursor.fetchone()
                    if c_row and c_row["min_post_interval_minutes"]:
                        cooldown_mins = max(15, int(c_row["min_post_interval_minutes"]))
            except Exception:
                pass

            linked_ids = get_linked_profile_ids(cursor, cand_profile_id)
            if any(lid in dispatched_linked_ids for lid in linked_ids):
                continue
            ph_linked = ",".join("?" for _ in linked_ids)

            # A. Chống đăng trùng tuyệt đối (Duplicate Clip Guard across Browsers):
            cursor.execute(f"""
                SELECT ut.id, ut.uploaded_at, gp.name FROM upload_tasks ut
                JOIN gpm_profiles gp ON ut.gpm_profile_id = gp.id
                WHERE ut.video_id = ? 
                  AND (ut.part_number = ? OR (ut.part_number IS NULL AND ? = 1))
                  AND ut.status = 'completed'
                  AND gp.id IN ({ph_linked})
                  AND ut.id != ?
            """, (cand_video_id, cand_part_num, cand_part_num, *linked_ids, cand["id"]))
            already_done = cursor.fetchone()
            if already_done:
                cursor.execute("UPDATE upload_tasks SET status = 'skipped', error_message = ? WHERE id = ?",
                    (f"Bỏ qua: Clip đã được đăng thành công trước đó (Task #{already_done['id']} qua profile '{already_done['name']}')", cand["id"]))
                conn.commit()
                log_event("WARNING", f"[UPLOAD WORKER] 🛡️ Chống đăng trùng: Video #{cand_video_id} (Part {cand_part_num}) đã được đăng thành công qua '{already_done['name']}' lúc {already_done['uploaded_at']}. Tự động đánh dấu 'skipped' Task #{cand['id']} để bảo vệ kênh!")
                continue

            # B. Khóa đồng thời kênh (Channel Concurrency Lock):
            cursor.execute(f"""
                SELECT ut.id, gp.name FROM upload_tasks ut
                JOIN gpm_profiles gp ON ut.gpm_profile_id = gp.id
                WHERE gp.id IN ({ph_linked}) AND ut.status = 'processing' AND ut.id != ?
            """, (*linked_ids, cand["id"]))
            in_progress = cursor.fetchone()
            if in_progress:
                log_event("INFO", f"[UPLOAD WORKER] ⏳ Kênh của Task #{cand['id']} đang có tiến trình upload khác đang chạy (Task #{in_progress['id']} qua '{in_progress['name']}'). Chờ phiên hoàn tất trước khi mở tiếp.")
                continue

            # C. Giãn cách tối thiểu liên trình duyệt (Cross-Browser Cooldown Guard):
            cursor.execute(f"""
                SELECT ut.uploaded_at, gp.name FROM upload_tasks ut
                JOIN gpm_profiles gp ON ut.gpm_profile_id = gp.id
                WHERE ut.gpm_profile_id IN ({ph_linked}) AND ut.status = 'completed' AND ut.uploaded_at IS NOT NULL
                ORDER BY ut.uploaded_at DESC LIMIT 1
            """, tuple(linked_ids))
            last_upload = cursor.fetchone()
            if last_upload and last_upload["uploaded_at"]:
                try:
                    last_uploaded_dt = datetime.strptime(last_upload["uploaded_at"], "%Y-%m-%d %H:%M:%S")
                    elapsed_minutes = (now_dt - last_uploaded_dt).total_seconds() / 60.0
                    if elapsed_minutes < cooldown_mins:
                        postpone_minutes = int(cooldown_mins - elapsed_minutes) + random.randint(1, 5)
                        new_time = (now_dt + timedelta(minutes=postpone_minutes)).strftime("%Y-%m-%d %H:%M:%S")
                        cursor.execute("UPDATE upload_tasks SET scheduled_time = ? WHERE id = ?", (new_time, cand["id"]))
                        conn.commit()
                        log_event("WARNING", f"[UPLOAD WORKER] 🛡️ Kênh của profile '{cand['gpm_id']}' vừa đăng clip qua '{last_upload['name']}' lúc {last_upload['uploaded_at']} (cách đây {int(elapsed_minutes)}p). Giãn cách an toàn tối thiểu {cooldown_mins}p: Tự động lùi Task #{cand['id']} tới {new_time}.")
                        continue
                except Exception:
                    pass

            # Chốt chặn kiểm tra file video render thực tế trên đĩa (tránh mở GPM vô ích nếu file hỏng/rỗng)
            video_path = cand["rendered_path"]
            if not video_path or not os.path.exists(video_path) or os.path.getsize(video_path) < 1024:
                err_text = f"File video không tồn tại hoặc bị lỗi rỗng (<1KB): {video_path}"
                log_event("ERROR", f"[UPLOAD WORKER] Hủy Task #{cand['id']}: {err_text}")
                cursor.execute("UPDATE upload_tasks SET status = 'failed', error_message = ? WHERE id = ?", (err_text, cand["id"]))
                conn.commit()
                continue

            # Profile này an toàn và đủ điều kiện để đăng
            tasks_to_dispatch.append(cand)
            dispatched_profiles.add(gpm_id)
            dispatched_linked_ids.update(linked_ids)
            if len(tasks_to_dispatch) >= available_slots:
                break

        # Khởi chạy đa luồng cho các task đã chọn
        for task in tasks_to_dispatch:
            task_id = task["id"]
            gpm_id = task["gpm_id"]
            with self._active_upload_lock:
                self._active_uploading_profiles.add(gpm_id)

            cursor.execute("""
                UPDATE upload_tasks 
                SET status = 'processing', processing_started_at = ? 
                WHERE id = ?
            """, (now_str, task_id))
            conn.commit()

            # Submit task to worker thread pool
            self._upload_pool.submit(self._execute_single_upload_task, task)

        conn.close()

    def _execute_single_upload_task(self, task: dict):
        """Thực thi một tác vụ tải lên video hoàn chỉnh trong worker thread riêng"""
        task_id = task["id"]
        video_path = task["rendered_path"]
        gpm_id = task["gpm_id"]
        title = task["title"]
        tags = task["tags"]
        cur_retries = task["retry_count"]
        now_dt = datetime.now()
        now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")

        try:
            conn = get_connection()
            cursor = conn.cursor()

            # Lấy thông tin platform và browser_type của profile
            cursor.execute("SELECT platform, browser_type FROM gpm_profiles WHERE gpm_id = ? LIMIT 1", (gpm_id,))
            p_row = cursor.fetchone()
            p_platform = (p_row["platform"] if p_row and p_row["platform"] else "tiktok").lower()
            p_browser = (p_row["browser_type"] if p_row and p_row["browser_type"] else "auto").lower()
            conn.close()

            # Tự động đảm bảo trình duyệt sẵn sàng
            from backend.modules.browser_adapters import browser_manager
            adapter = browser_manager.get_adapter(p_browser if p_browser != "auto" else "gpm")
            if adapter and hasattr(adapter, "ensure_running"):
                adapter.ensure_running()

            log_event("INFO", f"[UPLOAD WORKER] 🚀 Bắt đầu đăng Task #{task_id} qua profile '{gpm_id}' (Nền tảng: {p_platform.upper()}, Trình duyệt: {p_browser.upper()})...")

            # Thực thi upload qua MultiPlatformUploader (hỗ trợ TikTok, YouTube, Facebook x GPM, GenLogin)
            try:
                from backend.modules.multi_uploader import multi_uploader
                res = multi_uploader.upload(
                    platform=p_platform,
                    profile_id=gpm_id,
                    video_path=video_path,
                    title=title,
                    tags=tags,
                    browser_type=p_browser,
                    auto_post=True,
                    close_browser_on_finish=True
                )
            except Exception as ex:
                res = {"success": False, "message": f"Ngoại lệ khi upload: {str(ex)}"}

            conn = get_connection()
            try:
                cursor = conn.cursor()
                if res.get("success"):
                    cursor.execute("""
                        UPDATE upload_tasks 
                        SET status = 'completed', 
                            uploaded_at = ?, 
                            processing_started_at = NULL, 
                            error_message = NULL 
                        WHERE id = ?
                    """, (now_str, task_id))
                    if task.get("video_id"):
                        cursor.execute("UPDATE videos SET status = 'uploaded' WHERE id = ?", (task["video_id"],))
                    conn.commit()

                    vtag = task.get("variant_tag", "")
                    vtag_str = f" ({vtag})" if vtag else ""
                    log_event(
                        "SUCCESS", 
                        f"🚀 [GOLDEN 30-MIN] Video #{task.get('video_id')}{vtag_str} đã đăng thành công lên @{gpm_id} (Task #{task_id}) lúc {now_str}!"
                    )

                    try:
                        ch_id = task.get("channel_id")
                        cursor.execute("""
                            SELECT id, auto_engagement_enabled, auto_pin_comment, pin_comment_delay_mins,
                                   auto_reply_comments, reply_comments_delay_mins, ai_provider, ai_model
                            FROM campaigns
                            WHERE (channel_id = ? OR channel_ids LIKE ?) AND auto_engagement_enabled = 1
                            ORDER BY id DESC LIMIT 1
                        """, (ch_id, f"%{ch_id}%"))
                        camp_cfg = cursor.fetchone()
                        if camp_cfg and camp_cfg["auto_engagement_enabled"]:
                            camp_id = camp_cfg["id"]
                            p_url = res.get("post_url", "") or ""
                            if camp_cfg["auto_pin_comment"] != 0:
                                should_pin = (random.random() < 0.80)
                                if should_pin:
                                    delay_p = random.randint(3, 8)
                                    pin_dt = now_dt + timedelta(minutes=delay_p, seconds=random.randint(0, 59))
                                    pin_str = pin_dt.strftime("%Y-%m-%d %H:%M:%S")

                                    curr_part = task.get("part_number") or 1
                                    vid_id = task.get("video_id")
                                    total_p = 1
                                    if vid_id:
                                        try:
                                            cursor.execute("SELECT COUNT(*) as cnt FROM upload_tasks WHERE video_id = ?", (vid_id,))
                                            cnt_r = cursor.fetchone()
                                            if cnt_r and cnt_r["cnt"] > 0:
                                                total_p = cnt_r["cnt"]
                                        except Exception:
                                            pass

                                    from backend.modules.engagement_bot import engagement_bot
                                    seed_dict = engagement_bot.generate_seed_debate_comment(
                                        title=title,
                                        hook_copy=task.get("hook_copy") or "",
                                        part_number=curr_part,
                                        total_parts=total_p,
                                        ai_provider=camp_cfg["ai_provider"] or "default",
                                        ai_model=camp_cfg["ai_model"] or "default"
                                    )
                                    payload_json = json.dumps({
                                        "comment_text": seed_dict.get("comment", ""),
                                        "language": seed_dict.get("language", "vi"),
                                        "created_reason": "auto_pilot_campaign"
                                    }, ensure_ascii=False)
                                    cursor.execute("""
                                        SELECT COUNT(*) as cnt FROM engagement_tasks
                                        WHERE upload_task_id = ? AND task_type = 'pin_comment'
                                    """, (task_id,))
                                    if cursor.fetchone()["cnt"] == 0:
                                        cursor.execute("""
                                            INSERT INTO engagement_tasks (
                                                upload_task_id, campaign_id, gpm_profile_id, post_url,
                                                task_type, status, scheduled_time, payload
                                            ) VALUES (?, ?, ?, ?, 'pin_comment', 'pending', ?, ?)
                                        """, (task_id, camp_id, task.get("gpm_profile_id"), p_url, pin_str, payload_json))
                                        conn.commit()
                                        log_event("SUCCESS", f"🔥 [GOLDEN 30-MIN] Đã lên lịch tự động Ghim comment mồi cho Task #{task_id} lúc {pin_str}: '{seed_dict.get('comment')}'")

                            if camp_cfg["auto_reply_comments"] != 0:
                                delay_r = max(5, camp_cfg["reply_comments_delay_mins"] or 20)
                                rep_dt = now_dt + timedelta(minutes=delay_r, seconds=random.randint(0, 120))
                                rep_str = rep_dt.strftime("%Y-%m-%d %H:%M:%S")
                                cursor.execute("""
                                    SELECT COUNT(*) as cnt FROM engagement_tasks
                                    WHERE upload_task_id = ? AND task_type = 'reply_comments'
                                Lonely: """, (task_id,))
                                if cursor.fetchone()["cnt"] == 0:
                                    cursor.execute("""
                                        INSERT INTO engagement_tasks (
                                            upload_task_id, campaign_id, gpm_profile_id, post_url,
                                            task_type, status, scheduled_time
                                        ) VALUES (?, ?, ?, ?, 'reply_comments', 'pending', ?)
                                    """, (task_id, camp_id, task.get("gpm_profile_id"), p_url, rep_str))
                                    conn.commit()
                                    log_event("SUCCESS", f"💬 [GOLDEN 30-MIN] Đã lên lịch tự động Rep bình luận khán giả cho Task #{task_id} lúc {rep_str}")
                    except Exception as ex_eng:
                        log_event("WARNING", f"Lỗi khởi tạo Golden Engagement Tasks: {ex_eng}")

                    # Gửi thông báo nhắc nhở checklist tới Telegram
                    try:
                        from backend.modules.notifier import notifier
                        threading.Thread(
                            target=notifier.send_first_30min_checklist,
                            kwargs={
                                "task_id": task_id,
                                "profile_name": gpm_id,
                                "username": task.get("tiktok_username") or gpm_id,
                                "title": title,
                                "post_time": now_str,
                                "variant_tag": vtag
                            },
                            daemon=True
                        ).start()
                    except Exception:
                        pass
                else:
                    fail_msg = res.get("message", "Lỗi không xác định khi upload")
                    can_retry = (
                        self.auto_retry_enabled 
                        and cur_retries < self.max_retries 
                        and is_retryable_upload_error(fail_msg)
                    )
                    if can_retry:
                        next_retry = cur_retries + 1
                        retry_time = (now_dt + timedelta(minutes=self.retry_delay_minutes)).strftime("%Y-%m-%d %H:%M:%S")
                        cursor.execute("""
                            UPDATE upload_tasks 
                            SET status = 'queued', 
                                retry_count = ?, 
                                retry_after = ?, 
                                scheduled_time = ?, 
                                processing_started_at = NULL, 
                                error_message = ? 
                            WHERE id = ?
                        """, (
                            next_retry, 
                            retry_time, 
                            retry_time, 
                            f"[Tự động thử lại {next_retry}/{self.max_retries}] {fail_msg}", 
                            task_id
                        ))
                        conn.commit()
                        log_event("WARNING", f"Tác vụ đăng bài #{task_id} (GPM: {gpm_id}) gặp sự cố: {fail_msg}. Sẽ thử lại lần {next_retry}/{self.max_retries} vào lúc {retry_time}.")
                    else:
                        cursor.execute("""
                            UPDATE upload_tasks 
                            SET status = 'failed', 
                                processing_started_at = NULL, 
                                error_message = ? 
                            WHERE id = ?
                        """, (fail_msg, task_id))
                        conn.commit()
                        log_event("WARNING", f"Tác vụ đăng bài #{task_id} (GPM: {gpm_id}) thất bại hẳn: {fail_msg}")
                        try:
                            from backend.modules.notifier import notifier
                            solution = notifier.get_solution_for_error(fail_msg, category="upload")
                            threading.Thread(
                                target=notifier.send_issue_alert,
                                kwargs={
                                    "title": f"Lỗi Đăng Video #{task_id}",
                                    "message": f"Tác vụ tải video lên profile '{gpm_id}' không thành công.\nNguyên nhân: {fail_msg}",
                                    "solution": solution,
                                    "severity": "HIGH",
                                    "details": f"Tiêu đề: {title} | Profile: {gpm_id} | Đã thử: {cur_retries}/{self.max_retries}"
                                },
                                daemon=True
                            ).start()
                        except Exception:
                            pass
            finally:
                conn.close()
        except Exception as e_task:
            log_event("ERROR", f"[UPLOAD WORKER] Lỗi thực thi Task #{task_id}: {e_task}")
        finally:
            with self._active_upload_lock:
                self._active_uploading_profiles.discard(gpm_id)
    def _process_pending_engagements(self):
        """Worker quét và thực thi các nhiệm vụ Golden 30-Minute Engagement tới hạn"""
        if not self.is_running:
            return
        conn = get_connection()
        cursor = conn.cursor()
        now_dt = datetime.now()
        now_str = now_dt.strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute('''
            SELECT et.id, et.task_type, et.gpm_profile_id, gp.gpm_id
            FROM engagement_tasks et
            JOIN gpm_profiles gp ON et.gpm_profile_id = gp.id
            WHERE et.status = 'pending'
              AND (et.scheduled_time IS NULL OR et.scheduled_time <= ?)
            ORDER BY et.scheduled_time ASC, et.id ASC
            LIMIT 5
        ''', (now_str,))
        due_tasks = cursor.fetchall()
        conn.close()
        if not due_tasks:
            return
        from backend.modules.engagement_bot import engagement_bot
        from backend.modules.tiktok_tracker import is_profile_busy
        for dt in due_tasks:
            t_id = dt["id"]
            t_type = dt["task_type"]
            g_id = dt["gpm_id"]
            if is_profile_busy(g_id):
                continue
            if t_type == "pin_comment":
                threading.Thread(
                    target=engagement_bot.execute_pin_comment_task,
                    args=(t_id,),
                    daemon=True
                ).start()
                break
            elif t_type == "reply_comments":
                threading.Thread(
                    target=engagement_bot.execute_reply_comments_task,
                    args=(t_id,),
                    daemon=True
                ).start()
                break
scheduler = BackgroundScheduler()
