#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
TikTok Bulk Account Creator & Login via GPMLogin Global (100% Automation)
=============================================================================
Features:
1. Reads accounts from CSV (account, password, proxy, email, email_password, 2fa_secret).
2. Auto-detects & starts GPMLogin Global API.
3. Automatically creates GPMLogin profile with full antidetect fingerprints & proxy.
4. Auto-solves TikTok Captcha (Slider Puzzle / 3D) using OMOCaptcha API.
5. Auto-fetches TikTok 2FA verification email codes via IMAP (Hotmail/Outlook/Gmail/etc.).
6. Auto-submits TOTP Authenticator 2FA codes via pyotp.
7. Logs detailed status to login_results.csv.
=============================================================================
"""

import os
import re
import sys
import csv
import time
import json
import base64
import random
import socket
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

# Ensure gpm_bulk_login directory is in sys.path
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

import requests
from playwright.sync_api import sync_playwright, Page, BrowserContext

try:
    import pyotp
except ImportError:
    pyotp = None

from omocaptcha_solver import OMOCaptchaSolver
from imap_reader import fetch_tiktok_2fa_code

# Candidate ports for GPMLogin local API
GPM_PORTS = [9495, 9496, 19995, 19996, 19994, 8848]
CONFIG_FILE = Path(__file__).resolve().parent / "config.json"


# =============================================================================
# 1. CONFIG LOADER
# =============================================================================

def load_config() -> Dict[str, Any]:
    """Loads settings from config.json if present."""
    default_config = {
        "omocaptcha_api_key": "",
        "delay_between_accounts": 3.0,
        "captcha_timeout": 120,
        "keep_open": False,
        "default_imap_host": "",
        "default_imap_port": 993
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                default_config.update(data)
        except Exception as e:
            print(f"[WARN] Failed to read config.json: {e}")
    return default_config


# =============================================================================
# 2. GPM LOGIN CONTROLLER
# =============================================================================

class GPMLoginController:
    """Manages profile creation, starting, stopping, and port discovery in GPMLogin."""

    def __init__(self, base_url: Optional[str] = None):
        self.base_url = base_url.rstrip("/") if base_url else None

    def discover_api(self) -> Optional[str]:
        """Automatically detect active GPMLogin API port and base URL."""
        if self.base_url:
            try:
                r = requests.get(f"{self.base_url}/profiles?page=1&per_page=1", timeout=1.5)
                if r.status_code == 200:
                    return self.base_url
            except Exception:
                pass

        for port in GPM_PORTS:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.settimeout(0.08)
                    if s.connect_ex(("127.0.0.1", port)) != 0:
                        continue
            except Exception:
                continue

            for ver in ["v1", "v2", "v3"]:
                candidate = f"http://127.0.0.1:{port}/api/{ver}"
                try:
                    r = requests.get(f"{candidate}/profiles?page=1&per_page=1", timeout=1.2)
                    if r.status_code == 200:
                        data = r.json()
                        if isinstance(data, dict) and data.get("success"):
                            self.base_url = candidate
                            return candidate
                except Exception:
                    continue

        return None

    def ensure_gpm_running(self) -> bool:
        """Launch GPMLogin app if it is currently closed."""
        if self.discover_api():
            return True

        candidates = [
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\GPMLoginGlobal\GPMLoginGlobal.exe"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\GPMLogin\GPMLogin.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\GPMLoginGlobal\GPMLoginGlobal.exe"),
            r"C:\Program Files\GPMLogin\GPMLogin.exe",
            r"C:\Program Files (x86)\GPMLogin\GPMLogin.exe",
            os.path.expandvars(r"%APPDATA%\GPMLogin\GPMLogin.exe"),
        ]

        exe_path = next((p for p in candidates if os.path.exists(p)), None)
        if not exe_path:
            print("[ERROR] GPMLogin executable not found in standard paths.")
            print("        Please make sure GPMLogin Global is installed and opened manually.")
            return False

        print(f"[INFO] GPMLogin is not running. Launching: {exe_path} ...")
        try:
            subprocess.Popen([exe_path], shell=False)
            for attempt in range(1, 31):
                time.sleep(1)
                api = self.discover_api()
                if api:
                    print(f"[INFO] GPMLogin API is ready at {api} (after {attempt}s)!")
                    return True
        except Exception as e:
            print(f"[ERROR] Failed to start GPMLogin: {e}")

        return False

    def get_existing_profiles(self) -> List[Dict[str, Any]]:
        """Fetch all existing profiles from GPMLogin."""
        base = self.discover_api()
        if not base:
            return []
        try:
            r = requests.get(f"{base}/profiles?page=1&per_page=300", timeout=8)
            if r.status_code == 200:
                json_data = r.json()
                data_field = json_data.get("data", {})
                if isinstance(data_field, dict):
                    return data_field.get("data", [])
                elif isinstance(data_field, list):
                    return data_field
        except Exception as e:
            print(f"[WARN] Error fetching GPM profiles: {e}")
        return []

    def find_profile_for_account(self, account: str) -> Optional[Dict[str, Any]]:
        """
        Intelligently finds an existing profile for the given account:
        Matches:
        - "TikTok_<account>"
        - "<account>"
        - name contains account
        - note contains account
        """
        profiles = self.get_existing_profiles()
        acc_clean = account.strip().lower()
        acc_user = acc_clean.split("@")[0] if "@" in acc_clean else acc_clean

        for p in profiles:
            p_name = p.get("name", "").strip().lower()
            p_note = p.get("note", "").strip().lower()

            # Exact or prefixed matches
            if p_name in [f"tiktok_{acc_clean}", acc_clean, f"tiktok - {acc_clean}"]:
                return p
            if acc_user and p_name in [f"tiktok_{acc_user}", acc_user, f"tiktok - {acc_user}"]:
                return p
            # Substring match if account name is distinctive (length >= 4)
            if len(acc_clean) >= 4 and (acc_clean in p_name or acc_clean in p_note):
                return p
            if len(acc_user) >= 4 and (acc_user in p_name or acc_user in p_note):
                return p

        return None

    def find_profile_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Find an existing profile by exact name."""
        profiles = self.get_existing_profiles()
        for p in profiles:
            if p.get("name", "").strip().lower() == name.strip().lower():
                return p
        return None

    def create_profile(self, profile_name: str, raw_proxy: str = "", note: str = "") -> Optional[str]:
        """
        Create a new browser profile in GPMLogin.
        Returns profile_id if successful, None otherwise.
        """
        base = self.discover_api()
        if not base:
            return None

        payload: Dict[str, Any] = {
            "name": profile_name,
            "raw_proxy": raw_proxy.strip() if raw_proxy else "",
            "note": note or f"Created by TikTok Bulk Login at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        }

        try:
            r = requests.post(f"{base}/profiles/create", json=payload, timeout=15)
            if r.status_code == 200:
                data = r.json()
                if data.get("success"):
                    pid = data.get("data", {}).get("id")
                    if pid:
                        return pid
                print(f"[WARN] GPMLogin create profile error: {data.get('message')}")
            else:
                print(f"[WARN] GPMLogin create profile HTTP {r.status_code}: {r.text}")
        except Exception as e:
            print(f"[ERROR] Exception creating GPM profile: {e}")

        return None

    def start_profile(self, profile_id: str) -> Optional[str]:
        """
        Start profile in GPMLogin and return WebSocket or CDP debugging address.
        """
        base = self.discover_api()
        if not base:
            return None

        url = f"{base}/profiles/start/{profile_id}?skip_proxy_check=true"
        try:
            r = requests.get(url, timeout=35)
            if r.status_code == 200:
                res = r.json()
                if not res.get("success"):
                    if "inuse" in str(res.get("message", "")).lower():
                        print(f"[INFO] Profile {profile_id} already in use. Closing and restarting...")
                        self.stop_profile(profile_id)
                        time.sleep(2)
                        r = requests.get(url, timeout=35)
                        res = r.json()

                if res.get("success"):
                    data = res.get("data", {})
                    ws_url = data.get("websocket_debugging_url")
                    if ws_url:
                        return ws_url

                    port = data.get("remote_debugging_port") or data.get("debug_port")
                    if port:
                        return f"127.0.0.1:{port}"

                    addr = data.get("remote_debugging_address") or data.get("debugger_address")
                    if addr:
                        return str(addr)

                print(f"[ERROR] Failed to start profile: {res.get('message')}")
        except Exception as e:
            print(f"[ERROR] Exception starting GPM profile {profile_id}: {e}")

        return None

    def stop_profile(self, profile_id: str) -> bool:
        """Close/Stop a running GPM profile."""
        base = self.discover_api()
        if not base:
            return False

        for endpoint in [f"{base}/profiles/close/{profile_id}", f"{base}/profiles/stop/{profile_id}"]:
            try:
                r = requests.get(endpoint, timeout=8)
                if r.status_code == 200 and r.json().get("success"):
                    return True
            except Exception:
                pass
        return False


# =============================================================================
# 3. CSV PARSER (FULL FORMAT SUPPORT)
# =============================================================================

class AccountRecord:
    def __init__(
        self,
        account: str,
        password: str,
        proxy: str = "",
        email_addr: str = "",
        email_password: str = "",
        totp_secret: str = "",
        profile_name: str = ""
    ):
        self.account = account.strip()
        self.password = password.strip()
        self.proxy = proxy.strip()
        self.email_addr = email_addr.strip() if email_addr else (account.strip() if "@" in account else "")
        self.email_password = email_password.strip()
        self.totp_secret = totp_secret.strip()
        self.profile_name = profile_name.strip()

    def __repr__(self):
        return f"<Account: {self.account} | Profile: {self.profile_name or 'Auto'} | Email2FA: {'Yes' if self.email_password else 'No'}>"


def parse_accounts_csv(file_path: str) -> List[AccountRecord]:
    """
    Parses CSV/TXT files supporting multiple formats:
    Columns recognized:
    - account, password, proxy, email, email_password, 2fa_secret
    Delimiters supported: comma ',', pipe '|', semicolon ';', tab '\t', colon ':'
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    with open(file_path, "r", encoding="utf-8-sig", errors="replace") as f:
        lines = [line.strip() for line in f if line.strip()]

    if not lines:
        return []

    # Detect delimiter
    sample = lines[0]
    delimiter = ","
    for d in ["|", ",", ";", "\t"]:
        if d in sample:
            delimiter = d
            break

    records: List[AccountRecord] = []
    reader = csv.reader(lines, delimiter=delimiter)
    all_rows = list(reader)

    if not all_rows:
        return []

    # Column index detection
    first_row = [c.strip().lower() for c in all_rows[0]]
    has_header = False
    acc_idx = -1
    pwd_idx = -1
    prx_idx = -1
    mail_idx = -1
    mailpwd_idx = -1
    totp_idx = -1
    prof_idx = -1

    for i, col in enumerate(first_row):
        if col in ["account", "username", "user", "uid", "login", "tai_khoan"]:
            acc_idx = i
            has_header = True
        elif col in ["password", "pass", "pwd", "mat_khau"]:
            pwd_idx = i
            has_header = True
        elif col in ["proxy", "ip", "raw_proxy"]:
            prx_idx = i
        elif col in ["email", "mail", "email_account"]:
            mail_idx = i
            has_header = True
        elif col in ["email_password", "mail_password", "email_pass", "mail_pass", "pass_mail", "mat_khau_mail"]:
            mailpwd_idx = i
            has_header = True
        elif col in ["2fa", "2fa_secret", "totp", "secret", "authenticator", "key_2fa"]:
            totp_idx = i
        elif col in ["profile", "profile_name", "gpm_profile", "profile_id"]:
            prof_idx = i
            has_header = True

    start_row = 1 if has_header else 0

    if not has_header:
        # Defaults for headerless CSVs
        acc_idx = 0
        pwd_idx = 1

    for row in all_rows[start_row:]:
        if not row:
            continue
        row = [c.strip() for c in row]
        if len(row) <= acc_idx or not row[acc_idx]:
            continue

        acc = row[acc_idx]
        pwd = row[pwd_idx] if pwd_idx != -1 and len(row) > pwd_idx else ""
        prx = row[prx_idx] if prx_idx != -1 and len(row) > prx_idx else ""
        mail = row[mail_idx] if mail_idx != -1 and len(row) > mail_idx else ""
        mailpwd = row[mailpwd_idx] if mailpwd_idx != -1 and len(row) > mailpwd_idx else ""
        totp = row[totp_idx] if totp_idx != -1 and len(row) > totp_idx else ""
        prof = row[prof_idx] if prof_idx != -1 and len(row) > prof_idx else ""

        # Positional heuristics if no header:
        if not has_header:
            if len(row) == 3:
                # user|pass|mailpass (where user is email) OR user|pass|proxy
                if "@" in acc and not any(k in row[2] for k in ["http", ":8", ":9", ":10"]):
                    mailpwd = row[2]
                elif any(k in row[2] for k in ["http://", "socks5://"]) or ":" in row[2]:
                    prx = row[2]
            elif len(row) == 4:
                # user|pass|email|email_password OR user|pass|proxy|email_password
                if "@" in row[2]:
                    mail = row[2]
                    mailpwd = row[3]
                elif any(k in row[2] for k in ["http://", ":"]):
                    prx = row[2]
                    mailpwd = row[3]
            elif len(row) >= 5:
                # user|pass|proxy|email|email_password
                prx = row[2]
                mail = row[3]
                mailpwd = row[4]

        if acc and pwd:
            records.append(AccountRecord(acc, pwd, prx, mail, mailpwd, totp, prof))

    return records


# =============================================================================
# 4. TIKTOK AUTOMATION & AUTO SOLVER WORKFLOW
# =============================================================================

def human_type(page: Page, selector: str, text: str, min_delay_ms: int = 35, max_delay_ms: int = 110):
    """Type characters with human-like randomized delays."""
    element = page.locator(selector).first
    element.click()
    time.sleep(random.uniform(0.15, 0.35))
    for char in text:
        element.type(char, delay=random.randint(min_delay_ms, max_delay_ms))
    time.sleep(random.uniform(0.2, 0.4))


def dismiss_common_overlays(page: Page):
    """Dismiss cookie banners, passkey modals, and onboarding overlays."""
    # 1. Cookie consent
    try:
        cookie_btns = [
            'button:has-text("Accept all")',
            'button:has-text("Chấp nhận tất cả")',
            'button:has-text("Allow all")',
            'button:has-text("Cho phép tất cả")',
            'button[id*="cookie-accept"]'
        ]
        for sel in cookie_btns:
            btn = page.locator(sel).first
            if btn.is_visible(timeout=400):
                btn.click()
                time.sleep(0.4)
                break
    except Exception:
        pass

    # 2. Passkey modal ("Tạo passkey để đăng nhập dễ dàng hơn" / "Create a passkey")
    try:
        passkey_modal = page.locator('div[role="dialog"]:has-text("passkey"), div[role="dialog"]:has-text("Passkey")').first
        if passkey_modal.is_visible(timeout=400):
            btn_later = passkey_modal.locator('button:has-text("Để sau"), button:has-text("Maybe later"), button:has-text("Not now"), button:has-text("Không phải bây giờ")').first
            if btn_later.is_visible(timeout=400):
                print("[INFO] Dismissing Passkey modal...")
                btn_later.click()
                time.sleep(0.4)
    except Exception:
        pass

    # 3. Any floating "Maybe later" buttons
    try:
        btn_later_gen = page.locator('button:has-text("Để sau"), button:has-text("Maybe later")').first
        if btn_later_gen.is_visible(timeout=400):
            btn_later_gen.click()
            time.sleep(0.3)
    except Exception:
        pass


def check_is_logged_in(context: BrowserContext, page: Page) -> bool:
    """Check if TikTok is logged in (sessionid cookie, avatar element, or non-login URL)."""
    try:
        cookies = context.cookies(["https://www.tiktok.com"])
        for c in cookies:
            if c.get("name") in ["sessionid", "sessionid_ss", "sid_tt"]:
                if c.get("value"):
                    return True
    except Exception:
        pass

    try:
        current_url = page.url.lower()
        if "/login" not in current_url and "/signup" not in current_url:
            avatar = page.locator('header a[href*="/upload"], [data-e2e="profile-icon"], div.avatar-wrapper').first
            if avatar.is_visible(timeout=800):
                return True
    except Exception:
        pass

    return False


def check_form_error(page: Page) -> Optional[Tuple[str, str]]:
    """
    Detects immediate form validation, rate limits, bans, or login errors on TikTok.
    Returns (error_category, error_text) or None.
    Categories: RATE_LIMITED, WRONG_PASSWORD, BANNED, GENERAL_ERROR
    """
    try:
        res = page.evaluate("""
            () => {
                const patterns = [
                    // Rate limit / Too frequent attempts
                    { cat: "RATE_LIMITED", kws: ["quá thường xuyên", "too frequently", "visiting our service too frequently", "too many attempts", "quá nhiều lần thử", "thử lại sau", "try again later"] },
                    // Banned / Suspended
                    { cat: "BANNED", kws: ["account suspended", "permanently banned", "bị đình chỉ", "tài khoản bị khóa", "cấm tạm thời", "tạm khóa", "temporarily blocked", "temporarily locked"] },
                    // Wrong credentials
                    { cat: "WRONG_PASSWORD", kws: ["doesn't match our records", "does not match", "incorrect account or password", "incorrect", "không khớp", "không chính xác", "sai tài khoản", "sai mật khẩu", "sai thông tin"] },
                    // Non-existent account
                    { cat: "ACCOUNT_NOT_FOUND", kws: ["doesn't exist", "does not exist", "account doesn", "không tồn tại", "tài khoản không tồn tại", "could not find your account", "không tìm thấy tài khoản"] }
                ];

                const candidates = document.querySelectorAll('span, div, p, [role="alert"], .tiktok-input-tip');
                for (const el of candidates) {
                    if (el.children.length === 0) {
                        const txt = (el.innerText || '').trim();
                        const lower = txt.toLowerCase().replace(/[\u2018\u2019]/g, "'");
                        if (txt.length > 3 && txt.length < 250) {
                            for (const p of patterns) {
                                for (const kw of p.kws) {
                                    if (lower.includes(kw)) {
                                        return { category: p.cat, text: txt };
                                    }
                                }
                            }
                        }
                    }
                }
                return null;
            }
        """)
        if res and isinstance(res, dict):
            return res.get("category", "GENERAL_ERROR"), res.get("text", "")
    except Exception:
        pass
    return None


def is_captcha_displayed(page: Page) -> bool:
    """Check if TikTok's anti-bot slider puzzle or verification is shown."""
    try:
        return page.evaluate("""
            () => {
                const el = document.querySelector("#captcha-verify-image") ||
                           document.querySelector(".secsdk-captcha-drag-wrapper") ||
                           document.querySelector("[data-e2e='secsdk-captcha']") ||
                           document.querySelector(".captcha_verify_container") ||
                           document.querySelector(".captcha-disable-select");
                if (el) return true;
                const txt = document.body ? document.body.innerText.toLowerCase() : "";
                return txt.includes("slide to complete the puzzle") ||
                       txt.includes("trượt để hoàn thành") ||
                       txt.includes("verify to continue") ||
                       txt.includes("xác minh để tiếp tục");
            }
        """)
    except Exception:
        return False


def auto_solve_tiktok_captcha_omocaptcha(page: Page, solver: OMOCaptchaSolver) -> bool:
    """
    Automatically captures TikTok slider puzzle image, calls OMOCaptcha API,
    and performs human-like drag in Playwright.
    """
    try:
        print("[CAPTCHA] Detecting captcha elements on page...")
        captcha_img_el = page.locator('#captcha-verify-image, .captcha_verify_img_slide, img[src*="captcha"]').first
        if not captcha_img_el.is_visible(timeout=3000):
            captcha_img_el = page.locator('.captcha_verify_container, .secsdk-captcha-drag-wrapper').first

        if not captcha_img_el.is_visible(timeout=2000):
            print("[CAPTCHA] Could not locate captcha image element.")
            return False

        # Capture element screenshot as base64
        screenshot_bytes = captcha_img_el.screenshot()
        b64_image = base64.b64encode(screenshot_bytes).decode("utf-8")

        # Call OMOCaptcha solver
        print("[OMOCaptcha] Sending captcha image to OMOCaptcha API...")
        raw_x = solver.solve_tiktok_slider(b64_image)
        if raw_x is None:
            print("[OMOCaptcha] Solver did not return valid result.")
            return False

        # Locate drag button and track
        drag_btn = page.locator(
            '.secsdk-captcha-drag-icon, div.secsdk_captcha_drag_icon, '
            '.secsdk-captcha-drag-wrapper .drag-button, .captcha-slider-btn'
        ).first

        if not drag_btn.is_visible(timeout=2000):
            drag_btn = page.locator('.secsdk-captcha-drag-wrapper').first

        btn_box = drag_btn.bounding_box()
        img_box = captcha_img_el.bounding_box()
        if not btn_box:
            print("[CAPTCHA] Could not get bounding box of drag button.")
            return False

        # Compute track width for ratio conversion (according to omocaptcha docs: 0.0 to 1.0 ratio)
        track_width = (img_box["width"] if img_box else 340.0) - btn_box["width"]
        if 0.0 < raw_x <= 1.0:
            distance_x = int(round(raw_x * track_width))
            print(f"[OMOCaptcha] Solution ratio: {raw_x} -> Converted distance: {distance_x}px (Track: {track_width:.1f}px)")
        else:
            distance_x = int(round(raw_x))
            print(f"[OMOCaptcha] Solution pixel offset: {distance_x}px")

        start_x = btn_box["x"] + btn_box["width"] / 2
        start_y = btn_box["y"] + btn_box["height"] / 2

        print(f"[CAPTCHA] Dragging puzzle slider from ({start_x:.1f}, {start_y:.1f}) by +{distance_x}px ...")
        page.mouse.move(start_x, start_y)
        time.sleep(0.1)
        page.mouse.down()
        time.sleep(0.08)

        # Humanized cubic ease-out curve with micro-jitter
        steps = random.randint(22, 30)
        for i in range(1, steps + 1):
            t = i / steps
            ease = 1 - pow(1 - t, 3)
            current_x = start_x + (distance_x * ease)
            jitter_y = start_y + random.uniform(-1.2, 1.2)
            page.mouse.move(current_x, jitter_y)
            time.sleep(random.uniform(0.012, 0.028))

        time.sleep(random.uniform(0.15, 0.3))
        page.mouse.up()
        time.sleep(2.5)

        # Check if captcha container disappeared
        if not is_captcha_displayed(page):
            print("[CAPTCHA] ✅ Captcha solved successfully by OMOCaptcha!")
            return True
        else:
            print("[CAPTCHA] Captcha still present after drag (offset slightly off or refreshed).")
            return False

    except Exception as e:
        print(f"[CAPTCHA] Exception during auto-solve: {e}")
        return False


def is_2fa_or_verification_checkpoint(page: Page) -> bool:
    """Checks if TikTok is asking for 2FA, identity verification, or code entry."""
    try:
        return page.evaluate("""
            () => {
                const txt = document.body ? document.body.innerText.toLowerCase() : "";
                if (txt.includes("verify it's really you") ||
                    txt.includes("verify it’s really you") ||
                    txt.includes("verify your identity") ||
                    txt.includes("verify identity") ||
                    txt.includes("xác minh danh tính") ||
                    txt.includes("xác nhận đó là bạn") ||
                    txt.includes("chọn phương thức xác minh") ||
                    txt.includes("enter 6-digit code") ||
                    txt.includes("nhập mã gồm 6 chữ số") ||
                    txt.includes("resend code") ||
                    txt.includes("gửi lại mã") ||
                    txt.includes("two-step verification") ||
                    txt.includes("xác minh 2 bước")) {
                    return true;
                }
                const input = document.querySelector('input[placeholder*="6-digit"]') ||
                              document.querySelector('input[placeholder*="code"]') ||
                              document.querySelector('input[maxlength="6"]') ||
                              document.querySelector('input[type="tel"]');
                return !!input;
            }
        """)
    except Exception:
        return False


def handle_2fa_verification(
    page: Page,
    account: AccountRecord,
    custom_imap_host: str = "",
    custom_imap_port: int = 993,
    max_wait: int = 70
) -> bool:
    """
    100% Automated 2FA / Identity Verification:
    Stage 1: If on 'Verify it's really you' screen -> automatically select Email (or Authenticator app)
             and click 'Send code' if needed.
    Stage 2: Locate 6-digit code input (single input or 6 split inputs).
    Stage 3:
      - If TOTP secret -> auto-generate with pyotp
      - If email password -> auto-fetch via IMAP SSL (Hotmail, Gmail, etc.)
      - Type code & submit.
    Stage 4: Fallback to waiting for manual code entry in browser.
    """
    print("\n[SECURITY] 2FA / Identity Verification checkpoint detected!")

    # Stage 1: Check if on method selection screen ("Verify it's really you")
    try:
        is_selection = page.evaluate("""
            () => {
                const txt = document.body ? document.body.innerText.toLowerCase() : "";
                return (txt.includes("verify it's really you") ||
                        txt.includes("verify it’s really you") ||
                        txt.includes("verify your identity") ||
                        txt.includes("xác minh danh tính") ||
                        txt.includes("xác nhận đó là bạn") ||
                        txt.includes("chọn phương thức"));
            }
        """)
        if is_selection:
            print("[2FA] On 'Verify it's really you' method selection screen.")
            time.sleep(1)

            # Choose Authenticator if TOTP secret is configured
            selected = False
            if account.totp_secret and pyotp:
                auth_opt = page.locator('div, li, button, [role="button"]').filter(
                    has_text=re.compile(r"Authenticator|Xác thực", re.IGNORECASE)
                ).first
                if auth_opt.is_visible(timeout=1500):
                    print("[2FA] Selecting 'Authenticator app' method...")
                    auth_opt.click()
                    selected = True
                    time.sleep(1.5)

            # Otherwise select Email method
            if not selected:
                # 1. Direct Playwright text click (reliable & coordinates-based)
                email_opt = page.locator('text="Email"').first
                if email_opt.is_visible(timeout=2000):
                    print(f"[2FA] Selecting 'Email' verification method for {account.account}...")
                    email_opt.click()
                    time.sleep(2)
                else:
                    # Fallback locator
                    email_opt = page.locator('div, li, button, [role="button"]').filter(
                        has_text=re.compile(r"Email|Thư điện tử|c\*\*\*p@", re.IGNORECASE)
                    ).first
                    if email_opt.is_visible(timeout=1500):
                        print(f"[2FA] Selecting 'Email' verification method (filter)...")
                        email_opt.click()
                        time.sleep(2)

            # Check if there is an active (enabled) "Send code" button (ignore disabled "Resend code (59s)")
            send_code_btn = page.locator(
                'button:has-text("Send code"), button:has-text("Gửi mã"), '
                'div[role="button"]:has-text("Send code"), div[role="button"]:has-text("Gửi mã")'
            ).first
            if send_code_btn.is_visible(timeout=1000):
                try:
                    btn_text = (send_code_btn.inner_text() or "").lower()
                    if "resend" not in btn_text and "gửi lại" not in btn_text and send_code_btn.is_enabled():
                        print("[2FA] Clicking 'Send code' button to request 6-digit code...")
                        send_code_btn.click(timeout=2000)
                        time.sleep(2)
                    else:
                        print(f"[2FA] Code already sent automatically ({btn_text}).")
                except Exception:
                    pass

    except Exception as e:
        print(f"[2FA] Note during method selection: {e}")

    # Stage 2: Helper to enter 6-digit code into input(s)
    def _enter_code_and_submit(code_str: str) -> bool:
        try:
            # Check single code input
            code_input = None
            for c in page.locator(
                'input[placeholder*="6-digit"], input[placeholder*="6 chữ số"], input[placeholder*="code"], '
                'input[placeholder*="mã"], input[maxlength="6"], input[type="tel"]'
            ).all():
                if c.is_visible():
                    code_input = c
                    break

            split_inputs = [inp for inp in page.locator('input[maxlength="1"]').all() if inp.is_visible()]

            if code_input and code_input.is_visible():
                code_input.click()
                time.sleep(0.2)
                code_input.fill(code_str)
            elif len(split_inputs) == 6:
                for idx, ch in enumerate(code_str):
                    split_inputs[idx].fill(ch)
                    time.sleep(0.1)
            else:
                first_inp = page.locator('input[type="text"], input[type="tel"], input').last
                if first_inp.is_visible():
                    first_inp.click()
                    page.keyboard.type(code_str)

            time.sleep(1)
            btn_verify = page.locator(
                'button:has-text("Next"), button:has-text("Tiếp tục"), button:has-text("Verify"), '
                'button:has-text("Xác minh"), button:has-text("Done"), button[type="submit"]'
            ).first
            if btn_verify.is_visible(timeout=1500):
                btn_verify.click()
            time.sleep(3)
            return True
        except Exception as ex:
            print(f"[2FA] Error entering code: {ex}")
            return False

    # Stage 3A: TOTP Authenticator
    if account.totp_secret and pyotp:
        try:
            totp = pyotp.TOTP(account.totp_secret.replace(" ", "").upper())
            generated_code = totp.now()
            print(f"[2FA] Auto-generated Authenticator code: {generated_code}")
            if _enter_code_and_submit(generated_code):
                return True
        except Exception as e:
            print(f"[2FA] Failed to auto-generate TOTP: {e}")

    # Stage 3B: IMAP Email 2FA Auto-Reader
    if account.email_password:
        target_email = account.email_addr or account.account
        print(f"[2FA] Connecting to IMAP to fetch 6-digit code for {target_email} ...")
        code = fetch_tiktok_2fa_code(
            email_addr=target_email,
            email_pwd=account.email_password,
            custom_imap_host=custom_imap_host or None,
            custom_imap_port=custom_imap_port,
            max_wait_seconds=max_wait
        )
        if code:
            print(f"[2FA] ✅ Auto-filling verification code: {code}")
            if _enter_code_and_submit(code):
                return True

    # Stage 4: Fallback to manual wait
    print(f"👉 Please enter the 2FA code in the opened browser (Waiting up to {max_wait}s)...")
    start_wait = time.time()
    while time.time() - start_wait < max_wait:
        if check_is_logged_in(page.context, page):
            print("[2FA] Verified successfully in browser!")
            return True
        time.sleep(2)

    return False


def login_single_account(
    gpm: GPMLoginController,
    account: AccountRecord,
    omocaptcha_solver: Optional[OMOCaptchaSolver] = None,
    custom_imap_host: str = "",
    custom_imap_port: int = 993,
    captcha_timeout: int = 120,
    keep_open: bool = False
) -> Tuple[bool, str, str]:
    """
    Full 100% automated workflow for one TikTok account.
    Returns (success: bool, profile_id: str, message: str)
    """
    profile_name = f"TikTok_{account.account}"
    print(f"\n=======================================================")
    print(f"[*] Processing Account: {account.account}")
    print(f"    Proxy: {account.proxy if account.proxy else 'Direct'}")
    print(f"    Email 2FA: {'Configured' if account.email_password else 'Manual/None'}")
    print(f"    OMOCaptcha: {'Active' if omocaptcha_solver else 'Manual Fallback'}")
    print(f"=======================================================")

    # 1. Create or Find Profile in GPM (Prevent duplicate profiles)
    existing = None
    if account.profile_name:
        existing = gpm.find_profile_by_name(account.profile_name)
        if not existing:
            for p in gpm.get_existing_profiles():
                if account.profile_name.lower() in p.get("name", "").lower() or account.profile_name == p.get("id"):
                    existing = p
                    break

    if not existing:
        existing = gpm.find_profile_for_account(account.account)

    if existing:
        profile_id = existing.get("id") or existing.get("profile_id")
        existing_name = existing.get("name", profile_name)
        print(f"[INFO] Using GPM profile '{existing_name}' (ID: {profile_id}) to prevent duplicate!")
    else:
        print(f"[INFO] No existing profile found. Creating new GPM profile: '{profile_name}' ...")
        profile_id = gpm.create_profile(profile_name, raw_proxy=account.proxy)
        if not profile_id:
            return False, "", "Failed to create profile in GPMLogin"
        print(f"[SUCCESS] Profile created! ID: {profile_id}")

    # 2. Start Profile in GPM
    print(f"[INFO] Launching profile {profile_id} via GPMLogin API...")
    debug_target = gpm.start_profile(profile_id)
    if not debug_target:
        return False, profile_id, "Failed to start browser profile"

    print(f"[INFO] Browser started! Debug target: {debug_target}")

    success = False
    message = "Unknown error"

    try:
        with sync_playwright() as p:
            cdp_url = debug_target if debug_target.startswith("ws://") else f"http://{debug_target}"
            print(f"[INFO] Connecting Playwright CDP...")
            browser = None
            for attempt in range(1, 6):
                try:
                    browser = p.chromium.connect_over_cdp(cdp_url)
                    break
                except Exception as e:
                    if attempt == 5:
                        raise e
                    time.sleep(1.5)

            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(30000)

            # Check if already logged in
            print("[INFO] Checking if already logged in to TikTok...")
            page.goto("https://www.tiktok.com/", wait_until="domcontentloaded")
            time.sleep(2)
            dismiss_common_overlays(page)

            if check_is_logged_in(context, page):
                print(f"[SUCCESS] Profile is ALREADY logged in to TikTok!")
                success = True
                message = "Already logged in"
                browser.close()
                if not keep_open:
                    gpm.stop_profile(profile_id)
                return success, profile_id, message

            # Navigate to TikTok Login Page
            print("[INFO] Navigating to TikTok email/username login page...")
            page.goto("https://www.tiktok.com/login/phone-or-email/email", wait_until="domcontentloaded")
            time.sleep(2.5)
            dismiss_common_overlays(page)

            # Switch to 'Log in with email or username' if currently on phone tab
            try:
                switch_to_email = page.locator('a[href*="/login/phone-or-email/email"], a:has-text("Log in with email or username"), a:has-text("Đăng nhập bằng email")').first
                if switch_to_email.is_visible(timeout=1000):
                    switch_to_email.click()
                    time.sleep(1)
            except Exception:
                pass

            # Find Username input
            username_input = page.locator('input[name="username"], input[placeholder*="Email or username"], input[placeholder*="TikTok ID"]').first
            if not username_input.is_visible(timeout=5000):
                username_input = page.locator('input[type="text"]').first

            if not username_input.is_visible(timeout=5000):
                browser.close()
                if not keep_open:
                    gpm.stop_profile(profile_id)
                return False, profile_id, "Could not locate username input field"

            # Find Password input
            password_input = page.locator('input[type="password"]').first
            if not password_input.is_visible(timeout=5000):
                browser.close()
                if not keep_open:
                    gpm.stop_profile(profile_id)
                return False, profile_id, "Could not locate password input field"

            # Type credentials like a human
            print(f"[INFO] Entering username: {account.account}")
            human_type(page, 'input[name="username"], input[type="text"]', account.account)

            print("[INFO] Entering password: ••••••••")
            human_type(page, 'input[type="password"]', account.password)

            # Submit
            submit_btn = page.locator(
                'button[type="submit"], button:has-text("Log in"), button:has-text("Đăng nhập"), '
                'button:has-text("Tiếp tục"), button:has-text("Continue")'
            ).first

            # Check if an error/rate-limit is already displayed before clicking
            pre_err = check_form_error(page)
            if pre_err:
                category, err_text = pre_err
                print(f"\n[ERROR] ❌ TikTok {category} detected on page: '{err_text}'")
                browser.close()
                if not keep_open:
                    gpm.stop_profile(profile_id)
                return False, profile_id, f"[{category}] {err_text}"

            print("[INFO] Clicking 'Log in / Tiếp tục' button...")
            time.sleep(0.5)
            try:
                submit_btn.click(timeout=3000)
            except Exception:
                post_err = check_form_error(page)
                if post_err:
                    category, err_text = post_err
                    print(f"\n[ERROR] ❌ TikTok {category} (Submit blocked): '{err_text}'")
                    browser.close()
                    if not keep_open:
                        gpm.stop_profile(profile_id)
                    return False, profile_id, f"[{category}] {err_text}"
                submit_btn.click(force=True, timeout=2000)

            time.sleep(2.5)

            # Monitoring loop (Captcha, 2FA, Errors, Success)
            print("[INFO] Monitoring login response...")
            start_monitor = time.time()
            captcha_attempts = 0

            while time.time() - start_monitor < captcha_timeout:
                dismiss_common_overlays(page)

                # 1. Success check
                if check_is_logged_in(context, page):
                    print(f"\n[SUCCESS] Successfully logged in to TikTok for {account.account}!")
                    success = True
                    message = "Login successful"
                    break

                # 2. Captcha check
                if is_captcha_displayed(page):
                    if omocaptcha_solver and captcha_attempts < 3:
                        captcha_attempts += 1
                        print(f"\n[CAPTCHA] Attempt {captcha_attempts}/3: Auto-solving with OMOCaptcha...")
                        solved = auto_solve_tiktok_captcha_omocaptcha(page, omocaptcha_solver)
                        if solved:
                            time.sleep(2)
                            continue
                    else:
                        print(f"\n⚠️  CAPTCHA ACTIVE! Please slide puzzle in browser (Timeout: {captcha_timeout}s)...")
                    time.sleep(2.5)
                    continue

                # 3. 2FA Checkpoint check (both method selection & code input)
                if is_2fa_or_verification_checkpoint(page):
                    handled = handle_2fa_verification(
                        page=page,
                        account=account,
                        custom_imap_host=custom_imap_host,
                        custom_imap_port=custom_imap_port,
                        max_wait=captcha_timeout
                    )
                    if handled:
                        time.sleep(2)
                        if check_is_logged_in(context, page):
                            success = True
                            message = "Login successful with 2FA"
                            break

                # 4. Immediate form error check (Rate limit, Banned, Wrong password, etc.)
                err_info = check_form_error(page)
                if err_info:
                    category, err_text = err_info
                    print(f"\n[ERROR] ❌ TikTok {category}: '{err_text}'")
                    message = f"[{category}] {err_text}"
                    break

                time.sleep(2)

            if not success and message == "Unknown error":
                message = "Login timed out"

            browser.close()

    except Exception as e:
        print(f"[ERROR] Exception during browser automation: {e}")
        message = str(e)

    finally:
        if not keep_open:
            print(f"[INFO] Closing browser profile {profile_id}...")
            gpm.stop_profile(profile_id)
        else:
            print(f"[INFO] Leaving browser profile {profile_id} open (--keep-open flag set).")

    return success, profile_id, message


# =============================================================================
# 5. MAIN ENTRY POINT
# =============================================================================

def prompt_for_csv_file() -> Optional[str]:
    """Open a GUI file picker dialog or prompt in terminal."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        file_path = filedialog.askopenfilename(
            title="Select Accounts CSV File",
            filetypes=[("CSV and Text Files", "*.csv;*.txt"), ("All Files", "*.*")]
        )
        root.destroy()
        if file_path:
            return file_path
    except Exception:
        pass

    print("\nCould not open graphical file picker. Please enter path to your CSV file:")
    user_input = input("File path: ").strip().strip('"\'')
    if os.path.exists(user_input):
        return user_input
    return None


def main():
    cfg = load_config()

    parser = argparse.ArgumentParser(description="Bulk create profiles in GPMLogin and log in TikTok accounts.")
    parser.add_argument("csv_file", nargs="?", default=None, help="Path to CSV file with accounts")
    parser.add_argument("--omocaptcha-key", default=cfg.get("omocaptcha_api_key", ""), help="OMOCaptcha API key")
    parser.add_argument("--delay", type=float, default=cfg.get("delay_between_accounts", 3.0), help="Delay between accounts")
    parser.add_argument("--timeout", type=int, default=cfg.get("captcha_timeout", 120), help="Timeout for Captcha / 2FA")
    parser.add_argument("--keep-open", action="store_true", default=cfg.get("keep_open", False), help="Keep browser open")
    parser.add_argument("--results", default="login_results.csv", help="Output results CSV")

    args = parser.parse_args()

    print("=" * 65)
    print("   TIKTOK BULK LOGIN (GPMLogin Global + OMOCaptcha + IMAP 2FA)   ")
    print("=" * 65)

    # 1. Initialize OMOCaptcha Solver if key available
    omocaptcha_key = args.omocaptcha_key or os.environ.get("OMOCAPTCHA_API_KEY", "")
    solver = None
    if omocaptcha_key:
        solver = OMOCaptchaSolver(omocaptcha_key)
        balance = solver.get_balance()
        if balance is not None:
            print(f"[OMOCaptcha] Connected successfully! Account balance: {balance} VND")
        else:
            print("[OMOCaptcha] Key provided. Ready for automated captcha solving.")
    else:
        print("[OMOCaptcha] No API key provided in config.json or --omocaptcha-key.")
        print("             Will fall back to manual slider alert if captcha appears.")

    # 2. Resolve CSV File
    csv_path = args.csv_file
    if not csv_path or not os.path.exists(csv_path):
        csv_path = prompt_for_csv_file()

    if not csv_path or not os.path.exists(csv_path):
        print("[ERROR] No valid CSV file selected. Exiting.")
        sys.exit(1)

    print(f"\n[INFO] Loading accounts from: {csv_path}")
    try:
        accounts = parse_accounts_csv(csv_path)
    except Exception as e:
        print(f"[ERROR] Failed to read CSV: {e}")
        sys.exit(1)

    if not accounts:
        print("[WARN] No valid accounts found in CSV. Please verify columns (account, password).")
        sys.exit(1)

    print(f"[INFO] Successfully loaded {len(accounts)} accounts from file.")

    # 3. Check GPMLogin connection
    gpm = GPMLoginController()
    if not gpm.ensure_gpm_running():
        print("[FATAL] Could not connect to GPMLogin API. Please open GPMLogin manually.")
        sys.exit(1)

    print(f"[INFO] Connected to GPMLogin Global API: {gpm.discover_api()}\n")

    # 4. Batch execution
    results = []
    output_csv = os.path.abspath(args.results)

    total = len(accounts)
    success_count = 0
    fail_count = 0

    for idx, acc in enumerate(accounts, start=1):
        print(f"\n[{idx}/{total}] Processing account: {acc.account}")
        ok, pid, msg = login_single_account(
            gpm=gpm,
            account=acc,
            omocaptcha_solver=solver,
            custom_imap_host=cfg.get("default_imap_host", ""),
            custom_imap_port=cfg.get("default_imap_port", 993),
            captcha_timeout=args.timeout,
            keep_open=args.keep_open
        )

        status_str = "SUCCESS" if ok else "FAILED"
        if ok:
            success_count += 1
        else:
            fail_count += 1

        rec = {
            "account": acc.account,
            "profile_id": pid,
            "status": status_str,
            "message": msg,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        results.append(rec)

        # Save result incrementally
        file_exists = os.path.exists(output_csv)
        with open(output_csv, "a", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["account", "profile_id", "status", "message", "timestamp"])
            if not file_exists:
                writer.writeheader()
            writer.writerow(rec)

        if idx < total:
            print(f"[INFO] Waiting {args.delay}s before next account...")
            time.sleep(args.delay)

    # 5. Final Summary
    print("\n" + "=" * 65)
    print("                     BATCH EXECUTION SUMMARY                ")
    print("=" * 65)
    print(f"Total Accounts:   {total}")
    print(f"Successful:       {success_count}  ✅")
    print(f"Failed:           {fail_count}  ❌")
    print(f"Results saved to: {output_csv}")
    print("=" * 65)


if __name__ == "__main__":
    main()
