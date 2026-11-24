"""
wireproxy_manager.py
--------------------
Quản lý WireGuard SOCKS5 Proxy cho ClipFlow thông qua wireproxy (userspace WireGuard).
Hỗ trợ:
- Nhiều file cấu hình / nhiều địa điểm (Multi-location) cho cùng 1 quốc gia (VD: US-Miami, US-New York, US-LA,...).
- Tự động gán cổng riêng biệt (10801, 10802, 10803,...) cho từng địa điểm / server.
- Tự động Cân Bằng Tải (Round-Robin Load Balancing) khi gán cho 1.000 profile GPMLogin:
  Nếu US có 3 server, các nick sẽ được chia đều ra 3 server để tránh bị dồn 1 IP!
- Chạy ngầm trong userspace, không chiếm quyền Admin, không xung đột mạng Windows.
"""

import os
import re
import sys
import time
import socket
import atexit
import shutil
import tarfile
import urllib.request
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, List
from backend.config import VPN_CONFIGS_DIR, WIREPROXY_EXE, DATA_DIR, LOGS_DIR
from backend.database import log_event

RUNTIME_DIR = VPN_CONFIGS_DIR / ".runtime"

# Bảng ánh xạ cổng SOCKS5 cơ sở theo mã quốc gia ISO
BASE_COUNTRY_PORTS: Dict[str, int] = {
    "US": 10801,  # Hoa Kỳ
    "GB": 10811,  # Vương Quốc Anh
    "UK": 10811,  # Vương Quốc Anh alias
    "DE": 10821,  # Đức
    "FR": 10831,  # Pháp
    "JP": 10841,  # Nhật Bản
    "KR": 10851,  # Hàn Quốc
    "CA": 10861,  # Canada
    "AU": 10871,  # Úc
    "SG": 10881,  # Singapore
    "NL": 10891,  # Hà Lan
    "MX": 10901,  # Mexico
    "ID": 10911,  # Indonesia
    "MY": 10921,  # Malaysia
    "PH": 10931,  # Philippines
    "VN": 10941,  # Việt Nam
}

COUNTRY_NAMES_LOOKUP: Dict[str, str] = {
    "UNITED STATES": "US", "USA": "US", "AMERICA": "US",
    "UNITED KINGDOM": "GB", "BRITAIN": "GB", "ENGLAND": "GB", "UK": "GB",
    "GERMANY": "DE", "DEUTSCHLAND": "DE",
    "FRANCE": "FR",
    "JAPAN": "JP",
    "KOREA": "KR", "SOUTH KOREA": "KR",
    "CANADA": "CA",
    "AUSTRALIA": "AU",
    "SINGAPORE": "SG",
    "NETHERLANDS": "NL", "HOLLAND": "NL",
    "MEXICO": "MX",
    "INDONESIA": "ID",
    "MALAYSIA": "MY",
    "PHILIPPINES": "PH",
    "VIETNAM": "VN",
}

KNOWN_ENDPOINT_CITIES: Dict[str, str] = {
    "195.181.163.1": "Miami",
    "149.40.62.21": "Seattle",
    "188.214.125.163": "Manila",
    "188.214.125.1": "Manila",
}

FLAG_EMOJIS: Dict[str, str] = {
    "US": "🇺🇸", "GB": "🇬🇧", "DE": "🇩🇪", "FR": "🇫🇷", "JP": "🇯🇵",
    "KR": "🇰🇷", "CA": "🇨🇦", "AU": "🇦🇺", "SG": "🇸🇬", "NL": "🇳🇱",
    "MX": "🇲🇽", "ID": "🇮🇩", "MY": "🇲🇾", "PH": "🇵🇭", "VN": "🇻🇳"
}

class WireproxyManager:
    def __init__(self):
        self.processes: Dict[str, subprocess.Popen] = {}
        self.proxies: Dict[str, Dict[str, Any]] = {}  # proxy_id -> meta
        self.country_map: Dict[str, List[str]] = {}   # country_code -> [proxy_id, ...]
        self.round_robin_counters: Dict[str, int] = {}
        self.is_initialized = False
        VPN_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    def ensure_wireproxy_binary(self) -> bool:
        """Đảm bảo file thực thi wireproxy.exe có sẵn trên máy"""
        if WIREPROXY_EXE.exists() and WIREPROXY_EXE.is_file():
            return True

        WIREPROXY_EXE.parent.mkdir(parents=True, exist_ok=True)
        download_url = "https://github.com/windtf/wireproxy/releases/download/v1.1.3/wireproxy_windows_amd64.tar.gz"
        archive_path = WIREPROXY_EXE.parent / "wireproxy.tar.gz"
        log_event("INFO", f"Đang tự động tải wireproxy từ {download_url}...")

        try:
            urllib.request.urlretrieve(download_url, str(archive_path))
            with tarfile.open(archive_path, "r:gz") as tar:
                tar.extractall(path=WIREPROXY_EXE.parent)
            if archive_path.exists():
                archive_path.unlink()
            if WIREPROXY_EXE.exists():
                log_event("INFO", "Đã cài đặt wireproxy thành công!")
                return True
        except Exception as e:
            log_event("ERROR", f"Lỗi tải wireproxy tự động: {e}")

        return False

    def parse_config_info(self, file_path: Path) -> Dict[str, str]:
        """
        Trích xuất thông tin quốc gia và địa điểm (thành phố, server #)
        từ tên file và metadata bên trong file cấu hình Proton VPN.
        """
        stem = file_path.stem
        country = None
        key_for = ""
        peer_comment = ""
        endpoint_ip = ""

        # Đọc nội dung file trích xuất comment của Proton VPN
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
                for i, line in enumerate(lines):
                    s_line = line.strip()
                    if s_line.lower().startswith("endpoint"):
                        parts = s_line.split("=", 1)
                        if len(parts) == 2:
                            endpoint_ip = parts[1].strip().split(":")[0].strip()
                    if "key for" in s_line.lower():
                        key_for = s_line.lstrip("#").strip().replace("Key for", "").strip()
                    if s_line.startswith("[Peer]"):
                        for next_line in lines[i+1:i+6]:
                            next_s = next_line.strip()
                            if next_s.startswith("#") and "uncomment" not in next_s.lower():
                                peer_comment = next_s.lstrip("#").strip()
                                break
        except Exception:
            pass

        # 1. Nhận diện quốc gia từ metadata Proton VPN hoặc tên file
        def _norm_c(c: str) -> str:
            u = (c or "").upper()
            return "GB" if u == "UK" else u

        # Ưu tiên A: Proton VPN peer comment (VD: # US-FREE#3, # NL-FREE#1, # JP-FREE#2, # UK#226)
        if peer_comment:
            m_peer = re.match(r"^([A-Za-z]{2})(?:[-_#.]|$)", peer_comment)
            if m_peer:
                cand_c = _norm_c(m_peer.group(1))
                if cand_c in BASE_COUNTRY_PORTS:
                    country = cand_c

        # Ưu tiên B: Proton VPN Key for comment (VD: # Key for us_miami)
        if not country and key_for:
            m_kf = re.match(r"^([A-Za-z]{2})(?:[-_#.]|$)", key_for)
            if m_kf:
                cand_c = _norm_c(m_kf.group(1))
                if cand_c in BASE_COUNTRY_PORTS:
                    country = cand_c

        # Ưu tiên C: Khớp 2 ký tự ở đầu tên file (VD: US.conf, US-Miami.conf, US-FREE#3.conf, UK-226.conf)
        if not country:
            m_start = re.match(r"^(?:wg[-_])?([A-Za-z]{2})(?:[-_#.]|$)", stem, re.IGNORECASE)
            if m_start:
                cand_c = _norm_c(m_start.group(1))
                if cand_c in BASE_COUNTRY_PORTS:
                    country = cand_c

        # Ưu tiên D: Tìm mã quốc gia bất kỳ trong tên file
        if not country:
            m_any = re.search(r"(?:^|[_\-.])([A-Za-z]{2})(?:[_\-.]|$)", stem)
            if m_any:
                cand_c = _norm_c(m_any.group(1))
                if cand_c in BASE_COUNTRY_PORTS:
                    country = cand_c

        # Ưu tiên E: Tìm theo tên nước tiếng Anh
        if not country:
            upper_stem = stem.upper().replace("-", " ").replace("_", " ")
            for name, code in COUNTRY_NAMES_LOOKUP.items():
                if name in upper_stem:
                    country = code
                    break

        if not country:
            country = "US"  # Fallback

        # 2. Nhận diện Tên Địa Điểm / Thành Phố / Server
        place_parts = []
        if endpoint_ip and endpoint_ip in KNOWN_ENDPOINT_CITIES:
            place_parts.append(KNOWN_ENDPOINT_CITIES[endpoint_ip])

        if key_for:
            # e.g. "us_miami" -> "Miami"
            clean_kf = re.sub(r"^[A-Za-z]{2}[_\-.]?", "", key_for).replace("_", " ").title().strip()
            if clean_kf and clean_kf not in place_parts:
                place_parts.append(clean_kf)

        if peer_comment and peer_comment != key_for:
            place_parts.append(peer_comment)

        if not place_parts:
            # Làm sạch stem để lấy tên địa điểm
            clean_s = re.sub(r"^[A-Za-z]{2}[_\-.]?", "", stem)
            clean_s = clean_s.replace("_", " ").replace("-", " ").title().strip()
            if clean_s:
                place_parts.append(clean_s)

        place_name = " - ".join(place_parts) if place_parts else "Default"
        flag = FLAG_EMOJIS.get(country, "🌐")
        display_label = f"{flag} {country} ({place_name})"

        # proxy_id an toàn dùng cho process & file
        proxy_id = re.sub(r"[^a-zA-Z0-9_\-]", "_", stem).lower()

        return {
            "proxy_id": proxy_id,
            "country": country,
            "place": place_name,
            "label": display_label,
            "flag": flag
        }

    def allocate_port_for_proxy(self, proxy_id: str, country: str) -> int:
        """Cấp phát cổng SOCKS5 duy nhất cho từng địa điểm"""
        # Nếu proxy này đã từng được cấp cổng, giữ nguyên
        if proxy_id in self.proxies and "port" in self.proxies[proxy_id]:
            return self.proxies[proxy_id]["port"]

        used_ports = set()
        for meta in self.proxies.values():
            if "port" in meta:
                used_ports.add(meta["port"])

        base = BASE_COUNTRY_PORTS.get(country, 11000)
        cand = base
        while cand in used_ports:
            cand += 1

        return cand

    def prepare_runtime_config(self, source_conf: Path, proxy_id: str, port: int) -> Path:
        """Chuẩn bị file cấu hình runtime wireproxy với khối [Socks5], tự động lọc IPv6 tránh treo mạng trên Windows"""
        with open(source_conf, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        cleaned_lines = []
        skip_section = False
        for line in lines:
            stripped = line.strip().lower()
            if stripped.startswith("[socks5]") or stripped.startswith("[http]"):
                skip_section = True
                continue
            if skip_section and stripped.startswith("[") and stripped.endswith("]"):
                skip_section = False
            if skip_section:
                continue

            # Lọc bỏ địa chỉ IPv6 trong Address và DNS để tránh timeout trên Windows userspace wireproxy
            if stripped.startswith("address"):
                parts = line.split("=", 1)
                if len(parts) == 2:
                    ipv4_addrs = [a.strip() for a in parts[1].split(",") if ":" not in a.strip()]
                    if ipv4_addrs:
                        cleaned_lines.append(f"Address = {', '.join(ipv4_addrs)}\n")
                        continue
            elif stripped.startswith("dns"):
                parts = line.split("=", 1)
                if len(parts) == 2:
                    ipv4_dns = [d.strip() for d in parts[1].split(",") if ":" not in d.strip()]
                    if ipv4_dns:
                        cleaned_lines.append(f"DNS = {', '.join(ipv4_dns)}\n")
                        continue

            cleaned_lines.append(line)

        socks_block = f"\n[Socks5]\nBindAddress = 127.0.0.1:{port}\n"
        runtime_conf_path = RUNTIME_DIR / f"{proxy_id}.conf"
        with open(runtime_conf_path, "w", encoding="utf-8") as f:
            f.writelines(cleaned_lines)
            f.write(socks_block)

        return runtime_conf_path

    def free_port(self, port: int):
        """Giải phóng cổng nếu có tiến trình wireproxy cũ mồ côi đang chiếm dụng"""
        if not self.is_port_open(port):
            return
        if sys.platform == "win32":
            try:
                cflags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
                cmd = f"netstat -ano | findstr :{port}"
                out = subprocess.check_output(cmd, shell=True, creationflags=cflags).decode("utf-8", errors="ignore")
                for line in out.splitlines():
                    if "LISTENING" in line:
                        parts = line.strip().split()
                        pid = parts[-1]
                        if pid and pid != "0":
                            subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True, timeout=2, creationflags=cflags)
                time.sleep(0.3)
            except Exception:
                pass

    def is_port_open(self, port: int, timeout: float = 0.5) -> bool:
        """Kiểm tra cổng SOCKS5 có đang lắng nghe không"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                return s.connect_ex(("127.0.0.1", port)) == 0
        except Exception:
            return False

    def start_proxy(self, conf_path: Path) -> bool:
        """Khởi chạy một tiến trình wireproxy cho một file cấu hình địa điểm"""
        if not self.ensure_wireproxy_binary():
            log_event("ERROR", "wireproxy.exe chưa sẵn sàng!")
            return False

        info = self.parse_config_info(conf_path)
        proxy_id = info["proxy_id"]
        country = info["country"]
        port = self.allocate_port_for_proxy(proxy_id, country)

        # Dừng tiến trình cũ nếu đang chạy và giải phóng cổng
        self.stop_proxy(proxy_id)
        self.free_port(port)

        runtime_conf = self.prepare_runtime_config(conf_path, proxy_id, port)
        log_path = LOGS_DIR / f"wireproxy_{proxy_id}.log"
        log_file = open(log_path, "w", encoding="utf-8")

        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW

        try:
            cmd = [str(WIREPROXY_EXE), "-c", str(runtime_conf)]
            proc = subprocess.Popen(
                cmd,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                creationflags=creation_flags
            )
            self.processes[proxy_id] = proc

            # Chờ cổng mở (tối đa 4 giây)
            for _ in range(8):
                time.sleep(0.5)
                if self.is_port_open(port):
                    meta = {
                        "proxy_id": proxy_id,
                        "country": country,
                        "place": info["place"],
                        "label": info["label"],
                        "flag": info["flag"],
                        "port": port,
                        "proxy_url": f"socks5://127.0.0.1:{port}",
                        "source_file": conf_path.name,
                        "status": "running",
                        "started_at": time.time()
                    }
                    self.proxies[proxy_id] = meta

                    if country not in self.country_map:
                        self.country_map[country] = []
                    if proxy_id not in self.country_map[country]:
                        self.country_map[country].append(proxy_id)

                    log_event("INFO", f"✅ Khởi động WireGuard Proxy [{info['label']}] tại socks5://127.0.0.1:{port} (PID: {proc.pid})")
                    return True

            log_event("WARNING", f"Wireproxy cho [{proxy_id}] đã bật nhưng chưa phản hồi trên cổng {port}")
            return False
        except Exception as e:
            log_event("ERROR", f"Lỗi khởi chạy wireproxy cho {proxy_id}: {e}")
            return False

    def stop_proxy(self, proxy_id: str):
        """Dừng tiến trình wireproxy của một địa điểm"""
        proc = self.processes.pop(proxy_id, None)
        if proc:
            try:
                proc.terminate()
                proc.wait(timeout=2)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        if proxy_id in self.proxies:
            self.proxies[proxy_id]["status"] = "stopped"

    def remove_proxy(self, proxy_id: str, delete_source_file: bool = False) -> bool:
        """Dừng tiến trình và gỡ bỏ hoàn toàn proxy khỏi hệ thống (tuỳ chọn xoá file .conf gốc)"""
        meta = self.proxies.get(proxy_id)
        source_file_name = meta.get("source_file") if meta else None

        # 1. Dừng tiến trình
        self.stop_proxy(proxy_id)

        # 2. Xoá khỏi proxies dict
        self.proxies.pop(proxy_id, None)

        # 3. Xoá khỏi country_map
        for c, pids in list(self.country_map.items()):
            if proxy_id in pids:
                pids.remove(proxy_id)
            if not pids:
                self.country_map.pop(c, None)

        # 4. Xoá file runtime
        runtime_conf = RUNTIME_DIR / f"{proxy_id}.conf"
        if runtime_conf.exists():
            try:
                runtime_conf.unlink()
            except Exception:
                pass

        # 5. Nếu yêu cầu xoá file gốc .conf
        if delete_source_file:
            if not source_file_name:
                for cf in VPN_CONFIGS_DIR.glob("*.conf"):
                    if cf.stem.lower() == proxy_id.lower() or cf.name.lower() == proxy_id.lower():
                        source_file_name = cf.name
                        break
            if source_file_name:
                source_path = VPN_CONFIGS_DIR / source_file_name
                if source_path.exists():
                    try:
                        source_path.unlink()
                        log_event("INFO", f"🗑️ Đã xoá file cấu hình: {source_file_name}")
                    except Exception as e:
                        log_event("ERROR", f"Không thể xoá file {source_file_name}: {e}")
                        return False
        return True

    def prune_stale_proxies(self) -> List[str]:
        """Dọn dẹp các proxy có file .conf nguồn không còn tồn tại trên đĩa"""
        if not VPN_CONFIGS_DIR.exists():
            return []
        current_files = {cf.name.lower() for cf in VPN_CONFIGS_DIR.glob("*.conf")}
        stale_pids = [
            pid for pid, meta in list(self.proxies.items())
            if (meta.get("source_file") or "").lower() not in current_files
        ]
        for pid in stale_pids:
            log_event("INFO", f"🧹 File nguồn của [{pid}] không còn trên đĩa. Đang dọn dẹp...")
            self.remove_proxy(pid, delete_source_file=False)
        return stale_pids

    def delete_proxy(self, proxy_id_or_file: str) -> Dict[str, Any]:
        """Xoá vĩnh viễn 1 proxy theo proxy_id hoặc tên file"""
        target = (proxy_id_or_file or "").strip()
        if not target:
            return {"success": False, "error": "Thiếu proxy_id hoặc tên file"}

        found_pid = None
        source_name = None

        for pid, meta in self.proxies.items():
            if pid.lower() == target.lower() or meta.get("source_file", "").lower() == target.lower():
                found_pid = pid
                source_name = meta.get("source_file")
                break

        if not found_pid:
            for cf in VPN_CONFIGS_DIR.glob("*.conf"):
                if cf.name.lower() == target.lower() or cf.stem.lower() == target.lower():
                    source_name = cf.name
                    info = self.parse_config_info(cf)
                    found_pid = info["proxy_id"]
                    break

        if not found_pid and not source_name:
            return {"success": False, "error": f"Không tìm thấy proxy cấu hình cho '{target}'"}

        # Xoá file .conf
        if source_name:
            source_path = VPN_CONFIGS_DIR / source_name
            if source_path.exists():
                try:
                    source_path.unlink()
                except Exception as e:
                    return {"success": False, "error": f"Lỗi khi xoá file {source_name}: {e}"}

        # Dừng và gỡ khỏi bộ nhớ
        if found_pid:
            self.remove_proxy(found_pid, delete_source_file=False)

        # Dọn dẹp thêm stale nếu có
        self.prune_stale_proxies()

        log_event("INFO", f"🗑️ Đã xoá thành công Proxy WireGuard [{found_pid or source_name}]")
        return {
            "success": True,
            "message": f"Đã xoá proxy {source_name or found_pid}",
            "proxy_id": found_pid,
            "source_file": source_name,
            "remaining_count": len(list(VPN_CONFIGS_DIR.glob("*.conf")))
        }

    def start_all(self) -> Dict[str, Any]:
        """Quét toàn bộ thư mục vpn_configs và khởi động tất cả file địa điểm, đồng thời gỡ bỏ các file đã bị xoá"""
        if not VPN_CONFIGS_DIR.exists():
            VPN_CONFIGS_DIR.mkdir(parents=True, exist_ok=True)

        # 1. Dọn dẹp trước các file đã bị xoá
        self.prune_stale_proxies()

        conf_files = list(VPN_CONFIGS_DIR.glob("*.conf"))
        if not conf_files:
            log_event("INFO", "Không còn file WireGuard .conf nào trong data/vpn_configs/.")
            return {"status": "no_configs", "count": 0, "active_count": 0, "proxies": {}}

        started_count = 0
        for conf_file in conf_files:
            info = self.parse_config_info(conf_file)
            pid = info["proxy_id"]
            if pid in self.proxies and self.is_port_open(self.proxies[pid]["port"]) and pid in self.processes:
                started_count += 1
                continue

            success = self.start_proxy(conf_file)
            if success:
                started_count += 1

        self.is_initialized = True
        log_event("INFO", f"🚀 Đã kích hoạt {started_count}/{len(conf_files)} cổng WireGuard SOCKS5 Proxy cho dàn tài khoản.")
        return {
            "status": "success",
            "active_count": started_count,
            "proxies": self.get_status()
        }

    def stop_all(self):
        """Dừng toàn bộ các tiến trình wireproxy khi tắt app"""
        for proxy_id in list(self.processes.keys()):
            self.stop_proxy(proxy_id)
        log_event("INFO", "Đã đóng tất cả cổng WireGuard Proxy an toàn.")

    def get_status(self) -> Dict[str, Any]:
        """Lấy danh sách trạng thái các địa điểm và cổng proxy đang hoạt động"""
        # Tự động dọn dẹp các proxy đã bị xoá file khỏi đĩa
        self.prune_stale_proxies()

        result = {}
        for proxy_id, meta in list(self.proxies.items()):
            is_active = self.is_port_open(meta["port"])
            result[proxy_id] = {
                **meta,
                "is_listening": is_active,
                "status": "running" if is_active else "unresponsive"
            }
        return result

    def get_proxy_for_country(self, country_or_id: str, rotate: bool = True) -> Optional[str]:
        """
        Lấy chuỗi SOCKS5 proxy URL:
        - Nếu truyền vào proxy_id cụ thể (VD: 'us_miami-us-free-3') -> trả về đúng server đó.
        - Nếu truyền vào mã quốc gia (VD: 'US'):
          + Tự động CÂN BẰNG TẢI (Round-Robin) giữa các địa điểm của quốc gia đó!
          + Account 1 -> Miami, Account 2 -> New York, Account 3 -> LA,...
        """
        target = (country_or_id or "").strip().lower()
        if not target or target == "none":
            return None

        # Tự động quét và kích hoạt nếu chưa có proxy nào nạp trong bộ nhớ
        if not self.proxies:
            self.start_all()

        # 1. Tìm theo proxy_id chính xác
        for pid, meta in self.proxies.items():
            if pid.lower() == target:
                if not self.is_port_open(meta["port"]):
                    conf_path = VPN_CONFIGS_DIR / meta.get("source_file", "")
                    if conf_path.exists():
                        self.start_proxy(conf_path)
                return meta.get("proxy_url")

        # 2. Tìm theo mã quốc gia (e.g. "US") và Cân Bằng Tải
        country_code = target.upper()
        available_pids = []
        for pid in self.country_map.get(country_code, []):
            meta = self.proxies.get(pid)
            if meta:
                if not self.is_port_open(meta["port"]):
                    conf_path = VPN_CONFIGS_DIR / meta.get("source_file", "")
                    if conf_path.exists():
                        self.start_proxy(conf_path)
                available_pids.append(pid)

        if not available_pids:
            # Fallback: tìm bất kỳ proxy nào có country khớp
            for pid, meta in self.proxies.items():
                if meta.get("country") == country_code:
                    if not self.is_port_open(meta["port"]):
                        conf_path = VPN_CONFIGS_DIR / meta.get("source_file", "")
                        if conf_path.exists():
                            self.start_proxy(conf_path)
                    available_pids.append(pid)

        if not available_pids:
            # Quét trực tiếp file trong thư mục data/vpn_configs/ nếu vừa mới thả file vào
            conf_files = list(VPN_CONFIGS_DIR.glob("*.conf"))
            for cf in conf_files:
                info = self.parse_config_info(cf)
                if info.get("country") == country_code:
                    if self.start_proxy(cf):
                        available_pids.append(info["proxy_id"])

        if not available_pids:
            return None

        if len(available_pids) == 1 or not rotate:
            return self.proxies[available_pids[0]]["proxy_url"]

        # Cân bằng tải theo số lượng profile thực tế đang dùng (Least-Loaded Balancing)
        # Đảm bảo chia đều và ưu tiên server có ít tài khoản nhất trước!
        usage_counts = {pid: 0 for pid in available_pids}
        try:
            from backend.database import get_connection
            conn = get_connection()
            c = conn.cursor()
            c.execute("SELECT raw_proxy, count(*) as cnt FROM gpm_profiles WHERE raw_proxy IS NOT NULL AND raw_proxy != '' GROUP BY raw_proxy")
            for row in c.fetchall():
                p_url = row["raw_proxy"]
                cnt = row["cnt"]
                for pid in available_pids:
                    if self.proxies[pid].get("proxy_url") == p_url:
                        usage_counts[pid] = cnt
            conn.close()
        except Exception:
            pass

        # Sắp xếp ưu tiên:
        # 1. Server có số profile đang dùng ít nhất
        # 2. Xoay vòng round-robin khi số lượng bằng nhau
        idx = self.round_robin_counters.get(country_code, 0)
        self.round_robin_counters[country_code] = idx + 1

        sorted_pids = sorted(
            available_pids,
            key=lambda pid: (usage_counts[pid], (available_pids.index(pid) + idx) % len(available_pids))
        )
        chosen_pid = sorted_pids[0]

        chosen_meta = self.proxies[chosen_pid]
        log_event("DEBUG", f"⚖️ Cân bằng tải [{country_code}]: Chọn server #{available_pids.index(chosen_pid) + 1} ({chosen_meta['label']}) [Đang gán: {usage_counts[chosen_pid]} acc] -> {chosen_meta['proxy_url']}")
        return chosen_meta["proxy_url"]

    def test_proxy(self, proxy_id_or_country: str) -> Dict[str, Any]:
        """Kiểm tra kết nối và độ trễ thực tế qua cổng proxy của địa điểm đó"""
        target = proxy_id_or_country.strip()
        port = None
        label = target

        # Tìm port từ proxy_id hoặc country
        if target in self.proxies:
            port = self.proxies[target]["port"]
            label = self.proxies[target].get("label", target)
        else:
            # Tìm proxy đầu tiên của country
            for meta in self.proxies.values():
                if meta["country"] == target.upper() and self.is_port_open(meta["port"]):
                    port = meta["port"]
                    label = meta.get("label", target)
                    break

        if not port or not self.is_port_open(port):
            return {"success": False, "error": f"Không tìm thấy cổng Proxy hoạt động cho {target}"}

        import requests
        proxies = {
            "http": f"socks5h://127.0.0.1:{port}",
            "https": f"socks5h://127.0.0.1:{port}"
        }
        start_t = time.time()
        try:
            resp = requests.get("https://api.ipify.org?format=json", proxies=proxies, timeout=6)
            latency = int((time.time() - start_t) * 1000)
            if resp.status_code == 200:
                ip_data = resp.json()
                return {
                    "success": True,
                    "ip": ip_data.get("ip"),
                    "label": label,
                    "port": port,
                    "latency_ms": latency
                }
        except Exception as e:
            return {"success": False, "error": str(e), "latency_ms": int((time.time() - start_t) * 1000)}

        return {"success": False, "error": "Không nhận được phản hồi"}

wireproxy_manager = WireproxyManager()
atexit.register(wireproxy_manager.stop_all)
