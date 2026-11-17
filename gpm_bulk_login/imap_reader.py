#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IMAP Email 2FA Code Reader for TikTok
Connects to email inbox (Hotmail, Outlook, Gmail, custom domain)
and automatically retrieves the 6-digit verification code sent by TikTok.
"""

import re
import time
import email
import imaplib
from email.header import decode_header
from typing import Optional, Tuple


# Known IMAP server endpoints by email domain
DOMAIN_IMAP_MAP = {
    # Microsoft Hotmail / Outlook / Live / MSN
    "hotmail.com": ("outlook.office365.com", 993),
    "outlook.com": ("outlook.office365.com", 993),
    "live.com": ("outlook.office365.com", 993),
    "msn.com": ("outlook.office365.com", 993),
    "windowslive.com": ("outlook.office365.com", 993),
    # Google Gmail
    "gmail.com": ("imap.gmail.com", 993),
    "googlemail.com": ("imap.gmail.com", 993),
    # Yahoo
    "yahoo.com": ("imap.mail.yahoo.com", 993),
    "ymail.com": ("imap.mail.yahoo.com", 993),
    "rocketmail.com": ("imap.mail.yahoo.com", 993),
    # Mail.ru
    "mail.ru": ("imap.mail.ru", 993),
    "bk.ru": ("imap.mail.ru", 993),
    "inbox.ru": ("imap.mail.ru", 993),
    # Rambler
    "rambler.ru": ("imap.rambler.ru", 993),
    # Proton (via bridge) / others
    "zoho.com": ("imap.zoho.com", 993),
    "icloud.com": ("imap.mail.me.com", 993),
}


def get_imap_host_for_email(email_addr: str) -> Tuple[str, int]:
    """Determine IMAP host and port from email address domain."""
    domain = email_addr.split("@")[-1].strip().lower() if "@" in email_addr else ""
    if domain in DOMAIN_IMAP_MAP:
        return DOMAIN_IMAP_MAP[domain]
    
    # Generic fallback: imap.<domain> or mail.<domain>
    if domain:
        return f"imap.{domain}", 993
    return "outlook.office365.com", 993


def _decode_str(header_str: str) -> str:
    """Decodes MIME encoded header strings (e.g. =?UTF-8?B?...?=)."""
    if not header_str:
        return ""
    decoded_fragments = decode_header(header_str)
    result = []
    for fragment, encoding in decoded_fragments:
        if isinstance(fragment, bytes):
            try:
                result.append(fragment.decode(encoding or "utf-8", errors="replace"))
            except Exception:
                result.append(fragment.decode("latin1", errors="replace"))
        else:
            result.append(str(fragment))
    return "".join(result)


def _extract_body_text(msg: email.message.Message) -> str:
    """Extract plain text or HTML body content from email message."""
    body_parts = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            cdisp = str(part.get("Content-Disposition", ""))
            if "attachment" in cdisp:
                continue
            if ctype in ["text/plain", "text/html"]:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        body_parts.append(payload.decode(charset, errors="replace"))
                    except Exception:
                        body_parts.append(payload.decode("latin1", errors="replace"))
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or "utf-8"
            try:
                body_parts.append(payload.decode(charset, errors="replace"))
            except Exception:
                body_parts.append(payload.decode("latin1", errors="replace"))
    return " ".join(body_parts)


def extract_tiktok_code(text: str) -> Optional[str]:
    """Extract 6-digit verification code from TikTok email text."""
    # Pattern 1: Explicit mention of verification code e.g. "mã xác minh: 123456" or "code is 123456"
    match = re.search(r'(?:code|mã|verification|xác thực|xác minh)\D{0,20}?(\b\d{6}\b)', text, re.IGNORECASE)
    if match:
        return match.group(1)

    # Pattern 2: Standalone 6-digit number in bold or surrounded by whitespace / tags
    matches = re.findall(r'\b\d{6}\b', text)
    if matches:
        # Return first 6-digit match
        return matches[0]

    return None


def fetch_tiktok_2fa_code(
    email_addr: str,
    email_pwd: str,
    custom_imap_host: Optional[str] = None,
    custom_imap_port: int = 993,
    max_wait_seconds: int = 60,
    poll_interval: int = 4
) -> Optional[str]:
    """
    Connect to IMAP server, wait for the latest verification email from TikTok,
    and return the 6-digit code.
    """
    if not email_addr or not email_pwd:
        return None

    if custom_imap_host:
        imap_host = custom_imap_host
        imap_port = custom_imap_port
    else:
        imap_host, imap_port = get_imap_host_for_email(email_addr)

    print(f"[IMAP] Connecting to {imap_host}:{imap_port} for {email_addr}...")
    start_time = time.time()

    while time.time() - start_time < max_wait_seconds:
        mail = None
        try:
            mail = imaplib.IMAP4_SSL(imap_host, imap_port)
            mail.login(email_addr, email_pwd)

            # Check both INBOX and Junk/Spam folders
            for folder in ["INBOX", "Junk", "Spam"]:
                try:
                    status, _ = mail.select(folder, readonly=True)
                    if status != "OK":
                        continue

                    # Search for recent messages
                    status, msg_ids = mail.search(None, "ALL")
                    if status != "OK" or not msg_ids[0]:
                        continue

                    id_list = msg_ids[0].split()
                    # Inspect the latest 5 emails
                    recent_ids = id_list[-5:]
                    recent_ids.reverse()

                    for m_id in recent_ids:
                        status, data = mail.fetch(m_id, "(RFC822)")
                        if status != "OK" or not data or not data[0]:
                            continue

                        raw_email = data[0][1]
                        msg = email.message_from_bytes(raw_email)
                        subject = _decode_str(msg.get("Subject", ""))
                        sender = _decode_str(msg.get("From", ""))
                        body = _extract_body_text(msg)

                        # Check if email is from TikTok or mentions TikTok
                        full_content = f"{subject} {sender} {body}".lower()
                        if "tiktok" in full_content:
                            code = extract_tiktok_code(f"{subject} {body}")
                            if code:
                                print(f"[IMAP] Found TikTok verification code: {code} (Folder: {folder})")
                                mail.logout()
                                return code
                except Exception:
                    pass

            mail.logout()

        except Exception as e:
            err_msg = str(e)
            if "Application-specific password required" in err_msg or "support.google.com/accounts/answer/185833" in err_msg:
                print(f"[IMAP] ⚠️ Gmail requires an App Password (Mật khẩu ứng dụng 16 chữ số từ https://myaccount.google.com/apppasswords) to read emails automatically via IMAP.")
                break
            elif "Basic authentication is disabled" in err_msg:
                print(f"[IMAP] ⚠️ Microsoft has disabled Basic Authentication on this Outlook/Hotmail account. (Requires App Password or Webmail API).")
                break
            elif "AUTHENTICATIONFAILED" in err_msg or "Invalid credentials" in err_msg:
                print(f"[IMAP] ⚠️ Email authentication failed: Incorrect email password or IMAP access disabled on account.")
                break
            else:
                print(f"[IMAP] Error reading mailbox: {e}")

        elapsed = int(time.time() - start_time)
        print(f"[IMAP] Waiting for TikTok email to arrive ({elapsed}/{max_wait_seconds}s)...")
        time.sleep(poll_interval)

    print("[IMAP] Timed out waiting for TikTok verification email.")
    return None

