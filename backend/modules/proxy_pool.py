"""
proxy_pool.py
-------------
Quản lý Danh Sách Proxy IP Tĩnh (Static Residential / Datacenter Proxies) cho ClipFlow.
Hỗ trợ:
- Nạp danh sách proxy từ các file .txt trong data/vpn_configs/ (e.g. 'Webshare 20 proxies.txt').
- Định dạng: ip:port:user:pass, http://user:pass@ip:port, socks5://..., ip:port.
- Tự động kiểm tra kết nối (Active / Blocked), đo độ trễ (latency ms) và định vị Quốc Gia / Thành Phố chính xác qua IP.
- Cache thông tin địa lý và trạng thái vào data/proxy_cache.json để nạp tức thì khi khởi động.
- Cung cấp danh sách quốc gia động dựa trên các IP thực tế đang có trong kho.
- Cân bằng tải tự động (Round-Robin / Least-Loaded) khi gán cho nhiều tài khoản TikTok / GPMLogin.
- Gán proxy đơn lẻ hoặc hàng loạt (Bulk Assignment) đồng bộ trực tiếp vào cơ sở dữ liệu và GPMLogin.
"""

import os
import re
import sys
import time
import json
import socket
import threading
import concurrent.futures
from pathlib import Path
from typing import Dict, Any, Optional, List, Set, Tuple

from backend.config import VPN_CONFIGS_DIR, DATA_DIR, LOGS_DIR
from backend.database import log_event, get_connection
from backend.modules.gpm_client import gpm_client

CACHE_FILE = DATA_DIR / "proxy_cache.json"

COUNTRY_FLAGS: Dict[str, str] = {
    "US": "🇺🇸", "GB": "🇬🇧", "UK": "🇬🇧", "DE": "🇩🇪", "FR": "🇫🇷", "JP": "🇯🇵",
    "KR": "🇰🇷", "CA": "🇨🇦", "AU": "🇦🇺", "SG": "🇸🇬", "NL": "🇳🇱", "MX": "🇲🇽",
    "ID": "🇮🇩", "MY": "🇲🇾", "PH": "🇵🇭", "VN": "🇻🇳", "TH": "🇹🇭", "BR": "🇧🇷",
    "IN": "🇮🇳", "ES": "🇪🇸", "IT": "🇮🇹", "PL": "🇵🇱", "TR": "🇹🇷", "RU": "🇷🇺"
}

COUNTRY_NAMES_VI: Dict[str, str] = {
    "US": "Hoa Kỳ", "GB": "Vương Quốc Anh", "UK": "Vương Quốc Anh",
    "DE": "Đức", "FR": "Pháp", "JP": "Nhật Bản", "KR": "Hàn Quốc",
    "CA": "Canada", "AU": "Úc", "SG": "Singapore", "NL": "Hà Lan",
    "MX": "Mexico", "ID": "Indonesia", "MY": "Malaysia", "PH": "Philippines",
    "VN": "Việt Nam", "TH": "Thái Lan", "BR": "Brazil", "IN": "Ấn Độ",
    "ES": "Tây Ban Nha", "IT": "Ý", "PL": "Ba Lan"
}

class ProxyItem:
    def __init__(
        self,
        ip: str,
        port: int,
        username: str = "",
        password: str = "",
        protocol: str = "http",
        source_file: str = ""
    ):
        self.ip = ip.strip()
        self.port = int(port)
        self.username = username.strip()
        self.password = password.strip()
        self.protocol = protocol.lower()
        self.source_file = source_file
        self.key = f"{self.ip}:{self.port}"

        # Thông tin địa lý & trạng thái
        self.country = "US"
        self.country_name = "Hoa Kỳ"
        self.city = ""
        self.flag = "🇺🇸"
        self.isp = ""
        self.status = "unknown"  # "active" | "blocked" | "error" | "unknown"
        self.latency_ms = 0
        self.last_checked = ""
        self.error_message = ""

    @property
    def raw_proxy_url(self) -> str:
        """Chuỗi URL proxy chuẩn: http://user:pass@ip:port"""
        if self.username and self.password:
            return f"{self.protocol}://{self.username}:{self.password}@{self.ip}:{self.port}"
        return f"{self.protocol}://{self.ip}:{self.port}"

    @property
    def standard_format(self) -> str:
        """Định dạng chuẩn ip:port:user:pass"""
        if self.username and self.password:
            return f"{self.ip}:{self.port}:{self.username}:{self.password}"
        return f"{self.ip}:{self.port}"

    @property
    def display_label(self) -> str:
        return f"{self.flag} {self.ip}:{self.port} ({self.country})"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "ip": self.ip,
            "port": self.port,
            "username": self.username,
            "password": self.password,
            "protocol": self.protocol,
            "source_file": self.source_file,
            "country": self.country,
            "country_name": self.country_name,
            "city": self.city,
            "flag": self.flag,
            "isp": self.isp,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "last_checked": self.last_checked,
            "error_message": self.error_message,
            "raw_proxy": self.raw_proxy_url,
            "display_label": self.display_label,
            "standard_format": self.standard_format
        }

    def update_from_dict(self, data: Dict[str, Any]):
        self.country = data.get("country", self.country) or "US"
        self.country_name = data.get("country_name", self.country_name) or "Hoa Kỳ"
        self.city = data.get("city", self.city) or ""
        self.flag = data.get("flag", COUNTRY_FLAGS.get(self.country, "🌐"))
        self.isp = data.get("isp", self.isp) or ""
        self.status = data.get("status", self.status) or "unknown"
        self.latency_ms = int(data.get("latency_ms", 0))
        self.last_checked = data.get("last_checked", "") or ""
        self.error_message = data.get("error_message", "") or ""


class ProxyPoolManager:
    def __init__(self):
        self._lock = threading.Lock()
        self.proxies: Dict[str, ProxyItem] = {}  # key (ip:port) -> ProxyItem
        self.is_checking = False
        VPN_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.load_cache()
        self.reload_from_files()

    def load_cache(self):
        """Nạp dữ liệu cache vị trí & trạng thái từ file JSON để UI hiển thị tức thì"""
        if not CACHE_FILE.exists():
            return
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            if isinstance(cached_data, dict):
                for key, item_data in cached_data.items():
                    ip = item_data.get("ip")
                    port = item_data.get("port")
                    if ip and port:
                        proxy = ProxyItem(
                            ip=ip,
                            port=port,
                            username=item_data.get("username", ""),
                            password=item_data.get("password", ""),
                            protocol=item_data.get("protocol", "http"),
                            source_file=item_data.get("source_file", "")
                        )
                        proxy.update_from_dict(item_data)
                        self.proxies[proxy.key] = proxy
        except Exception as e:
            log_event("WARNING", f"Lỗi đọc proxy_cache.json: {e}")

    def save_cache(self):
        """Lưu trạng thái và định vị các IP vào file JSON cache"""
        try:
            data = {k: v.to_dict() for k, v in self.proxies.items()}
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            log_event("WARNING", f"Lỗi ghi proxy_cache.json: {e}")

    def parse_line(self, line: str, source_file: str) -> Optional[ProxyItem]:
        """Phân tích một dòng proxy từ file txt"""
        raw = line.strip()
        if not raw or raw.startswith("#") or raw.startswith("//"):
            return None

        # 1. Định dạng URL: http://user:pass@ip:port hoặc socks5://user:pass@ip:port
        m_url = re.match(r"^(https?|socks5|socks4)://(?:([^:@]+):([^@]+)@)?([0-9a-zA-Z\.\-]+):(\d+)/?$", raw, re.IGNORECASE)
        if m_url:
            proto, user, pwd, ip, port = m_url.groups()
            return ProxyItem(ip=ip, port=int(port), username=user or "", password=pwd or "", protocol=proto or "http", source_file=source_file)

        # 2. Định dạng ip:port:user:pass (Webshare format phổ biến nhất)
        parts = raw.split(":")
        if len(parts) == 4:
            ip, port, user, pwd = parts
            if port.isdigit():
                return ProxyItem(ip=ip.strip(), port=int(port), username=user.strip(), password=pwd.strip(), protocol="http", source_file=source_file)

        # 3. Định dạng user:pass@ip:port
        if "@" in raw:
            auth_part, host_part = raw.split("@", 1)
            u_parts = auth_part.split(":", 1)
            h_parts = host_part.split(":", 1)
            if len(h_parts) == 2 and h_parts[1].isdigit():
                user = u_parts[0].strip() if len(u_parts) > 0 else ""
                pwd = u_parts[1].strip() if len(u_parts) > 1 else ""
                return ProxyItem(ip=h_parts[0].strip(), port=int(h_parts[1]), username=user, password=pwd, protocol="http", source_file=source_file)

        # 4. Định dạng ip:port (không mật khẩu)
        if len(parts) == 2 and parts[1].isdigit():
            return ProxyItem(ip=parts[0].strip(), port=int(parts[1]), protocol="http", source_file=source_file)

        return None

    def reload_from_files(self) -> int:
        """Quét tất cả file .txt trong data/vpn_configs/ để nạp proxy"""
        if not VPN_CONFIGS_DIR.exists():
            return 0

        new_keys = set()
        txt_files = list(VPN_CONFIGS_DIR.glob("*.txt"))

        for tf in txt_files:
            try:
                with open(tf, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        item = self.parse_line(line, tf.name)
                        if item:
                            new_keys.add(item.key)
                            with self._lock:
                                if item.key in self.proxies:
                                    # Cập nhật thông tin auth nếu có thay đổi nhưng giữ lại cache test
                                    existing = self.proxies[item.key]
                                    existing.username = item.username
                                    existing.password = item.password
                                    existing.source_file = item.source_file
                                else:
                                    # Phỏng đoán quốc gia sơ bộ theo subnet trước khi test online
                                    if item.ip.startswith("45.38.102."):
                                        item.country = "ID"
                                        item.country_name = "Indonesia"
                                        item.city = "Jakarta"
                                        item.flag = "🇮🇩"
                                    elif item.ip.startswith("185.48.53."):
                                        item.country = "MX"
                                        item.country_name = "Mexico"
                                        item.city = "Mexico City"
                                        item.flag = "🇲🇽"
                                    self.proxies[item.key] = item
            except Exception as e:
                log_event("WARNING", f"Lỗi đọc file proxy {tf.name}: {e}")

        # Xoá các proxy không còn tồn tại trong bất kỳ file .txt nào
        with self._lock:
            stale = [k for k in self.proxies.keys() if k not in new_keys]
            for k in stale:
                self.proxies.pop(k, None)

        self.save_cache()
        log_event("INFO", f"📦 Đã nạp {len(self.proxies)} IP Proxy từ {len(txt_files)} file cấu hình.")
        return len(self.proxies)

    def test_single_proxy(self, proxy_key_or_url: str) -> Dict[str, Any]:
        """Kiểm tra độ trễ, vị trí và tính sẵn sàng của 1 IP proxy"""
        import requests

        item: Optional[ProxyItem] = None
        with self._lock:
            if proxy_key_or_url in self.proxies:
                item = self.proxies[proxy_key_or_url]
            else:
                for p in self.proxies.values():
                    if p.raw_proxy_url == proxy_key_or_url or p.ip == proxy_key_or_url or p.key == proxy_key_or_url:
                        item = p
                        break

        if not item:
            return {"success": False, "error": f"Không tìm thấy proxy '{proxy_key_or_url}'"}

        proxy_url = item.raw_proxy_url
        proxies_dict = {
            "http": proxy_url,
            "https": proxy_url
        }

        start_t = time.time()
        now_str = time.strftime("%Y-%m-%d %H:%M:%S")

        try:
            # Thử qua ip-api.com trước (nhanh & đầy đủ thông tin vị trí)
            resp = requests.get(
                "http://ip-api.com/json?fields=status,message,country,countryCode,regionName,city,isp,query",
                proxies=proxies_dict,
                timeout=7
            )
            elapsed_ms = int((time.time() - start_t) * 1000)

            if resp.status_code == 200:
                data = resp.json()
                if data.get("status") == "success":
                    c_code = (data.get("countryCode") or "US").upper()
                    c_name = data.get("country") or COUNTRY_NAMES_VI.get(c_code, c_code)
                    city = data.get("city") or ""
                    isp = data.get("isp") or ""

                    with self._lock:
                        item.country = c_code
                        item.country_name = c_name
                        item.city = city
                        item.isp = isp
                        item.flag = COUNTRY_FLAGS.get(c_code, "🌐")
                        item.status = "active"
                        item.latency_ms = elapsed_ms
                        item.last_checked = now_str
                        item.error_message = ""

                    self.save_cache()
                    return {
                        "success": True,
                        "status": "active",
                        "ip": item.ip,
                        "port": item.port,
                        "country": c_code,
                        "country_name": c_name,
                        "city": city,
                        "flag": item.flag,
                        "latency_ms": elapsed_ms,
                        "last_checked": now_str
                    }

            # Fallback nếu ip-api trả về lỗi logic
            err_msg = f"HTTP {resp.status_code}"
            with self._lock:
                item.status = "blocked"
                item.error_message = err_msg
                item.latency_ms = elapsed_ms
                item.last_checked = now_str
            self.save_cache()
            return {"success": False, "status": "blocked", "error": err_msg, "latency_ms": elapsed_ms}

        except Exception as e:
            elapsed_ms = int((time.time() - start_t) * 1000)
            err_clean = str(e)
            if "timed out" in err_clean.lower():
                err_clean = "Timeout (Quá thời gian kết nối)"
            elif "407" in err_clean:
                err_clean = "407 Proxy Authentication Required (Sai user/pass)"
            elif "connection refused" in err_clean.lower():
                err_clean = "Connection Refused (Proxy đóng cổng)"
            elif "proxyerror" in err_clean.lower():
                err_clean = "Proxy Unreachable (Không thể kết nối proxy)"

            with self._lock:
                item.status = "blocked"
                item.error_message = err_clean
                item.latency_ms = elapsed_ms
                item.last_checked = now_str

            self.save_cache()
            return {"success": False, "status": "blocked", "error": err_clean, "latency_ms": elapsed_ms}

    def test_all_proxies(self, background: bool = False) -> Dict[str, Any]:
        """Kiểm tra đồng thời tất cả proxy trong pool"""
        if self.is_checking:
            return {"status": "in_progress", "message": "Đang có tiến trình kiểm tra proxy chạy ngầm..."}

        def _run():
            self.is_checking = True
            log_event("INFO", f"🔄 Đang bắt đầu kiểm tra sức khoẻ {len(self.proxies)} IP Proxy...")
            items = list(self.proxies.values())
            max_workers = min(10, max(1, len(items)))
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(self.test_single_proxy, item.key) for item in items]
                concurrent.futures.wait(futures)
            self.is_checking = False
            self.save_cache()
            active_cnt = sum(1 for p in self.proxies.values() if p.status == "active")
            blocked_cnt = sum(1 for p in self.proxies.values() if p.status == "blocked")
            log_event("INFO", f"✅ Hoàn tất kiểm tra proxy: {active_cnt} Hoạt động, {blocked_cnt} Bị chặn/Lỗi.")

        if background:
            threading.Thread(target=_run, daemon=True, name="ProxyPool-Checker").start()
            return {"status": "started", "message": f"Đã bắt đầu kiểm tra {len(self.proxies)} IP trong nền."}
        else:
            _run()
            return self.get_summary()

    def get_summary(self) -> Dict[str, Any]:
        """Thống kê tổng thể về kho IP Proxy"""
        proxies_list = [p.to_dict() for p in self.proxies.values()]
        active_cnt = sum(1 for p in self.proxies.values() if p.status == "active")
        blocked_cnt = sum(1 for p in self.proxies.values() if p.status == "blocked")
        unknown_cnt = sum(1 for p in self.proxies.values() if p.status == "unknown")

        # Đếm số profile đang sử dụng mỗi proxy
        usage_counts: Dict[str, int] = {}
        try:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT raw_proxy, count(*) as cnt FROM gpm_profiles WHERE raw_proxy IS NOT NULL AND raw_proxy != '' GROUP BY raw_proxy")
            for row in cur.fetchall():
                p_url = row["raw_proxy"]
                for p in self.proxies.values():
                    if p.raw_proxy_url == p_url or p.key in p_url or p.standard_format in p_url:
                        usage_counts[p.key] = usage_counts.get(p.key, 0) + row["cnt"]
            conn.close()
        except Exception:
            pass

        for p_data in proxies_list:
            p_data["assigned_count"] = usage_counts.get(p_data["key"], 0)

        # Lấy danh sách quốc gia kèm số lượng IP
        countries_map: Dict[str, Dict[str, Any]] = {}
        for p in self.proxies.values():
            c = p.country
            if c not in countries_map:
                countries_map[c] = {
                    "code": c,
                    "name": p.country_name,
                    "flag": p.flag,
                    "total": 0,
                    "active": 0,
                    "blocked": 0
                }
            countries_map[c]["total"] += 1
            if p.status == "active":
                countries_map[c]["active"] += 1
            elif p.status == "blocked":
                countries_map[c]["blocked"] += 1

        return {
            "total_proxies": len(self.proxies),
            "active_count": active_cnt,
            "blocked_count": blocked_cnt,
            "unknown_count": unknown_cnt,
            "is_checking": self.is_checking,
            "countries": list(countries_map.values()),
            "proxies": proxies_list
        }

    def get_available_countries(self) -> List[Dict[str, Any]]:
        """Trả về danh sách quốc gia thực tế có sẵn từ kho IP"""
        countries_map: Dict[str, Dict[str, Any]] = {}
        for p in self.proxies.values():
            c = p.country
            if not c:
                continue
            if c not in countries_map:
                countries_map[c] = {
                    "code": c,
                    "name": p.country_name or COUNTRY_NAMES_VI.get(c, c),
                    "flag": p.flag or COUNTRY_FLAGS.get(c, "🌐"),
                    "count": 0,
                    "active_count": 0
                }
            countries_map[c]["count"] += 1
            if p.status == "active":
                countries_map[c]["active_count"] += 1

        # Sắp xếp theo số lượng IP giảm dần
        return sorted(list(countries_map.values()), key=lambda x: x["count"], reverse=True)

    def find_proxy(self, identifier: str) -> Optional[ProxyItem]:
        """Tìm proxy theo ip:port, URL hoặc IP đơn thuần"""
        target = (identifier or "").strip().lower()
        if not target or target == "none" or target == "direct":
            return None

        for p in self.proxies.values():
            if (
                p.key.lower() == target
                or p.raw_proxy_url.lower() == target
                or p.standard_format.lower() == target
                or p.ip.lower() == target
                or target in p.raw_proxy_url.lower()
            ):
                return p
        return None

    def get_proxy_for_country(self, country: str, rotate: bool = True) -> Optional[ProxyItem]:
        """Cân bằng tải: chọn IP ít tài khoản sử dụng nhất thuộc quốc gia đó"""
        c_target = (country or "").strip().upper()
        candidates = [p for p in self.proxies.values() if p.country.upper() == c_target and p.status != "blocked"]
        if not candidates:
            # Fallback nếu không có active thì lấy bất kỳ proxy nào cùng nước
            candidates = [p for p in self.proxies.values() if p.country.upper() == c_target]
        if not candidates:
            return None

        if len(candidates) == 1 or not rotate:
            return candidates[0]

        # Đếm số profile đang dùng mỗi IP để cân bằng tải (Least-Loaded)
        usage = {p.key: 0 for p in candidates}
        try:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute("SELECT raw_proxy, count(*) as cnt FROM gpm_profiles WHERE raw_proxy IS NOT NULL AND raw_proxy != '' GROUP BY raw_proxy")
            for row in cur.fetchall():
                p_url = row["raw_proxy"]
                for p in candidates:
                    if p.raw_proxy_url == p_url or p.key in p_url:
                        usage[p.key] += row["cnt"]
            conn.close()
        except Exception:
            pass

        # Chọn IP có ít profile nhất
        sorted_candidates = sorted(candidates, key=lambda p: usage[p.key])
        return sorted_candidates[0]

    def assign_proxy_to_profile(self, gpm_id: str, proxy_key_or_direct: str) -> Dict[str, Any]:
        """Gán proxy cho 1 profile GPM Login"""
        target = (proxy_key_or_direct or "").strip()
        is_direct = target == "" or target.lower() in ("none", "direct")

        conn = get_connection()
        cur = conn.cursor()

        if is_direct:
            cur.execute("UPDATE gpm_profiles SET raw_proxy = '', country = 'NONE' WHERE gpm_id = ?", (gpm_id,))
            conn.commit()
            conn.close()
            gpm_client.update_profile_proxy(gpm_id, "")
            log_event("INFO", f"🌐 Đã gỡ bỏ Proxy cho profile {gpm_id} (Dùng Direct IP)")
            return {
                "success": True,
                "gpm_id": gpm_id,
                "proxy_url": "",
                "ip_key": "",
                "country": "NONE",
                "country_name": "Direct (Không dùng Proxy)",
                "flag": "🌐"
            }

        item = self.find_proxy(target)
        if not item:
            conn.close()
            return {"success": False, "error": f"Không tìm thấy IP Proxy '{target}' trong kho"}

        proxy_str = item.standard_format
        country = item.country

        cur.execute("UPDATE gpm_profiles SET raw_proxy = ?, country = ? WHERE gpm_id = ?", (proxy_str, country, gpm_id))
        conn.commit()
        conn.close()

        # Đồng bộ sang GPMLogin API (định dạng chuẩn ip:port:user:pass)
        gpm_synced = gpm_client.update_profile_proxy(gpm_id, proxy_str)
        log_event("INFO", f"⚡ Đã gán proxy {item.ip}:{item.port} ({country}) cho profile {gpm_id} (GPM Synced: {gpm_synced})")

        return {
            "success": True,
            "gpm_id": gpm_id,
            "proxy_url": proxy_str,
            "ip_key": item.key,
            "ip": item.ip,
            "port": item.port,
            "country": country,
            "country_name": item.country_name,
            "flag": item.flag,
            "gpm_synced": gpm_synced
        }

    def bulk_assign_proxies(
        self,
        gpm_ids: List[str],
        mode: str = "round_robin",  # "round_robin" | "specific_ip" | "by_country" | "direct"
        target_value: str = ""
    ) -> Dict[str, Any]:
        """
        Gán proxy hàng loạt cho danh sách profile đã chọn:
        - mode='direct': Gỡ bỏ proxy cho tất cả profile đã chọn.
        - mode='specific_ip': Gán đúng 1 IP cho tất cả profile đã chọn.
        - mode='round_robin': Chia đều danh sách IP có sẵn cho các profile.
        - mode='by_country': Chia đều danh sách IP thuộc quốc gia chỉ định cho các profile.
        """
        if not gpm_ids:
            return {"success": False, "error": "Chưa chọn tài khoản nào để gán proxy"}

        conn = get_connection()
        cur = conn.cursor()
        total = len(gpm_ids)
        assigned_count = 0
        gpm_synced_count = 0

        sync_tasks: List[Tuple[str, str]] = []

        if mode == "direct":
            for gid in gpm_ids:
                cur.execute("UPDATE gpm_profiles SET raw_proxy = '', country = 'NONE' WHERE gpm_id = ?", (gid,))
                assigned_count += 1
                sync_tasks.append((gid, ""))
            conn.commit()
            conn.close()

            for gid, p_val in sync_tasks:
                if gpm_client.update_profile_proxy(gid, p_val):
                    gpm_synced_count += 1

            log_event("INFO", f"🌐 Đã gỡ bỏ Proxy hàng loạt cho {assigned_count} profile (GPM Synced: {gpm_synced_count}).")
            return {
                "success": True,
                "mode": mode,
                "total": total,
                "assigned": assigned_count,
                "gpm_synced": gpm_synced_count,
                "message": f"Đã chuyển {assigned_count} profile về mạng trực tiếp (Direct IP)"
            }

        if mode == "specific_ip":
            item = self.find_proxy(target_value)
            if not item:
                conn.close()
                return {"success": False, "error": f"Không tìm thấy IP Proxy '{target_value}'"}

            p_str = item.standard_format
            cntry = item.country
            for gid in gpm_ids:
                cur.execute("UPDATE gpm_profiles SET raw_proxy = ?, country = ? WHERE gpm_id = ?", (p_str, cntry, gid))
                assigned_count += 1
                sync_tasks.append((gid, p_str))
            conn.commit()
            conn.close()

            for gid, p_val in sync_tasks:
                if gpm_client.update_profile_proxy(gid, p_val):
                    gpm_synced_count += 1

            log_event("INFO", f"⚡ Đã gán IP {item.key} ({cntry}) cho {assigned_count} profile (GPM Synced: {gpm_synced_count}).")
            return {
                "success": True,
                "mode": mode,
                "total": total,
                "assigned": assigned_count,
                "gpm_synced": gpm_synced_count,
                "ip": item.key,
                "country": cntry,
                "message": f"Đã gán IP {item.key} ({cntry}) cho {assigned_count} profile"
            }

        # Lựa chọn danh sách IP pool để phân bổ (Round-Robin)
        pool: List[ProxyItem] = []
        if mode == "by_country":
            cntry = (target_value or "").strip().upper()
            pool = [p for p in self.proxies.values() if p.country.upper() == cntry and p.status != "blocked"]
            if not pool:
                pool = [p for p in self.proxies.values() if p.country.upper() == cntry]
            if not pool:
                conn.close()
                return {"success": False, "error": f"Không có IP nào thuộc quốc gia {cntry}"}
        else:
            # Round-robin trên toàn bộ IP active (hoặc tất cả nếu chưa test)
            pool = [p for p in self.proxies.values() if p.status != "blocked"]
            if not pool:
                pool = list(self.proxies.values())
            if not pool:
                conn.close()
                return {"success": False, "error": "Kho IP trống! Hãy thêm file proxy vào data/vpn_configs/"}

        # Phân bổ đều các IP trong pool
        pool_len = len(pool)
        for idx, gid in enumerate(gpm_ids):
            item = pool[idx % pool_len]
            p_str = item.standard_format
            cntry = item.country
            cur.execute("UPDATE gpm_profiles SET raw_proxy = ?, country = ? WHERE gpm_id = ?", (p_str, cntry, gid))
            assigned_count += 1
            sync_tasks.append((gid, p_str))

        conn.commit()
        conn.close()

        for gid, p_val in sync_tasks:
            if gpm_client.update_profile_proxy(gid, p_val):
                gpm_synced_count += 1

        log_event("INFO", f"⚖️ Đã phân bổ đều {pool_len} IP cho {assigned_count} profile (GPM Synced: {gpm_synced_count}).")
        return {
            "success": True,
            "mode": mode,
            "total": total,
            "assigned": assigned_count,
            "gpm_synced": gpm_synced_count,
            "pool_size": pool_len,
            "message": f"Đã phân bổ đều {pool_len} IP cho {assigned_count} profile"
        }

proxy_pool_manager = ProxyPoolManager()
