# 🚀 TikTok Bulk Login & Profile Creator (GPMLogin Global)

A standalone desktop application that reads accounts from a CSV file, creates anti-detect browser profiles in **GPMLogin Global**, and automatically logs in to TikTok with:
- **GUI Application**: Modern desktop interface to upload CSV, input OMOCaptcha key, check balance, and view live logs.
- **Standalone `.exe` Executable**: Pre-compiled Windows application — no Python installation needed to run!
- **Auto Captcha Solving**: Integrated with **OMOCaptcha** (solves slider puzzle automatically).
- **Auto Email 2FA (IMAP)**: Automatically connects to your email inbox (Hotmail, Outlook, Gmail, etc.) to fetch the 6-digit verification code.
- **Auto Authenticator 2FA**: Generates TOTP codes on the fly using `pyotp`.

---

## 📁 Folder Structure

```text
gpm_bulk_login/
├── dist/TikTok_GPM_Bulk_Login/
│   └── TikTok_GPM_Bulk_Login.exe  # 🌟 Standalone Executable Application
├── run_exe.bat                    # 1-click shortcut to launch the .EXE
├── app_gui.py                     # Python Desktop GUI source code
├── bulk_login.py                  # Core automation engine
├── omocaptcha_solver.py           # OMOCaptcha API client (TiktokSliderWebTask)
├── imap_reader.py                 # IMAP 2FA email code retriever
├── config.json                    # Configuration file (saved automatically by UI)
├── run.bat                        # 1-click runner for Python source
├── sample_accounts.csv            # Example CSV template
├── requirements.txt               # Dependencies
└── README.md                      # Documentation
```

---

## ⚡ How to Run the App

### Option 1: Standalone `.exe` (No Python required)
Double-click:
* [`run_exe.bat`](file:///c:/Users/datng/tiktok-farm/gpm_bulk_login/run_exe.bat) OR
* Directly open: [`dist/TikTok_GPM_Bulk_Login/TikTok_GPM_Bulk_Login.exe`](file:///c:/Users/datng/tiktok-farm/gpm_bulk_login/dist/TikTok_GPM_Bulk_Login/TikTok_GPM_Bulk_Login.exe)

### Option 2: Python Runner
Double-click:
* [`run.bat`](file:///c:/Users/datng/tiktok-farm/gpm_bulk_login/run.bat)

---

## 🖥️ Using the GUI

1. **Upload CSV**:
   - Click **`📁 Browse CSV`** and select your accounts CSV file.
   - The UI immediately shows the number of accounts detected.
2. **OMOCaptcha Key**:
   - Paste your API key into the **OMOCaptcha Key** field.
   - Click **`🔍 Check Balance`** to test your key and see your account balance in real-time.
   - Click **`💾 Save Config`** to save your key so you never have to re-enter it.
3. **Start Automation**:
   - Click **`▶ START BULK LOGIN`**.
   - Watch the live progress bar, stats badges (Total, Success, Failed), and real-time colored console output.
   - Click **`📊 Open Results CSV`** at any time to inspect the detailed results log.

---

## 📋 CSV Format Supported

The script auto-detects columns and delimiters (`,`, `|`, `;`, Tab).

### 100% Automated Format (Recommended):
```csv
account,password,proxy,email,email_password,2fa_secret
tiktok_user_1,TikTokPass123!,,user1@hotmail.com,HotmailPass456!,
tiktok_user_2,TikTokPass123!,http://user:pass@ip:port,user2@outlook.com,OutlookPass789!,
user3@gmail.com,TikTokPass123!,,,MyGmailAppPassword!,
```

* **`account`**: TikTok Username, Email, or Phone.
* **`password`**: TikTok Password.
* **`proxy`**: *(Optional)* `http://user:pass@ip:port` or `ip:port`.
* **`email`**: *(Optional)* Email address if different from `account`.
* **`email_password`**: Email password (used by IMAP to read the 6-digit TikTok verification code).
* **`2fa_secret`**: *(Optional)* 16/32-char TOTP Secret Key if using Authenticator app.
