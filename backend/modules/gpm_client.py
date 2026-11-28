import os
import sys
import time
import threading
import requests
from typing import List, Dict, Optional, Any, Tuple
from backend.config import GPM_API_BASE_URL
from backend.database import log_event

# Các cổng thường dùng của GPMLogin (trích từ agent.js)
GPM_PORT_CANDIDATES = [9495, 9496, 19995, 19996, 19994, 8848]

def to_gpm_proxy_format(raw_proxy: str) -> str:
    """
    Chuyển đổi URL proxy thành định dạng chuẩn mà GPMLogin Global API hỗ trợ (ip:port:user:pass).
    GPMLogin chỉ kiểm tra thành công khi proxy được định dạng ip:port:user:pass,
    nếu truyền http://user:pass@ip:port thì GPMLogin sẽ báo 'ProxyCheckFailed' và không mở được profile.
    """
    if not raw_proxy:
        return ""
    import re
    p = raw_proxy.strip()

    # http(s)://user:pass@ip:port
    m_http_auth = re.match(r"^https?://([^:]+):([^@]+)@([^:]+):(\d+)/?$", p, re.IGNORECASE)
    if m_http_auth:
        u, pw, ip, port = m_http_auth.groups()
        return f"{ip}:{port}:{u}:{pw}"

    # socks5://user:pass@ip:port
    m_socks_auth = re.match(r"^socks5://([^:]+):([^@]+)@([^:]+):(\d+)/?$", p, re.IGNORECASE)
    if m_socks_auth:
        u, pw, ip, port = m_socks_auth.groups()
        return f"socks5://{ip}:{port}:{u}:{pw}"

    # http(s)://ip:port
    m_http = re.match(r"^https?://([^:]+):(\d+)/?$", p, re.IGNORECASE)
    if m_http:
        ip, port = m_http.groups()
        return f"{ip}:{port}"

    return p


class GridWindowManager:
    """
    Quản lý tự động chia lưới (Auto-Grid) các cửa sổ trình duyệt khi chạy Visible Mode (không ẩn).
    - Tự động nhận diện độ phân giải màn hình hiển thị (Work Area không bị Taskbar che khuất).
    - Chia đều các vị trí (X, Y) và kích thước (Width, Height) cho từng profile theo ô (Grid Slot).
    - Hỗ trợ nhiều profile chạy song song tự động xếp cạnh nhau ngay ngắn:
        + Slot 0: Nửa trên bên trái (Top-Left)
        + Slot 1: Nửa trên bên phải (Top-Right)
        + Slot 2: Nửa dưới bên trái (Bottom-Left)
        + Slot 3: Nửa dưới bên phải (Bottom-Right)
        + Slot 4+: Chia lưới 3x2 hoặc cascade lệch nhẹ để không chồng đè.
    - Tự động giải phóng slot khi profile đóng (stop_profile).
    """
    def __init__(self, cols: int = 2, rows: int = 2):
        self._lock = threading.Lock()
        self._active_slots: Dict[str, int] = {}  # profile_id -> slot_index (0, 1, 2, ...)
        self.cols = cols
        self.rows = rows
        self._screen_bounds: Optional[Tuple[int, int, int, int]] = None

    def get_screen_bounds(self) -> Tuple[int, int, int, int]:
        """Lấy vùng làm việc (Work Area) của màn hình chính (trừ thanh Taskbar)"""
        if self._screen_bounds:
            return self._screen_bounds

        left, top, width, height = 0, 0, 1536, 824
        if sys.platform == "win32":
            try:
                import ctypes
                from ctypes import wintypes
                rect = wintypes.RECT()
                # SPI_GETWORKAREA = 0x0030: Lấy toạ độ Desktop trừ đi thanh Taskbar
                if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0):
                    left = int(rect.left)
                    top = int(rect.top)
                    width = int(rect.right - rect.left)
                    height = int(rect.bottom - rect.top)
            except Exception:
                pass
        self._screen_bounds = (left, top, width, height)
        return self._screen_bounds

    def allocate_slot(self, profile_id: str, slot_override: Optional[int] = None) -> Tuple[int, int, int, int]:
        """
        Cấp phát một ô hiển thị (slot) trên lưới cho profile.
        Trả về (win_x, win_y, win_w, win_h)
        """
        with self._lock:
            if slot_override is not None and slot_override >= 0:
                slot = slot_override
                self._active_slots[profile_id] = slot
            elif profile_id in self._active_slots:
                slot = self._active_slots[profile_id]
            else:
                # Tìm slot số nguyên nhỏ nhất (0, 1, 2...) chưa bị chiếm
                occupied = set(self._active_slots.values())
                slot = 0
                while slot in occupied:
                    slot += 1
                self._active_slots[profile_id] = slot

        return self.calculate_slot_bounds(slot)

    def calculate_slot_bounds(self, slot: int) -> Tuple[int, int, int, int]:
        """
        Tính toán vị trí (X, Y) và kích thước (Width, Height) cho slot.
        Đảm bảo các cửa sổ hiển thị song song không bị đè lên nhau.
        """
        left, top, total_w, total_h = self.get_screen_bounds()
        
        # Màn hình lớn (>= 2560px) hoặc khi có từ 5 slot trở lên: chia 3 cột
        cols = self.cols
        rows = self.rows
        if total_w >= 2560 or slot >= 4:
            cols = 3
            rows = 2

        max_slots_per_screen = cols * rows
        screen_cycle = slot // max_slots_per_screen
        pos_in_cycle = slot % max_slots_per_screen

        col = pos_in_cycle % cols
        row = pos_in_cycle // cols

        slot_w = total_w // cols
        slot_h = total_h // rows

        # Nếu vượt quá số ô màn hình (cycle >= 1), tạo độ lệch nhẹ 30px để người dùng phân biệt
        cascade_offset = screen_cycle * 30
        win_x = left + (col * slot_w) + cascade_offset
        win_y = top + (row * slot_h) + cascade_offset

        return int(win_x), int(win_y), int(slot_w), int(slot_h)

    def release_slot(self, profile_id: str):
        """Giải phóng slot khi profile đóng"""
        with self._lock:
            if profile_id in self._active_slots:
                del self._active_slots[profile_id]

    def reset_all_slots(self):
        """Reset toàn bộ danh sách slot"""
        with self._lock:
            self._active_slots.clear()

    def get_active_slots_info(self) -> Dict[str, Any]:
        """Xem thông tin các profile và slot tương ứng hiện tại"""
        with self._lock:
            return dict(self._active_slots)


grid_window_manager = GridWindowManager()


class GPMClient:
    def __init__(self, base_url: str = GPM_API_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.cached_working_base: Optional[str] = None
        self.last_discovery_attempt: float = 0.0

    def discover_api_base(self) -> Optional[str]:
        """Tự động dò cổng và phiên bản API (v1 / v3) của GPMLogin giống agent.js"""
        if self.cached_working_base:
            try:
                r = requests.get(f"{self.cached_working_base}/profiles?page=1&per_page=1", timeout=1.5)
                if r.status_code == 200:
                    return self.cached_working_base
            except Exception:
                self.cached_working_base = None

        now = time.time()
        if now - self.last_discovery_attempt < 8.0:
            return None
        self.last_discovery_attempt = now

        import socket
        for port in GPM_PORT_CANDIDATES:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.35)
                    if s.connect_ex(("127.0.0.1", port)) != 0:
                        continue
            except Exception:
                continue

            for ver in ["v1", "v3"]:
                base = f"http://127.0.0.1:{port}/api/{ver}"
                try:
                    r = requests.get(f"{base}/profiles?page=1&per_page=1", timeout=1.5)
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, dict) and data.get("success"):
                            self.cached_working_base = base
                            return base
                except Exception:
                    continue

        # Thử trực tiếp cổng 9495 (cổng mặc định GPMLoginGlobal)
        try:
            r = requests.get("http://127.0.0.1:9495/api/v1/profiles?page=1&per_page=1", timeout=1.5)
            if r.status_code == 200:
                self.cached_working_base = "http://127.0.0.1:9495/api/v1"
                return self.cached_working_base
        except Exception:
            pass

        return None

    def check_health(self) -> Dict[str, Any]:
        """Kiểm tra GPMLogin App có đang chạy trên máy không"""
        base = self.discover_api_base()
        if not base:
            return {
                "running": False,
                "profile_count": 0,
                "message": "Không thể kết nối GPMLogin API (Đã dò cổng 9495, 19995...)"
            }

        try:
            r = requests.get(f"{base}/profiles?page=1&per_page=100", timeout=3)
            if r.status_code == 200:
                json_data = r.json()
                total = 0
                data_field = json_data.get("data", {})
                if isinstance(data_field, dict):
                    total = data_field.get("total", len(data_field.get("data", [])))
                elif isinstance(data_field, list):
                    total = len(data_field)

                return {
                    "running": True,
                    "profile_count": total,
                    "base_url": base,
                    "message": f"GPMLogin đang online tại {base} ({total} profiles)"
                }
        except Exception as e:
            pass

        return {
            "running": False,
            "profile_count": 0,
            "message": "Không thể kết nối GPMLogin API"
        }

    def ensure_gpm_running(self) -> bool:
        """Kiểm tra nếu GPMLogin đang tắt thì tự động bật lên"""
        import os, time, subprocess
        status = self.check_health()
        if status.get("running"):
            return True

        candidates = [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\GPMLoginGlobal\GPMLoginGlobal.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\GPMLogin\GPMLogin.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\GPMLoginGlobal\GPMLoginGlobal.exe"),
            r"C:\Program Files\GPMLogin\GPMLogin.exe",
            r"C:\Program Files (x86)\GPMLogin\GPMLogin.exe",
            os.path.expandvars(r"%APPDATA%\GPMLogin\GPMLogin.exe"),
        ]
        exe_path = None
        for p in candidates:
            if os.path.exists(p):
                exe_path = p
                break

        if exe_path:
            log_event("INFO", f"Phát hiện GPMLogin đang tắt. Đang tự động khởi chạy ứng dụng: {exe_path}")
            try:
                subprocess.Popen([exe_path], shell=False)
                # GPMLogin là ứng dụng Electron Desktop, chờ tối đa 30 giây để API local khởi động hoàn tất
                for attempt in range(1, 31):
                    time.sleep(1)
                    health = self.check_health()
                    if health.get("running"):
                        log_event("INFO", f"GPMLogin đã khởi động thành công và API sẵn sàng sau {attempt}s ({health.get('base_url')})!")
                        return True
                log_event("WARNING", "Đã khởi chạy GPMLogin nhưng API chưa sẵn sàng sau 30s. Vui lòng kiểm tra cửa sổ GPMLogin.")
            except Exception as e:
                log_event("ERROR", f"Không thể tự động bật GPMLogin: {e}")

        return False

    def list_groups(self) -> Dict[str, str]:
        """Lấy danh sách nhóm từ GPMLogin API (ánh xạ group_id -> group_name)"""
        base = self.discover_api_base()
        if not base:
            return {}
        try:
            r = requests.get(f"{base}/groups?page=1&per_page=200", timeout=4)
            if r.status_code == 200:
                data = r.json()
                raw_d = data.get("data", []) if isinstance(data, dict) else data
                if isinstance(raw_d, dict):
                    items = raw_d.get("data", [])
                elif isinstance(raw_d, list):
                    items = raw_d
                else:
                    items = []
                g_map = {}
                for g in items:
                    gid = str(g.get("id") or g.get("group_id") or "").strip()
                    gname = str(g.get("name") or g.get("group_name") or "").strip()
                    if gid and gname:
                        g_map[gid] = gname
                return g_map
        except Exception:
            pass
        return {}

    def get_profiles(self) -> List[Dict[str, Any]]:
        """Lấy toàn bộ danh sách profile từ GPMLogin (hỗ trợ phân trang đầy đủ cho 1.000+ accounts)"""
        base = self.discover_api_base()
        if not base:
            self.ensure_gpm_running()
            base = self.discover_api_base()
        if not base:
            return []

        group_map = self.list_groups()
        all_profiles = []
        page = 1
        while page <= 50:
            try:
                r = requests.get(f"{base}/profiles?page={page}&per_page=100", timeout=8)
                if r.status_code != 200:
                    break
                json_data = r.json()
                data_field = json_data.get("data", {})
                rows = []
                last_page = 1
                if isinstance(data_field, dict):
                    rows = data_field.get("data", [])
                    last_page = data_field.get("last_page", 1)
                elif isinstance(data_field, list):
                    rows = data_field

                if not rows:
                    break

                for p in rows:
                    p_id = p.get("id") or p.get("profile_id")
                    if not p_id:
                        continue
                    g_id = str(p.get("group_id", "") or p.get("groupId", "") or "")
                    g_name = str(p.get("group_name") or p.get("groupName") or p.get("group") or group_map.get(g_id) or "").strip()
                    all_profiles.append({
                        "id": str(p_id),
                        "name": p.get("name", f"Profile {p_id}"),
                        "raw_proxy": p.get("raw_proxy", "") or p.get("proxy", ""),
                        "group_id": g_id,
                        "group_name": g_name,
                        "created_at": p.get("created_at", "")
                    })

                if page >= last_page:
                    break
                page += 1
            except Exception as e:
                log_event("WARNING", f"Lỗi lấy danh sách GPM profiles (trang {page}): {str(e)}")
                break

        return all_profiles

    def find_running_debug_address(self, profile_id: str) -> Optional[str]:
        """Tự động phát hiện cổng debug của profile đang chạy sẵn nếu có (dành cho ProfileInUse)"""
        import subprocess, re
        try:
            # Lấy tên profile từ SQLite để tìm theo window title nếu có
            prof_name = ""
            try:
                from backend.database import get_connection
                conn = get_connection()
                cur = conn.cursor()
                cur.execute("SELECT name FROM gpm_profiles WHERE gpm_id = ? OR id = ?", (profile_id, profile_id))
                row = cur.fetchone()
                conn.close()
                if row and row["name"]:
                    prof_name = row["name"]
            except Exception:
                pass

            search_terms = [t for t in [prof_name, profile_id, profile_id[:8]] if t]
            cflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            out = subprocess.check_output('tasklist /V /FO CSV', shell=True, creationflags=cflags).decode('utf-8', errors='ignore')
            target_pids = []
            for line in out.splitlines():
                if 'chrome.exe' in line.lower():
                    if any(term.lower() in line.lower() for term in search_terms):
                        parts = line.split('","')
                        if len(parts) > 1:
                            pid = parts[1].replace('"', '').strip()
                            if pid.isdigit() and pid not in target_pids:
                                target_pids.append(pid)

            for pid in target_pids:
                try:
                    net_out = subprocess.check_output(f'netstat -ano | findstr {pid}', shell=True, creationflags=cflags).decode('utf-8', errors='ignore')
                    for net_line in net_out.splitlines():
                        if 'LISTENING' in net_line and '127.0.0.1:' in net_line:
                            m = re.search(r'127\.0\.0\.1:(\d+)', net_line)
                            if m:
                                port = m.group(1)
                                try:
                                    v = requests.get(f'http://127.0.0.1:{port}/json/version', timeout=1).json()
                                    ws = v.get('webSocketDebuggerUrl')
                                    if ws:
                                        return ws
                                    return f"127.0.0.1:{port}"
                                except Exception:
                                    pass
                except Exception:
                    pass
        except Exception as e:
            log_event("WARNING", f"Lỗi dò tìm debug address đang chạy cho profile {profile_id}: {e}")
        return None

    def start_profile(
        self,
        profile_id: str,
        target_url: str = "",
        low_ram_mode: bool = False,
        mute_audio: bool = False,
        invisible: Optional[bool] = None,
        grid_slot: Optional[int] = None,
    ) -> Optional[str]:
        """
        Khởi chạy profile trên GPMLogin
        Trả về remote_debugging_address (VD: 127.0.0.1:12345)
        - Tự động mở phần mềm GPMLogin nếu đang tắt.
        - low_ram_mode=True: Tiết kiệm tối đa RAM (tắt GPU, tắt load ảnh, ẩn cửa sổ offscreen)
        - invisible=True: Ẩn hoàn toàn cửa sổ ra ngoài màn hình (-3200, -3200) để không che khuất hay làm phiền người dùng
        """
        # 1. Kiểm tra nếu profile đã đang chạy sẵn thì tận dụng luôn không cần restart
        running_addr = self.find_running_debug_address(profile_id)
        if running_addr:
            log_event("INFO", f"🎯 Profile {profile_id} đã đang mở sẵn trên máy. Tự động kết nối trực tiếp tại {running_addr}")
            return running_addr

        if invisible is None:
            try:
                from backend.database import get_connection
                conn_s = get_connection()
                cur_s = conn_s.cursor()
                cur_s.execute("SELECT value FROM settings WHERE key = 'INVISIBLE_BROWSER_AUTOMATION'")
                row_s = cur_s.fetchone()
                conn_s.close()
                if row_s and row_s["value"]:
                    invisible = row_s["value"].lower() in ("true", "1", "yes")
                else:
                    invisible = os.getenv("INVISIBLE_BROWSER_AUTOMATION", "true").lower() in ("true", "1", "yes")
            except Exception:
                invisible = True

        base = self.discover_api_base()
        if not base:
            log_event("INFO", f"GPMLogin API chưa kết nối. Đang kích hoạt tự động mở GPMLogin để mở profile {profile_id}...")
            self.ensure_gpm_running()
            base = self.discover_api_base()
        if not base:
            log_event("WARNING", f"Không thể kết nối GPMLogin API sau khi thử tự mở. Vui lòng kiểm tra phần mềm GPMLogin.")
            return None

        # Đảm bảo profile được gán đúng Proxy từ ClipFlow DB trước khi mở
        try:
            from backend.database import get_connection
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT raw_proxy, country FROM gpm_profiles WHERE gpm_id = ?", (profile_id,))
            row = cur.fetchone()
            conn.close()
            if row:
                target_proxy = row["raw_proxy"] or ""
                country = (row["country"] or "").upper()
                if not target_proxy and country and country != "NONE":
                    from backend.modules.wireproxy_manager import wireproxy_manager
                    target_proxy = wireproxy_manager.get_proxy_for_country(country) or ""
                # Luôn đồng bộ proxy (kể cả rỗng "" để gỡ proxy cũ nếu profile chuyển sang Direct)
                self.update_profile_proxy(profile_id, target_proxy)
        except Exception:
            pass

        def _do_start(api_base: str) -> Optional[str]:
            url = f"{api_base}/profiles/start/{profile_id}?skip_proxy_check=true"
            args_list = []
            if low_ram_mode:
                args_list.extend([
                    "--window-position=-3200,-3200",
                    "--window-size=240,240",
                    "--blink-settings=imagesEnabled=false",
                    "--disable-gpu",
                    "--disable-software-rasterizer",
                    "--mute-audio",
                    "--no-first-run",
                    "--disable-notifications",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                ])
                url += "&win_pos=-3200,-3200&win_size=240,240"
            elif invisible:
                args_list.extend([
                    "--window-position=-3200,-3200",
                    "--window-size=1280,800",
                    "--mute-audio",
                    "--no-first-run",
                    "--disable-notifications",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                ])
                url += "&win_pos=-3200,-3200&win_size=1280,800"
            else:
                # Chế độ hiển thị: Tự động chia lưới (Auto-Grid) các cửa sổ trình duyệt song song
                gx, gy, gw, gh = grid_window_manager.allocate_slot(profile_id, slot_override=grid_slot)
                log_event("INFO", f"📐 [AUTO-GRID] Profile {profile_id} được xếp vào ô hiển thị: Vị trí ({gx}, {gy}), Kích thước {gw}x{gh}")
                args_list.extend([
                    f"--window-position={gx},{gy}",
                    f"--window-size={gw},{gh}"
                ])
                url += f"&win_pos={gx},{gy}&win_size={gw},{gh}"
            if mute_audio and not low_ram_mode and not invisible:
                args_list.append("--mute-audio")
            if target_url:
                args_list.append(target_url)

            if args_list:
                import urllib.parse
                combined_args = " ".join(args_list)
                encoded_args = urllib.parse.quote(combined_args)
                url += f"&addition_args={encoded_args}"
                if target_url:
                    url += f"&url={urllib.parse.quote(target_url)}"

            resp = requests.get(url, timeout=30)
            if resp.status_code == 200:
                json_data = resp.json()
                if json_data.get("success") is False:
                    msg = str(json_data.get("message", ""))
                    if "inuse" in msg.lower():
                        # Kiểm tra xem profile đang chạy sẵn có cổng debug dùng được không
                        existing_addr = self.find_running_debug_address(profile_id)
                        if existing_addr:
                            log_event("INFO", f"🎯 Profile {profile_id} đang chạy sẵn. Tự động kết nối trực tiếp tại {existing_addr}")
                            return existing_addr

                        log_event("INFO", f"Profile {profile_id} đang mở (ProfileInUse). Đang đóng và khởi động lại...")
                        self.stop_profile(profile_id)
                        for attempt in range(1, 5):
                            time.sleep(2.5)
                            try:
                                resp2 = requests.get(url, timeout=30)
                                if resp2.status_code == 200:
                                    json_data2 = resp2.json()
                                    if json_data2.get("success"):
                                        data2 = json_data2.get("data", {})
                                        if not isinstance(data2, dict):
                                            data2 = json_data2
                                        remote_addr2 = self._extract_debug_address(data2)
                                        if remote_addr2:
                                            log_event("INFO", f"Khởi động lại thành công GPM profile {profile_id} tại {remote_addr2}")
                                            return remote_addr2
                            except Exception:
                                pass
                    log_event("ERROR", f"GPM trả về lỗi khi mở profile {profile_id}: {json_data.get('message')}")
                    return None

                data = json_data.get("data", {})
                if not isinstance(data, dict):
                    data = json_data

                remote_addr = self._extract_debug_address(data)
                if remote_addr:
                    log_event("INFO", f"Khởi động thành công GPM profile {profile_id} tại {remote_addr}")
                    return remote_addr

            log_event("ERROR", f"Không trích xuất được debug port từ GPM cho profile {profile_id}: {resp.text}")
            return None

        try:
            addr = _do_start(base)
            if not addr:
                grid_window_manager.release_slot(profile_id)
            return addr
        except requests.exceptions.ConnectionError as conn_err:
            log_event("WARNING", f"Mất kết nối tới GPMLogin API khi mở profile {profile_id}. Đang thử tự khởi động lại GPMLogin...")
            if self.ensure_gpm_running():
                new_base = self.discover_api_base()
                if new_base:
                    try:
                        addr = _do_start(new_base)
                        if not addr:
                            grid_window_manager.release_slot(profile_id)
                        return addr
                    except Exception as retry_err:
                        log_event("ERROR", f"Lỗi thử lại sau khi bật GPMLogin: {retry_err}")
            grid_window_manager.release_slot(profile_id)
            return None
        except Exception as e:
            grid_window_manager.release_slot(profile_id)
            log_event("ERROR", f"Ngoại lệ khi mở profile GPM {profile_id}: {str(e)}")
            return None

    def stop_profile(self, profile_id: str) -> bool:
        """
        Đóng profile trên GPMLogin một cách chuẩn xác:
        1. Gọi endpoint chính xác của GPMLogin (/profiles/stop/{id}).
        2. Bỏ qua response fallback giả (404 trả về {"data": "GPMLogin Global API"}).
        3. Kiểm tra và dọn dẹp các tiến trình Chrome còn sót lại nếu có.
        4. Giải phóng slot chia lưới màn hình (Auto-Grid).
        """
        grid_window_manager.release_slot(profile_id)
        base = self.discover_api_base()
        stopped = False
        if base:
            # Thứ tự ưu tiên: endpoint chính xác /profiles/stop/{id} trước
            endpoints = [
                f"{base}/profiles/stop/{profile_id}",
                f"{base}/profile/stop?profile_id={profile_id}",
                f"{base}/profiles/close/{profile_id}"
            ]
            for url in endpoints:
                try:
                    resp = requests.get(url, timeout=8)
                    if resp.status_code == 200:
                        json_data = resp.json()
                        # Bỏ qua nếu là fallback route mặc định của GPM khi không tìm thấy route
                        if json_data.get("data") == "GPMLogin Global API":
                            continue
                        if json_data.get("success") is True or json_data.get("message") == "OK":
                            stopped = True
                            log_event("INFO", f"🔒 Đã đóng thành công GPM profile {profile_id} qua API.")
                            break
                except Exception:
                    continue

        # Đảm bảo đóng dứt điểm: kiểm tra Chrome process của profile này
        self.kill_profile_processes(profile_id)
        return True

    def kill_profile_processes(self, profile_id: str) -> bool:
        """Đảm bảo tắt các tiến trình Chrome của profile nếu bị kẹt ngầm"""
        import subprocess
        try:
            cflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
            search_terms = [t for t in [profile_id, profile_id[:8]] if t]
            out = subprocess.check_output('tasklist /V /FO CSV', shell=True, creationflags=cflags).decode('utf-8', errors='ignore')
            for line in out.splitlines():
                if 'chrome.exe' in line.lower() and any(term.lower() in line.lower() for term in search_terms):
                    parts = line.split('","')
                    if len(parts) > 1:
                        pid = parts[1].replace('"', '').strip()
                        if pid.isdigit():
                            subprocess.run(f"taskkill /F /T /PID {pid}", shell=True, capture_output=True, creationflags=cflags)
            return True
        except Exception:
            return False

    def update_profile_proxy(self, profile_id: str, raw_proxy: str) -> bool:
        """
        Cập nhật cấu hình Proxy cho Profile GPMLogin (SOCKS5 / HTTP).
        Hỗ trợ GPMLogin v1, v2, v3 qua API /profiles/update/{id}.
        Nếu raw_proxy = "" thì sẽ gỡ bỏ proxy (chạy Direct IP).
        """
        base = self.discover_api_base()
        if not base:
            # GPMLogin không mở hoặc không phản hồi cổng API, bỏ qua HTTP request để tránh timeout
            return False

        endpoints = [
            f"{base}/profiles/update/{profile_id}",
            f"{base}/profiles/{profile_id}",
        ]
        gpm_proxy = to_gpm_proxy_format(raw_proxy)
        payload = {
            "raw_proxy": gpm_proxy,
            "proxy": gpm_proxy
        }

        # 1. Thử qua POST JSON
        for ep in endpoints:
            try:
                resp = requests.post(ep, json=payload, timeout=6)
                if resp.status_code == 200:
                    json_data = resp.json()
                    if isinstance(json_data, dict) and (json_data.get("success") is True or json_data.get("status") == "success"):
                        log_event("INFO", f"Đã cập nhật proxy '{gpm_proxy or 'Direct'}' cho GPM profile {profile_id} (API POST)")
                        return True
            except Exception:
                pass

        # 2. Thử qua GET Query Parameters (một số bản GPMLogin v3 chấp nhận GET)
        import urllib.parse
        encoded_proxy = urllib.parse.quote(gpm_proxy or "")
        try:
            get_url = f"{base}/profiles/update/{profile_id}?raw_proxy={encoded_proxy}"
            resp = requests.get(get_url, timeout=6)
            if resp.status_code == 200:
                json_data = resp.json()
                if isinstance(json_data, dict) and json_data.get("success") is True:
                    log_event("INFO", f"Đã cập nhật proxy '{raw_proxy or 'Direct'}' cho GPM profile {profile_id} (API GET)")
                    return True
        except Exception:
            pass

        log_event("WARNING", f"Không thể cập nhật proxy cho GPM profile {profile_id} qua API GPM.")
        return False

    def _extract_debug_address(self, data: Dict[str, Any]) -> Optional[str]:
        """Trích xuất địa chỉ remote debug port (chuẩn trích từ agent.js:extractDebugPortFromProfile)"""
        candidates = [
            data.get("websocket_debugging_url"),
            data.get("remote_debugging_address"),
            data.get("debugger_address"),
            data.get("remote_debugging_port"),
            data.get("debug_port")
        ]
        for raw in candidates:
            if not raw:
                continue
            s_raw = str(raw)
            if "127.0.0.1:" in s_raw or "localhost:" in s_raw:
                return s_raw
            if s_raw.isdigit():
                return f"127.0.0.1:{s_raw}"
            if ":" in s_raw:
                parts = s_raw.split(":")
                port = parts[-1].split("/")[0]
                if port.isdigit():
                    return f"127.0.0.1:{port}"
        return None

gpm_client = GPMClient()

