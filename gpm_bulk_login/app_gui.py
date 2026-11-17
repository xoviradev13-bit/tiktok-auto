#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=============================================================================
TikTok Bulk Login - Modern Desktop GUI
=============================================================================
A standalone graphical interface for TikTok Bulk Account Creator & Login.
Integrated with:
- GPMLogin Global Local API
- OMOCaptcha API (TiktokSliderWebTask)
- IMAP 2FA Email Auto-Reader
=============================================================================
"""

import os
import sys
import csv
import json
import time
import queue
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional, List

# Ensure current folder is in sys.path
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

import tkinter as tk
from tkinter import ttk, filedialog, messagebox

from bulk_login import (
    GPMLoginController,
    AccountRecord,
    parse_accounts_csv,
    login_single_account,
    load_config,
    CONFIG_FILE
)
from omocaptcha_solver import OMOCaptchaSolver


# Color Palette (Modern Dark Theme)
BG_DARK = "#181825"
BG_CARD = "#212234"
BG_INPUT = "#13131d"
TEXT_MAIN = "#cdd6f4"
TEXT_MUTED = "#a6adc8"
ACCENT_CYAN = "#00f2fe"
ACCENT_GREEN = "#a6e3a1"
ACCENT_RED = "#f38ba8"
ACCENT_YELLOW = "#f9e2af"
ACCENT_PURPLE = "#cba6f7"
BORDER_COLOR = "#313244"


class ModernBulkLoginApp(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title("TikTok Bulk Login & Profile Creator - GPMLogin Global")
        self.geometry("860x780")
        self.minsize(780, 680)
        self.configure(bg=BG_DARK)

        # Set App Icon if exists
        icon_path = Path(__file__).resolve().parent.parent / "logo" / "app-logo.ico"
        if icon_path.exists():
            try:
                self.iconbitmap(str(icon_path))
            except Exception:
                pass

        self.config_data = load_config()
        self.log_queue = queue.Queue()
        self.worker_thread: Optional[threading.Thread] = None
        self.stop_requested = False

        self.loaded_accounts: List[AccountRecord] = []
        self.total_count = 0
        self.success_count = 0
        self.fail_count = 0

        self._build_ui()
        self.after(100, self._process_log_queue)

    def _build_ui(self):
        # Header Banner
        header_frame = tk.Frame(self, bg=BG_CARD, height=70, bd=0, highlightthickness=1, highlightbackground=BORDER_COLOR)
        header_frame.pack(fill="x", padx=16, pady=(16, 10))

        title_lbl = tk.Label(
            header_frame,
            text="✨ TIKTOK BULK LOGIN AUTOMATION",
            font=("Segoe UI", 14, "bold"),
            fg=ACCENT_CYAN,
            bg=BG_CARD
        )
        title_lbl.pack(anchor="w", padx=16, pady=(10, 2))

        sub_lbl = tk.Label(
            header_frame,
            text="GPMLogin Global  •  OMOCaptcha Auto-Solver  •  IMAP 2FA Email Code Reader",
            font=("Segoe UI", 9),
            fg=TEXT_MUTED,
            bg=BG_CARD
        )
        sub_lbl.pack(anchor="w", padx=16, pady=(0, 10))

        # Config & File Selection Card
        input_card = tk.Frame(self, bg=BG_CARD, bd=0, highlightthickness=1, highlightbackground=BORDER_COLOR)
        input_card.pack(fill="x", padx=16, pady=6)

        # Row 1: CSV File
        r1 = tk.Frame(input_card, bg=BG_CARD)
        r1.pack(fill="x", padx=16, pady=(12, 6))

        tk.Label(r1, text="Accounts CSV:", font=("Segoe UI", 10, "bold"), fg=TEXT_MAIN, bg=BG_CARD, width=15, anchor="w").pack(side="left")
        self.csv_path_var = tk.StringVar(value="")
        self.csv_entry = tk.Entry(
            r1,
            textvariable=self.csv_path_var,
            font=("Segoe UI", 10),
            bg=BG_INPUT,
            fg=TEXT_MAIN,
            insertbackground=TEXT_MAIN,
            bd=0,
            highlightthickness=1,
            highlightbackground=BORDER_COLOR
        )
        self.csv_entry.pack(side="left", fill="x", expand=True, padx=(0, 8), ipady=4)

        browse_btn = tk.Button(
            r1,
            text="📁 Browse CSV",
            font=("Segoe UI", 9, "bold"),
            bg="#313244",
            fg=TEXT_MAIN,
            activebackground="#45475a",
            activeforeground=TEXT_MAIN,
            bd=0,
            padx=12,
            pady=4,
            cursor="hand2",
            command=self._on_browse_csv
        )
        browse_btn.pack(side="right")

        # Row 1.5: Account Count Info
        self.info_lbl_var = tk.StringVar(value="Please select a CSV file containing your accounts.")
        self.info_lbl = tk.Label(input_card, textvariable=self.info_lbl_var, font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD)
        self.info_lbl.pack(anchor="w", padx=16, pady=(0, 8))

        # Row 2: OMOCaptcha Key
        r2 = tk.Frame(input_card, bg=BG_CARD)
        r2.pack(fill="x", padx=16, pady=4)

        tk.Label(r2, text="OMOCaptcha Key:", font=("Segoe UI", 10, "bold"), fg=TEXT_MAIN, bg=BG_CARD, width=15, anchor="w").pack(side="left")
        self.omo_key_var = tk.StringVar(value=self.config_data.get("omocaptcha_api_key", ""))
        self.omo_entry = tk.Entry(
            r2,
            textvariable=self.omo_key_var,
            font=("Segoe UI", 10),
            bg=BG_INPUT,
            fg=TEXT_MAIN,
            insertbackground=TEXT_MAIN,
            bd=0,
            highlightthickness=1,
            highlightbackground=BORDER_COLOR
        )
        self.omo_entry.pack(side="left", fill="x", expand=True, padx=(0, 8), ipady=4)

        check_btn = tk.Button(
            r2,
            text="🔍 Check Balance",
            font=("Segoe UI", 9, "bold"),
            bg="#313244",
            fg=ACCENT_PURPLE,
            activebackground="#45475a",
            activeforeground=ACCENT_PURPLE,
            bd=0,
            padx=10,
            pady=4,
            cursor="hand2",
            command=self._check_omocaptcha_balance
        )
        check_btn.pack(side="right")

        # Row 3: Settings (Delay, Timeout, Keep open)
        r3 = tk.Frame(input_card, bg=BG_CARD)
        r3.pack(fill="x", padx=16, pady=(6, 14))

        tk.Label(r3, text="Delay (sec):", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(side="left")
        self.delay_var = tk.StringVar(value=str(self.config_data.get("delay_between_accounts", 3.0)))
        tk.Entry(r3, textvariable=self.delay_var, width=5, font=("Segoe UI", 9), bg=BG_INPUT, fg=TEXT_MAIN, bd=0, highlightthickness=1, highlightbackground=BORDER_COLOR).pack(side="left", padx=(4, 16), ipady=2)

        tk.Label(r3, text="Timeout (sec):", font=("Segoe UI", 9), fg=TEXT_MUTED, bg=BG_CARD).pack(side="left")
        self.timeout_var = tk.StringVar(value=str(self.config_data.get("captcha_timeout", 120)))
        tk.Entry(r3, textvariable=self.timeout_var, width=5, font=("Segoe UI", 9), bg=BG_INPUT, fg=TEXT_MAIN, bd=0, highlightthickness=1, highlightbackground=BORDER_COLOR).pack(side="left", padx=(4, 16), ipady=2)

        self.keep_open_var = tk.BooleanVar(value=self.config_data.get("keep_open", False))
        keep_chk = tk.Checkbutton(
            r3,
            text="Keep browser open after login",
            variable=self.keep_open_var,
            font=("Segoe UI", 9),
            fg=TEXT_MAIN,
            bg=BG_CARD,
            activebackground=BG_CARD,
            activeforeground=TEXT_MAIN,
            selectcolor=BG_INPUT
        )
        keep_chk.pack(side="left")

        save_cfg_btn = tk.Button(
            r3,
            text="💾 Save Config",
            font=("Segoe UI", 9),
            bg="#313244",
            fg=TEXT_MUTED,
            bd=0,
            padx=10,
            pady=2,
            cursor="hand2",
            command=self._save_config
        )
        save_cfg_btn.pack(side="right")

        # Action Buttons & Status Cards Row
        action_frame = tk.Frame(self, bg=BG_DARK)
        action_frame.pack(fill="x", padx=16, pady=8)

        self.start_btn = tk.Button(
            action_frame,
            text="▶  START BULK LOGIN",
            font=("Segoe UI", 11, "bold"),
            bg="#10b981",
            fg="#ffffff",
            activebackground="#059669",
            activeforeground="#ffffff",
            bd=0,
            padx=20,
            pady=8,
            cursor="hand2",
            command=self._on_start_login
        )
        self.start_btn.pack(side="left", padx=(0, 10))

        self.stop_btn = tk.Button(
            action_frame,
            text="⏹  STOP",
            font=("Segoe UI", 11, "bold"),
            bg="#ef4444",
            fg="#ffffff",
            activebackground="#dc2626",
            activeforeground="#ffffff",
            bd=0,
            padx=16,
            pady=8,
            cursor="hand2",
            state="disabled",
            command=self._on_stop_login
        )
        self.stop_btn.pack(side="left", padx=(0, 16))

        # Badges
        self.badge_total = self._create_stat_badge(action_frame, "Total", "0", TEXT_MAIN)
        self.badge_success = self._create_stat_badge(action_frame, "Success", "0", ACCENT_GREEN)
        self.badge_failed = self._create_stat_badge(action_frame, "Failed", "0", ACCENT_RED)

        # Progress Bar Frame
        prog_frame = tk.Frame(self, bg=BG_DARK)
        prog_frame.pack(fill="x", padx=16, pady=(4, 8))

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Custom.Horizontal.TProgressbar", troughcolor=BG_CARD, bordercolor=BORDER_COLOR, background=ACCENT_CYAN, lightcolor=ACCENT_CYAN, darkcolor=ACCENT_CYAN)

        self.progress_bar = ttk.Progressbar(prog_frame, style="Custom.Horizontal.TProgressbar", orient="horizontal", mode="determinate")
        self.progress_bar.pack(side="left", fill="x", expand=True, padx=(0, 10), ipady=3)

        self.prog_lbl_var = tk.StringVar(value="Ready")
        self.prog_lbl = tk.Label(prog_frame, textvariable=self.prog_lbl_var, font=("Segoe UI", 9, "bold"), fg=TEXT_MUTED, bg=BG_DARK, width=15, anchor="e")
        self.prog_lbl.pack(side="right")

        # Live Console Log Frame
        log_frame = tk.Frame(self, bg=BG_CARD, bd=0, highlightthickness=1, highlightbackground=BORDER_COLOR)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(0, 12))

        log_top_bar = tk.Frame(log_frame, bg=BG_CARD)
        log_top_bar.pack(fill="x", padx=12, pady=(8, 4))

        tk.Label(log_top_bar, text="Console Output:", font=("Segoe UI", 9, "bold"), fg=TEXT_MUTED, bg=BG_CARD).pack(side="left")

        open_res_btn = tk.Button(
            log_top_bar,
            text="📊 Open Results CSV",
            font=("Segoe UI", 9),
            bg="#313244",
            fg=ACCENT_CYAN,
            bd=0,
            padx=8,
            pady=2,
            cursor="hand2",
            command=self._open_results_csv
        )
        open_res_btn.pack(side="right", padx=(8, 0))

        clear_btn = tk.Button(
            log_top_bar,
            text="🧹 Clear Log",
            font=("Segoe UI", 9),
            bg="#313244",
            fg=TEXT_MUTED,
            bd=0,
            padx=8,
            pady=2,
            cursor="hand2",
            command=self._clear_log
        )
        clear_btn.pack(side="right")

        self.log_text = tk.Text(
            log_frame,
            bg=BG_INPUT,
            fg=TEXT_MAIN,
            font=("Consolas", 9),
            bd=0,
            wrap="word",
            padx=10,
            pady=8
        )
        self.log_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        # Log Text Tags for Colors
        self.log_text.tag_config("info", foreground=ACCENT_CYAN)
        self.log_text.tag_config("success", foreground=ACCENT_GREEN)
        self.log_text.tag_config("warn", foreground=ACCENT_YELLOW)
        self.log_text.tag_config("error", foreground=ACCENT_RED)
        self.log_text.tag_config("purple", foreground=ACCENT_PURPLE)

    def _create_stat_badge(self, parent, label: str, value: str, color: str):
        card = tk.Frame(parent, bg=BG_CARD, padx=12, pady=4, highlightthickness=1, highlightbackground=BORDER_COLOR)
        card.pack(side="left", padx=4)
        tk.Label(card, text=label.upper(), font=("Segoe UI", 7, "bold"), fg=TEXT_MUTED, bg=BG_CARD).pack()
        val_lbl = tk.Label(card, text=value, font=("Segoe UI", 13, "bold"), fg=color, bg=BG_CARD)
        val_lbl.pack()
        return val_lbl

    def _log(self, text: str, tag: str = "normal"):
        self.log_queue.put((text, tag))

    def _process_log_queue(self):
        while not self.log_queue.empty():
            text, tag = self.log_queue.get_nowait()
            ts = datetime.now().strftime("%H:%M:%S")
            self.log_text.insert("end", f"[{ts}] {text}\n", tag)
            self.log_text.see("end")
        self.after(100, self._process_log_queue)

    def _clear_log(self):
        self.log_text.delete("1.0", "end")

    def _on_browse_csv(self):
        path = filedialog.askopenfilename(
            title="Select Accounts CSV File",
            filetypes=[("CSV and Text Files", "*.csv;*.txt"), ("All Files", "*.*")]
        )
        if path:
            self.csv_path_var.set(path)
            try:
                accs = parse_accounts_csv(path)
                self.loaded_accounts = accs
                self.total_count = len(accs)
                self.badge_total.config(text=str(len(accs)))
                self.info_lbl_var.set(f"✅ Loaded {len(accs)} accounts from {os.path.basename(path)}")
                self._log(f"Loaded {len(accs)} accounts from: {path}", "info")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to parse CSV file:\n{e}")

    def _save_config(self):
        try:
            self.config_data["omocaptcha_api_key"] = self.omo_key_var.get().strip()
            self.config_data["delay_between_accounts"] = float(self.delay_var.get().strip() or 3.0)
            self.config_data["captcha_timeout"] = int(self.timeout_var.get().strip() or 120)
            self.config_data["keep_open"] = self.keep_open_var.get()
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config_data, f, indent=2)
            self._log("Settings saved to config.json", "info")
            messagebox.showinfo("Saved", "Configuration saved successfully!")
        except Exception as e:
            messagebox.showerror("Error", f"Failed to save settings: {e}")

    def _check_omocaptcha_balance(self):
        key = self.omo_key_var.get().strip()
        if not key:
            messagebox.showwarning("Warning", "Please enter an OMOCaptcha API Key first.")
            return

        def _do_check():
            self._log("Checking OMOCaptcha balance...", "purple")
            solver = OMOCaptchaSolver(key)
            info = solver.get_balance_info()
            if info is not None:
                pkg = info.get("package_name") or "Standard"
                qty = info.get("quantity", 0)
                bal = info.get("balance", 0.0)
                msg = f"OMOCaptcha Connected!\n• Package: {pkg}\n• Remaining Quota: {qty:,} solves\n• Balance: ${bal:.2f}"
                self._log(f"OMOCaptcha Active: {pkg} ({qty:,} solves remaining, Balance: ${bal:.2f})", "success")
                self.after(0, lambda: messagebox.showinfo("OMOCaptcha Status", msg))
            else:
                self._log("Could not retrieve OMOCaptcha balance. Check key or connection.", "error")
                self.after(0, lambda: messagebox.showerror("Error", "Invalid OMOCaptcha Key or API connection error."))

        threading.Thread(target=_do_check, daemon=True).start()

    def _open_results_csv(self):
        res_file = CURRENT_DIR / "login_results.csv"
        if res_file.exists():
            try:
                os.startfile(str(res_file))
            except Exception as e:
                messagebox.showerror("Error", f"Failed to open file: {e}")
        else:
            messagebox.showinfo("Info", "No login_results.csv generated yet. Run a login task first.")

    def _on_start_login(self):
        csv_path = self.csv_path_var.get().strip()
        if not csv_path or not os.path.exists(csv_path):
            messagebox.showerror("Error", "Please select a valid CSV file before starting.")
            return

        if not self.loaded_accounts:
            try:
                self.loaded_accounts = parse_accounts_csv(csv_path)
            except Exception as e:
                messagebox.showerror("Error", f"Failed to parse CSV:\n{e}")
                return

        if not self.loaded_accounts:
            messagebox.showwarning("Warning", "No valid accounts found in CSV.")
            return

        self._save_config()
        self.stop_requested = False
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.success_count = 0
        self.fail_count = 0
        self.badge_success.config(text="0")
        self.badge_failed.config(text="0")

        self.progress_bar["maximum"] = len(self.loaded_accounts)
        self.progress_bar["value"] = 0
        self.prog_lbl_var.set(f"0 / {len(self.loaded_accounts)} (0%)")

        self._log("=" * 55, "info")
        self._log("🚀 Starting Bulk Login Task...", "info")
        self._log("=" * 55, "info")

        self.worker_thread = threading.Thread(target=self._run_worker, daemon=True)
        self.worker_thread.start()

    def _on_stop_login(self):
        self.stop_requested = True
        self._log("⚠️ Stop requested! Will halt after current account finishes.", "warn")
        self.stop_btn.config(state="disabled")

    def _run_worker(self):
        try:
            gpm = GPMLoginController()
            if not gpm.ensure_gpm_running():
                self._log("Could not connect to GPMLogin Global. Please open GPM manually.", "error")
                self.after(0, self._on_finish_batch)
                return

            api_base = gpm.discover_api()
            self._log(f"GPMLogin API online at: {api_base}", "info")

            omo_key = self.omo_key_var.get().strip()
            solver = OMOCaptchaSolver(omo_key) if omo_key else None
            if solver:
                self._log("OMOCaptcha auto-solver is ACTIVE.", "purple")
            else:
                self._log("OMOCaptcha key empty. Will wait for manual puzzle slide if captcha triggers.", "warn")

            delay = float(self.delay_var.get().strip() or 3.0)
            timeout = int(self.timeout_var.get().strip() or 120)
            keep_open = self.keep_open_var.get()
            output_csv = CURRENT_DIR / "login_results.csv"

            total = len(self.loaded_accounts)

            for idx, acc in enumerate(self.loaded_accounts, start=1):
                if self.stop_requested:
                    self._log("Process stopped by user.", "warn")
                    break

                self._log(f"\n[{idx}/{total}] Logging in: {acc.account} ...", "info")
                if acc.email_password:
                    self._log(f"  • Email 2FA configured: {acc.email_addr}", "info")
                if acc.proxy:
                    self._log(f"  • Proxy: {acc.proxy}", "info")

                ok, pid, msg = login_single_account(
                    gpm=gpm,
                    account=acc,
                    omocaptcha_solver=solver,
                    custom_imap_host=self.config_data.get("default_imap_host", ""),
                    custom_imap_port=self.config_data.get("default_imap_port", 993),
                    captcha_timeout=timeout,
                    keep_open=keep_open
                )

                if ok:
                    self.success_count += 1
                    self._log(f"✅ SUCCESS: {acc.account} (Profile: {pid})", "success")
                else:
                    self.fail_count += 1
                    self._log(f"❌ FAILED: {acc.account} ({msg})", "error")

                # Update live stats
                self.after(0, lambda s=self.success_count, f=self.fail_count, i=idx: self._update_progress(i, total, s, f))

                # Save record to CSV
                rec = {
                    "account": acc.account,
                    "profile_id": pid,
                    "status": "SUCCESS" if ok else "FAILED",
                    "message": msg,
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                }
                file_exists = output_csv.exists()
                with open(output_csv, "a", newline="", encoding="utf-8") as f_out:
                    writer = csv.DictWriter(f_out, fieldnames=["account", "profile_id", "status", "message", "timestamp"])
                    if not file_exists:
                        writer.writeheader()
                    writer.writerow(rec)

                if idx < total and not self.stop_requested:
                    self._log(f"Waiting {delay}s before next account...", "info")
                    time.sleep(delay)

            self._log("\n" + "=" * 55, "info")
            self._log(f"🎉 Batch Finished! Total: {total} | Success: {self.success_count} | Failed: {self.fail_count}", "success")
            self._log(f"Results saved to: {output_csv}", "info")
            self._log("=" * 55, "info")

        except Exception as e:
            self._log(f"Fatal worker exception: {e}", "error")

        finally:
            self.after(0, self._on_finish_batch)

    def _update_progress(self, current: int, total: int, success: int, fail: int):
        self.badge_success.config(text=str(success))
        self.badge_failed.config(text=str(fail))
        self.progress_bar["value"] = current
        pct = int((current / total) * 100) if total > 0 else 0
        self.prog_lbl_var.set(f"{current} / {total} ({pct}%)")

    def _on_finish_batch(self):
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")


if __name__ == "__main__":
    app = ModernBulkLoginApp()
    app.mainloop()

