/**
 * License & App Info Controller (Offline Manifest / Perpetual)
 */

window.LicenseManager = {
    currentInfo: {
        is_active: true,
        license_key: "PERPETUAL-LICENSE",
        plan: "Vĩnh Viễn (Unlimited)",
        expires_at: "Vĩnh viễn",
        hwid: "Local Device"
    },
    updateInfo: null,

    isActive: function () {
        return true;
    },

    requireLicense: function (actionName = 'Tác vụ này') {
        return true;
    },

    init: async function () {
        await this.fetchStatus();
    },

    fetchStatus: async function () {
        try {
            const res = await fetch('/api/license/status');
            if (res.ok) {
                const data = await res.json();
                this.currentInfo = data;
                this.renderUI(data);
                return data;
            }
        } catch (e) {
            console.warn('[LICENSE] Status fetch error:', e);
        }
        return this.currentInfo;
    },

    renderUI: function (info) {
        if (!info) return;

        const hwidEl = document.getElementById('settingLicenseHwid');
        if (hwidEl && info.hwid) {
            hwidEl.textContent = info.hwid;
        }

        const planEl = document.getElementById('settingLicensePlan');
        if (planEl && info.plan) {
            planEl.textContent = info.plan;
        }

        const expiresEl = document.getElementById('settingLicenseExpires');
        if (expiresEl && info.expires_at) {
            expiresEl.textContent = info.expires_at;
        }

        const devicesEl = document.getElementById('settingLicenseDevices');
        if (devicesEl) {
            devicesEl.textContent = 'Tối đa (8 luồng GPU NVENC)';
        }

        const verEl = document.getElementById('appCurrentVersionText');
        if (verEl && info.version) {
            verEl.textContent = `v${info.version}`;
        }
    },

    copyHwid: function () {
        const hwid = (this.currentInfo && this.currentInfo.hwid)
            ? this.currentInfo.hwid
            : (document.getElementById('settingLicenseHwid')?.textContent || '');

        if (!hwid) {
            if (typeof showToast === 'function') showToast('Chưa có mã HWID để sao chép', 'warning');
            return;
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(hwid).then(() => {
                if (typeof showToast === 'function') showToast('📋 Đã sao chép mã HWID vào bộ nhớ tạm!', 'success');
            }).catch(() => {
                this.copyFallback(hwid);
            });
        } else {
            this.copyFallback(hwid);
        }
    },

    copyFallback: function (text) {
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        try {
            document.execCommand('copy');
            if (typeof showToast === 'function') showToast('📋 Đã sao chép mã HWID vào bộ nhớ tạm!', 'success');
        } catch (e) {
            prompt('Sao chép mã HWID thủ công:', text);
        }
        document.body.removeChild(input);
    },

    checkForUpdates: function (isManual = false) {
        if (isManual && typeof showToast === 'function') {
            showToast('✅ Bạn đang sử dụng phiên bản phần mềm mới nhất.', 'success');
        }
    },

    syncLicense: async function (btnElement) {
        await this.fetchStatus();
        if (typeof showToast === 'function') {
            showToast('✅ Trạng thái bản quyền: Vĩnh viễn (Không giới hạn tính năng).', 'success');
        }
    },

    openLicenseModal: function () {},
    closeLicenseModal: function () {},
    openConfirmDeactivateModal: function () {},
    closeConfirmDeactivateModal: function () {},
    openUpdateModal: function () {},
    closeUpdateModal: function () {},
    closeAllModals: function () {}
};

// Khởi chạy khi DOM sẵn sàng
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
        window.LicenseManager.init();
    });
} else {
    window.LicenseManager.init();
}
