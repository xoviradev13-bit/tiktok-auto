import time
import re
from typing import Dict, Any, Optional, List
from backend.modules.browser_adapters import browser_manager
from backend.database import log_event, get_connection
from backend.logger import get_logger

logger = get_logger("proton_vpn")

# Extension ID của Proton VPN trên Chrome Web Store
PROTON_EXTENSION_ID = "jplnlbgflaimgluiddljalpebflnlhnk"

COUNTRY_MAPPING = {
    "US": {"code": "US", "name": "United States", "flag": "🇺🇸", "keywords": ["united states", "hoa kỳ", "mỹ", "us", "usa"]},
    "GB": {"code": "GB", "name": "United Kingdom", "flag": "🇬🇧", "keywords": ["united kingdom", "anh", "uk", "great britain"]},
    "DE": {"code": "DE", "name": "Germany", "flag": "🇩🇪", "keywords": ["germany", "đức", "de", "deutschland"]},
    "FR": {"code": "FR", "name": "France", "flag": "🇫🇷", "keywords": ["france", "pháp", "fr"]},
    "JP": {"code": "JP", "name": "Japan", "flag": "🇯🇵", "keywords": ["japan", "nhật bản", "nhật", "jp"]},
    "KR": {"code": "KR", "name": "South Korea", "flag": "🇰🇷", "keywords": ["south korea", "hàn quốc", "kr", "korea"]},
    "CA": {"code": "CA", "name": "Canada", "flag": "🇨🇦", "keywords": ["canada", "ca"]},
    "AU": {"code": "AU", "name": "Australia", "flag": "🇦🇺", "keywords": ["australia", "úc", "au"]},
    "SG": {"code": "SG", "name": "Singapore", "flag": "🇸🇬", "keywords": ["singapore", "sg"]},
    "NL": {"code": "NL", "name": "Netherlands", "flag": "🇳🇱", "keywords": ["netherlands", "hà lan", "nl"]},
    "MX": {"code": "MX", "name": "Mexico", "flag": "🇲🇽", "keywords": ["mexico", "mê-hi-cô", "mx"]},
    "ID": {"code": "ID", "name": "Indonesia", "flag": "🇮🇩", "keywords": ["indonesia", "indo", "id"]},
    "MY": {"code": "MY", "name": "Malaysia", "flag": "🇲🇾", "keywords": ["malaysia", "malay", "my"]},
    "PH": {"code": "PH", "name": "Philippines", "flag": "🇵🇭", "keywords": ["philippines", "philippin", "philippine", "ph"]},
}

def resolve_country_info(country_query: str) -> Dict[str, str]:
    """Tìm thông tin quốc gia chuẩn hóa từ mã hoặc tên"""
    if not country_query:
        return COUNTRY_MAPPING["US"]
    q = country_query.strip().lower()
    # Check direct code
    code_upper = country_query.strip().upper()
    if code_upper in COUNTRY_MAPPING:
        return COUNTRY_MAPPING[code_upper]
    # Check keywords
    for c_code, c_info in COUNTRY_MAPPING.items():
        if any(kw in q for kw in c_info["keywords"]):
            return c_info
    # Fallback to direct name
    return {"code": code_upper[:2], "name": country_query.strip(), "flag": "🌐", "keywords": [q]}


class ProtonVPNController:
    """
    Tự động điều khiển Extension Proton VPN trong trình duyệt GPMLogin
    để chuyển IP theo quốc gia đã chọn trong Dàn Tài Khoản.
    """

    def find_proton_extension_id(self, context) -> str:
        """Dò tìm ID extension Proton VPN trong trình duyệt hoặc dùng ID mặc định"""
        try:
            for sw in context.service_workers:
                sw_url = sw.url.lower()
                if "proton" in sw_url or "vpn" in sw_url:
                    match = re.search(r"chrome-extension://([a-z0-9]+)/", sw.url)
                    if match:
                        found_id = match.group(1)
                        logger.info(f"Đã phát hiện extension ID từ service worker: {found_id}")
                        return found_id
        except Exception:
            pass
        return PROTON_EXTENSION_ID

    def switch_country_in_extension(self, context, country_str: str) -> Dict[str, Any]:
        """
        Mở giao diện popup của Extension Proton VPN và chọn quốc gia
        """
        c_info = resolve_country_info(country_str)
        country_name = c_info["name"]
        country_flag = c_info["flag"]
        ext_id = self.find_proton_extension_id(context)

        candidate_urls = [
            f"chrome-extension://{ext_id}/popup.html",
            f"chrome-extension://{ext_id}/index.html",
            f"chrome-extension://{ext_id}/html/popup.html"
        ]

        page = None
        for test_url in candidate_urls:
            try:
                page = context.new_page()
                resp = page.goto(test_url, timeout=6000, wait_until="domcontentloaded")
                time.sleep(1.2)
                # Kiểm tra trang extension có load được không
                title = page.title()
                content = page.content()
                if "proton" in content.lower() or "vpn" in content.lower() or "connect" in content.lower():
                    logger.info(f"Đã mở giao diện Proton VPN tại {test_url}")
                    break
            except Exception as e:
                if page:
                    try:
                        page.close()
                    except Exception:
                        pass
                    page = None

        if not page:
            return {
                "success": False,
                "message": f"Không tìm thấy Extension Proton VPN trong trình duyệt (ID: {ext_id}). Vui lòng đảm bảo đã cài Extension Proton VPN vào profile GPMLogin."
            }

        try:
            # 1. Kiểm tra trạng thái đăng nhập
            content_lower = page.content().lower()
            if "sign in" in content_lower and "password" in content_lower:
                msg = "Extension Proton VPN chưa được đăng nhập trong profile này. Vui lòng mở profile và đăng nhập Proton VPN 1 lần."
                log_event("WARNING", msg)
                return {"success": False, "message": msg}

            # 2. Tìm kiếm quốc gia
            search_selectors = [
                'input[type="search"]',
                'input[placeholder*="Search" i]',
                'input[placeholder*="Tìm" i]',
                'input[data-testid*="search"]',
                '.search-input',
                'input'
            ]
            search_box = None
            for sel in search_selectors:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=1000):
                    search_box = loc
                    break

            if search_box:
                search_box.click()
                search_box.fill("")
                search_box.type(country_name, delay=40)
                time.sleep(1)

            # 3. Chọn quốc gia và bấm Kết Nối
            # Thử click vào item chứa tên quốc gia
            clicked = False
            country_selectors = [
                f'text="{country_name}"',
                f'button:has-text("{country_name}")',
                f'div:has-text("{country_name}")',
                f'[data-testid*="{country_name.lower()}"]'
            ]
            for sel in country_selectors:
                try:
                    loc = page.locator(sel).first
                    if loc.is_visible(timeout=1500):
                        loc.click()
                        clicked = True
                        time.sleep(0.8)
                        break
                except Exception:
                    continue

            # 4. Tìm và bấm nút Connect nếu có
            connect_btn_selectors = [
                'button:has-text("Connect")',
                'button:has-text("Kết nối")',
                'button:has-text("Quick Connect")',
                'button[data-testid*="connect"]',
                '.connect-button',
                'button.primary'
            ]
            for btn_sel in connect_btn_selectors:
                try:
                    btn = page.locator(btn_sel).first
                    if btn.is_visible(timeout=1500):
                        btn.click()
                        time.sleep(2)
                        break
                except Exception:
                    continue

            # 5. Chờ kết nối hoàn tất (3 giây)
            time.sleep(3)
            log_event("INFO", f"Đã thực hiện chuyển quốc gia Proton VPN sang {country_flag} {country_name}")

            return {
                "success": True,
                "country": c_info["code"],
                "country_name": country_name,
                "flag": country_flag,
                "message": f"Đã kết nối Proton VPN sang {country_flag} {country_name} thành công!"
            }

        except Exception as err:
            logger.error(f"Lỗi khi điều khiển Proton VPN: {err}")
            return {
                "success": False,
                "message": f"Lỗi điều khiển Proton VPN: {str(err)}"
            }
        finally:
            try:
                page.close()
            except Exception:
                pass

    def connect_profile_vpn(self, profile_id: str, country_str: str, keep_browser_open: bool = True) -> Dict[str, Any]:
        """
        Khởi chạy profile GPMLogin nếu chưa chạy, kết nối tới Extension Proton VPN,
        chuyển IP sang quốc gia được chỉ định.
        """
        from playwright.sync_api import sync_playwright

        adapter = browser_manager.get_active_adapter()
        if not adapter:
            return {"success": False, "message": "Không tìm thấy trình duyệt GPMLogin"}

        debug_address = adapter.start_profile(profile_id)
        if not debug_address:
            return {"success": False, "message": f"Không thể khởi động profile GPMLogin {profile_id}"}

        cdp_target = debug_address if debug_address.startswith("http") else f"http://{debug_address}"

        with sync_playwright() as p:
            try:
                browser = p.chromium.connect_over_cdp(cdp_target)
                context = browser.contexts[0] if browser.contexts else browser.new_context()

                res = self.switch_country_in_extension(context, country_str)

                if not keep_browser_open:
                    adapter.stop_profile(profile_id)

                return res
            except Exception as e:
                logger.error(f"Lỗi kết nối CDP để chuyển Proton VPN: {e}")
                return {"success": False, "message": f"Lỗi kết nối trình duyệt: {str(e)}"}

proton_vpn_controller = ProtonVPNController()
