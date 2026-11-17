// =========================================================================
// VIDEO MANAGER & MULTI-DOWNLOADER & ELEVENLABS VOICE LOGIC
// =========================================================================

let scannedVideoFiles = [];
let allElevenVoices = [];

// Quản lý cấu hình Thư mục lưu Direct Links
async function loadDirectDownloadSettings() {
    try {
        const res = await fetch('/api/v2/downloader/settings');
        if (!res.ok) return;
        const data = await res.json();
        const input = document.getElementById('inputDirectDownloadDir');
        if (input && data.direct_download_dir) {
            input.value = data.direct_download_dir;
        }
    } catch (e) {
        console.error('Lỗi lấy cấu hình thư mục download:', e);
    }
}

let isBrowsingFolderDirect = false;

async function browseDirectDownloadFolder() {
    if (isBrowsingFolderDirect) return;
    isBrowsingFolderDirect = true;
    try {
        const res = await fetch('/api/utils/browse-folder', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success' && data.path) {
            const input = document.getElementById('inputDirectDownloadDir');
            if (input) input.value = data.path;
            await saveDirectDownloadDirFromInput(data.path);
        } else if (data.status === 'busy') {
            if (typeof showToast === 'function') showToast(data.message, 'warning');
        }
    } catch (e) {
        alert('Lỗi mở hộp thoại chọn thư mục: ' + e.message);
    } finally {
        isBrowsingFolderDirect = false;
    }
}

async function saveDirectDownloadDirFromInput(path) {
    try {
        const res = await fetch('/api/v2/downloader/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ direct_download_dir: path })
        });
        const data = await res.json();
        if (typeof showToast === 'function') {
            showToast(data.message || 'Đã lưu thư mục tải video!', 'success');
        }
    } catch (e) {
        alert('Lỗi lưu cấu hình thư mục: ' + e.message);
    }
}

async function resetDirectDownloadDirToDefault() {
    try {
        const res = await fetch('/api/v2/downloader/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ direct_download_dir: '' })
        });
        const data = await res.json();
        const input = document.getElementById('inputDirectDownloadDir');
        if (input) input.value = data.direct_download_dir || 'data/downloads/Direct Links';
        if (typeof showToast === 'function') {
            showToast('Đã đặt lại thư mục tải Direct Links về mặc định!', 'info');
        }
    } catch (e) {
        alert('Lỗi đặt lại thư mục: ' + e.message);
    }
}

function openVideoInStudio(vKey) {
    if (typeof switchTab === 'function') {
        switchTab('tab-video-studio');
    }
    if (typeof selectStudioVideo === 'function') {
        selectStudioVideo(vKey);
    }
    if (typeof showToast === 'function') {
        showToast('Đã chuyển video sang Studio Biên Tập 9:16!', 'info');
    }
}

function getPlatformBadge(platform) {
    const p = (platform || '').toLowerCase();
    switch (p) {
        case 'tiktok':
            return `<span class="badge-plat badge-plat-tiktok"><i class="fa-brands fa-tiktok"></i> TikTok</span>`;
        case 'youtube':
            return `<span class="badge-plat badge-plat-youtube"><i class="fa-brands fa-youtube"></i> YouTube</span>`;
        case 'facebook':
            return `<span class="badge-plat badge-plat-facebook"><i class="fa-brands fa-facebook"></i> Facebook</span>`;
        case 'instagram':
            return `<span class="badge-plat badge-plat-instagram"><i class="fa-brands fa-instagram"></i> Instagram</span>`;
        case 'douyin':
            return `<span class="badge-plat badge-plat-douyin"><i class="fa-solid fa-music"></i> Douyin</span>`;
        case 'rednote':
            return `<span class="badge-plat badge-plat-rednote"><i class="fa-solid fa-book-bookmark"></i> RedNote</span>`;
        case 'xiaohongshu':
            return `<span class="badge-plat badge-plat-xiaohongshu"><i class="fa-solid fa-book-bookmark"></i> Xiaohongshu</span>`;
        case 'bilibili':
            return `<span class="badge-plat badge-plat-bilibili"><i class="fa-solid fa-tv"></i> Bilibili</span>`;
        case 'weibo':
            return `<span class="badge-plat badge-plat-weibo"><i class="fa-brands fa-weibo"></i> Weibo</span>`;
        case 'local':
            return `<span class="badge-plat badge-plat-local"><i class="fa-solid fa-hard-drive"></i> Kho Máy</span>`;
        default:
            return `<span class="badge-plat badge-plat-direct"><i class="fa-solid fa-link"></i> Direct</span>`;
    }
}

// 1. Quản lý Chế độ Quét RSS
async function loadRssScanMode() {
    try {
        const res = await fetch('/api/v2/pipeline/rss_status');
        if (!res.ok) return;
        const data = await res.json();
        const sw = document.getElementById('toggleRssScanSwitch');
        const lbl = document.getElementById('lblRssStatus');
        if (sw && data.rss_scan_enabled !== undefined) {
            sw.checked = data.rss_scan_enabled;
            if (lbl) {
                lbl.innerText = data.rss_scan_enabled ? 'RSS: BẬT' : 'RSS: ĐÃ TẮT';
                lbl.style.color = data.rss_scan_enabled ? '#38bdf8' : '#f87171';
            }
        }
    } catch (e) {
        console.error('Lỗi lấy trạng thái RSS:', e);
    }
}

async function toggleRssScanMode(enabled) {
    try {
        const res = await fetch('/api/v2/pipeline/toggle_rss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await res.json();
        const lbl = document.getElementById('lblRssStatus');
        if (lbl) {
            lbl.innerText = enabled ? 'RSS: BẬT' : 'RSS: ĐÃ TẮT';
            lbl.style.color = enabled ? '#38bdf8' : '#f87171';
        }
        if (typeof showToast === 'function') {
            showToast(data.message, enabled ? 'success' : 'warning');
        }
    } catch (e) {
        alert('Lỗi chuyển chế độ RSS: ' + e.message);
    }
}

// 2. Nạp Thư Mục Video Cục Bộ
async function scanSelectedFolder() {
    const folderInput = document.getElementById('inputLocalFolderPath');
    const folderPath = folderInput ? folderInput.value.trim() : '';
    if (!folderPath) {
        alert('Vui lòng nhập đường dẫn thư mục trên máy tính (ví dụ: D:/Videos hoặc data/downloads)!');
        return;
    }

    const resBox = document.getElementById('scanFolderResultBox');
    const btnIngest = document.getElementById('btnIngestVideos');
    if (resBox) {
        resBox.style.display = 'block';
        resBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Đang quét các file video...';
    }

    try {
        const res = await fetch('/api/v2/pipeline/scan_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_path: folderPath })
        });
        const data = await res.json();
        scannedVideoFiles = (data.files || []).map(f => f.file_path);

        if (scannedVideoFiles.length === 0) {
            resBox.innerHTML = '<span class="text-warning"><i class="fa-solid fa-circle-exclamation me-1"></i> Không tìm thấy file video nào (.mp4, .mov, .mkv, .avi) trong thư mục này!</span>';
            if (btnIngest) btnIngest.disabled = true;
        } else {
            resBox.innerHTML = `<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i> Tìm thấy <b>${scannedVideoFiles.length} video</b> hợp lệ:</span><br>` +
                data.files.slice(0, 5).map(f => `• ${f.file_name} (${f.size_mb} MB)`).join('<br>') +
                (data.files.length > 5 ? `<br><i>... và ${data.files.length - 5} file khác</i>` : '');
            if (btnIngest) btnIngest.disabled = false;
        }
    } catch (e) {
        if (resBox) resBox.innerHTML = '<span class="text-danger">Lỗi quét thư mục: ' + e.message + '</span>';
    }
}

async function ingestScannedVideos() {
    if (scannedVideoFiles.length === 0) return;
    const btnIngest = document.getElementById('btnIngestVideos');
    if (btnIngest) {
        btnIngest.disabled = true;
        btnIngest.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-2"></i> Đang nạp video...';
    }

    try {
        const res = await fetch('/api/v2/pipeline/ingest_videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                file_paths: scannedVideoFiles,
                channel_id: 'LOCAL_IMPORT',
                auto_render: true
            })
        });
        const data = await res.json();
        alert(data.message || `Đã nạp ${data.added_count} video vào hàng đợi!`);
        scannedVideoFiles = [];
        const resBox = document.getElementById('scanFolderResultBox');
        if (resBox) resBox.style.display = 'none';
        if (btnIngest) {
            btnIngest.disabled = true;
            btnIngest.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Nạp Toàn Bộ Vào Hàng Đợi Render AI';
        }
        loadVideoLibraryTable();
    } catch (e) {
        alert('Lỗi nạp video: ' + e.message);
        if (btnIngest) btnIngest.disabled = false;
    }
}

// 3. Tải Video 7 Nền Tảng (Clean Watermark) với Tiến Độ Trực Quan
async function triggerMultiDownload() {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Tải Video Đa Nền Tảng')) {
        return;
    }
    const inputUrl = document.getElementById('inputMultiDownloadUrl');
    const url = inputUrl ? inputUrl.value.trim() : '';
    if (!url) {
        alert('Vui lòng dán liên kết video từ Douyin, RedNote, Xiaohongshu, YouTube, Facebook, Instagram, Weibo hoặc Bilibili!');
        return;
    }

    const btn = document.getElementById('btnTriggerMultiDownload');
    const alertBox = document.getElementById('multiDownloadStatusAlert');
    const progressBox = document.getElementById('directDlProgressBox');
    const progressBar = document.getElementById('directDlProgressBar');
    const progressPercent = document.getElementById('directDlPercentText');
    const progressStatus = document.getElementById('directDlStatusText');
    const progressSpeedEta = document.getElementById('directDlSpeedEta');
    const progressIcon = document.getElementById('directDlProgressIcon');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...';
    }
    if (alertBox) {
        alertBox.style.display = 'none';
        alertBox.innerHTML = '';
    }
    if (progressBox) {
        progressBox.style.display = 'block';
        if (progressBar) {
            progressBar.style.width = '6%';
            progressBar.style.background = 'linear-gradient(90deg, #00f2fe 0%, #38bdf8 50%, #4facfe 100%)';
        }
        if (progressPercent) {
            progressPercent.innerText = '6%';
            progressPercent.style.color = '#00f2fe';
        }
        if (progressStatus) progressStatus.innerText = 'Đang phân tích liên kết & trích xuất luồng video...';
        if (progressSpeedEta) progressSpeedEta.innerText = '';
        if (progressIcon) progressIcon.className = 'fa-solid fa-cloud-arrow-down fa-bounce';
    }

    try {
        const startRes = await fetch('/api/v2/downloader/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const startData = await startRes.json();
        if (!startRes.ok || !startData.task_id) {
            throw new Error(startData.detail || startData.message || 'Không thể khởi động tiến trình tải');
        }

        const taskId = startData.task_id;

        // Bắt đầu vòng lặp thăm dò tiến độ (polling) mỗi 400ms
        await new Promise((resolve, reject) => {
            const pollInterval = setInterval(async () => {
                try {
                    const pRes = await fetch(`/api/v2/downloader/progress/${taskId}`);
                    if (!pRes.ok) return;
                    const pData = await pRes.json();

                    const pct = Math.max(6, Math.min(100, Math.round(pData.percent || 0)));
                    if (progressBar) progressBar.style.width = `${pct}%`;
                    if (progressPercent) progressPercent.innerText = `${pct}%`;
                    if (progressStatus) progressStatus.innerText = pData.message || (pData.title ? `Đang tải: ${pData.title}` : 'Đang xử lý tải video...');
                    if (progressSpeedEta) {
                        const parts = [];
                        if (pData.speed) parts.push(pData.speed);
                        if (pData.eta) parts.push(`Còn ~${pData.eta}`);
                        progressSpeedEta.innerText = parts.join(' • ');
                    }

                    if (pData.status === 'completed') {
                        clearInterval(pollInterval);
                        if (progressBar) {
                            progressBar.style.width = '100%';
                            progressBar.style.background = '#22c55e';
                        }
                        if (progressPercent) {
                            progressPercent.innerText = '100%';
                            progressPercent.style.color = '#22c55e';
                        }
                        if (progressStatus) progressStatus.innerText = `Đã tải xong: ${pData.title || 'Video'}`;
                        if (progressIcon) progressIcon.className = 'fa-solid fa-circle-check text-success';

                        if (alertBox) {
                            alertBox.style.display = 'block';
                            alertBox.innerHTML = `<span class="text-success fw-bold"><i class="fa-solid fa-circle-check me-1"></i> Tải thành công [${(pData.platform || 'VIDEO').toUpperCase()}]:</span><br><b>${escapeHtml(pData.title || 'Video')}</b><br><span style="color:var(--text-muted); font-size:11px; font-family:monospace;">${escapeHtml(pData.file_path || '')}</span>`;
                        }
                        if (inputUrl) inputUrl.value = '';
                        if (typeof showToast === 'function') {
                            showToast(`Đã tải thành công: ${pData.title || 'Video'}`, 'success');
                        }
                        loadVideoLibraryTable();
                        resolve();
                    } else if (pData.status === 'failed') {
                        clearInterval(pollInterval);
                        if (progressBar) progressBar.style.background = '#ef4444';
                        if (progressPercent) progressPercent.style.color = '#ef4444';
                        if (progressIcon) progressIcon.className = 'fa-solid fa-circle-xmark text-danger';
                        if (alertBox) {
                            alertBox.style.display = 'block';
                            alertBox.innerHTML = `<span class="text-danger fw-bold"><i class="fa-solid fa-triangle-exclamation me-1"></i> Tải thất bại:</span> ${escapeHtml(pData.error || pData.message || 'Lỗi không xác định')}`;
                        }
                        reject(new Error(pData.error || 'Lỗi tải video'));
                    }
                } catch (err) {
                    console.error('Lỗi polling tiến trình download:', err);
                }
            }, 400);
        });

    } catch (e) {
        if (alertBox) {
            alertBox.style.display = 'block';
            alertBox.innerHTML = `<span class="text-danger fw-bold"><i class="fa-solid fa-triangle-exclamation me-1"></i> Lỗi:</span> ${escapeHtml(e.message)}`;
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-download"></i> Tải Ngay';
        }
    }
}

// 4. ElevenLabs Voice Management
async function loadElevenLabsInfo() {
    try {
        // Kiểm tra Key
        const resKey = await fetch('/api/v2/voice/elevenlabs/key');
        if (resKey.ok) {
            const dataKey = await resKey.json();
            const badge = document.getElementById('badgeElevenStatus');
            const inputKey = document.getElementById('inputElevenApiKey');
            if (badge) {
                if (dataKey.configured) {
                    badge.className = 'badge bg-success/20 text-success border border-success/30';
                    badge.innerText = `● Đã kích hoạt (${dataKey.masked_key})`;
                } else {
                    badge.className = 'badge bg-slate-800 text-slate-400 border border-slate-700';
                    badge.innerText = 'Chưa cấu hình API Key';
                }
            }
        }

        // Tải danh sách giọng đọc
        const resVoices = await fetch('/api/v2/voice/elevenlabs/voices');
        if (resVoices.ok) {
            const dataVoices = await resVoices.json();
            allElevenVoices = dataVoices.voices || [];
            const sel = document.getElementById('selectElevenVoiceList');
            if (sel && allElevenVoices.length > 0) {
                sel.innerHTML = allElevenVoices.map(v =>
                    `<option value="${v.voice_id}">${v.name} (${v.description || v.category})</option>`
                ).join('');
            }
        }

        // Tải danh sách Kênh để gán giọng
        const resChannels = await fetch('/api/channels');
        if (resChannels.ok) {
            const channels = await resChannels.json();
            const selCh = document.getElementById('selectChannelForVoice');
            if (selCh && Array.isArray(channels)) {
                if (channels.length === 0) {
                    selCh.innerHTML = '<option value="">Chưa có kênh nào. Hãy thêm kênh trong tab Kênh Nguồn</option>';
                } else {
                    selCh.innerHTML = channels.map(c =>
                        `<option value="${c.channel_id}">${c.title || c.channel_id} (Giọng: ${c.tts_engine || 'edge-tts'})</option>`
                    ).join('');
                }
            }
        }
    } catch (e) {
        console.error('Lỗi tải thông tin ElevenLabs:', e);
    }
}

async function saveElevenApiKey() {
    const input = document.getElementById('inputElevenApiKey');
    const key = input ? input.value.trim() : '';
    if (!key) {
        alert('Vui lòng nhập ElevenLabs API Key!');
        return;
    }

    try {
        const res = await fetch('/api/v2/voice/elevenlabs/key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key })
        });
        const data = await res.json();
        alert(data.message || 'Lưu thành công!');
        if (input) input.value = '';
        loadElevenLabsInfo();
    } catch (e) {
        alert('Lỗi lưu key: ' + e.message);
    }
}

function previewElevenVoiceAudio() {
    const sel = document.getElementById('selectElevenVoiceList');
    const voiceId = sel ? sel.value : '';
    const voiceObj = allElevenVoices.find(v => v.voice_id === voiceId);

    const player = document.getElementById('audioVoicePreviewPlayer');
    if (player && voiceObj && voiceObj.preview_url) {
        player.src = voiceObj.preview_url;
        player.style.display = 'inline-block';
        player.play();
    } else {
        alert('Giọng đọc này không có link nghe thử trực tiếp. Hãy bấm "Đọc Thử" bên phải để sinh âm thanh!');
    }
}

async function bindVoiceToSelectedChannel() {
    const selCh = document.getElementById('selectChannelForVoice');
    const selVoice = document.getElementById('selectElevenVoiceList');
    const channelId = selCh ? selCh.value : '';
    const voiceId = selVoice ? selVoice.value : '';

    if (!channelId) {
        alert('Vui lòng chọn Kênh cần gán giọng đọc!');
        return;
    }

    try {
        const res = await fetch('/api/v2/channels/voice_settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channel_id: channelId,
                tts_engine: 'elevenlabs',
                elevenlabs_voice_id: voiceId,
                elevenlabs_model: 'eleven_multilingual_v2'
            })
        });
        const data = await res.json();
        alert(data.message || 'Đã gán giọng ElevenLabs cho kênh thành công!');
        loadElevenLabsInfo();
    } catch (e) {
        alert('Lỗi gán giọng đọc: ' + e.message);
    }
}

async function generateTestTtsSpeech() {
    const input = document.getElementById('inputTestTtsSentence');
    const selVoice = document.getElementById('selectElevenVoiceList');
    const text = input ? input.value.trim() : '';
    const voiceId = selVoice ? selVoice.value : 'pNInz6obpgDQGcFmaJgB';

    if (!text) return;
    const alertBox = document.getElementById('testTtsResultAlert');
    if (alertBox) {
        alertBox.style.display = 'block';
        alertBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin me-1"></i> Đang gọi ElevenLabs sinh giọng đọc...';
    }

    try {
        const res = await fetch('/api/v2/voice/elevenlabs/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice_id: voiceId })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            alertBox.innerHTML = `<span class="text-success"><i class="fa-solid fa-circle-check me-1"></i> Đã tạo xong audio: ${data.file_path}</span>`;
            const player = document.getElementById('audioVoicePreviewPlayer');
            if (player) {
                player.src = `/media/downloads/${data.file_path.split(/[\\\\/]/).pop()}`;
                player.style.display = 'inline-block';
                player.play().catch(() => { });
            }
        } else {
            alertBox.innerHTML = `<span class="text-danger">Lỗi: ${data.detail || data.message}</span>`;
        }
    } catch (e) {
        if (alertBox) alertBox.innerHTML = `<span class="text-danger">Lỗi: ${e.message}</span>`;
    }
}

let allLibraryVideos = [];
let videoLibCurrentPage = 1;
let videoLibPageSize = 20;

function formatDateTime(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const pad = (n) => n.toString().padStart(2, '0');
        const day = pad(d.getDate());
        const month = pad(d.getMonth() + 1);
        const year = d.getFullYear();
        const hours = pad(d.getHours());
        const mins = pad(d.getMinutes());
        return `${day}/${month}/${year} ${hours}:${mins}`;
    } catch (e) {
        return dateStr;
    }
}

function copyVideoFilePath(path) {
    if (typeof copyTextToClipboard === 'function') {
        copyTextToClipboard(path, 'Đã sao chép đường dẫn video!');
    } else {
        navigator.clipboard.writeText(path).then(() => {
            if (typeof showToast === 'function') showToast('Đã sao chép đường dẫn video!', 'info');
        });
    }
}

// 5. Quản Lý Danh Sách Video (Video Library Table)
async function loadVideoLibraryTable() {
    const tbody = document.getElementById('videoLibraryTableBody');
    if (!tbody) return;

    try {
        const res = await fetch('/api/v2/videos/library?limit=300');
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#ef4444;"><i class="fa-solid fa-triangle-exclamation me-1"></i> Lỗi tải danh sách video: ${escapeHtml(errData.detail || res.statusText)}</td></tr>`;
            return;
        }
        const data = await res.json();
        allLibraryVideos = data.videos || [];
        filterVideoLibrary();
    } catch (e) {
        console.error('Lỗi tải video library:', e);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:#ef4444;"><i class="fa-solid fa-circle-exclamation me-1"></i> Lỗi kết nối: ${e.message}</td></tr>`;
        }
    }
}

function filterVideoLibrary(resetPage = false) {
    const tbody = document.getElementById('videoLibraryTableBody');
    if (!tbody) return;

    if (resetPage) {
        videoLibCurrentPage = 1;
    }

    const searchInput = document.getElementById('videoLibSearchInput');
    const platformFilter = document.getElementById('videoLibPlatformFilter');
    const statusFilter = document.getElementById('videoLibStatusFilter');
    const countBadge = document.getElementById('videoLibCountBadge');

    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const plat = (platformFilter ? platformFilter.value : '').trim().toLowerCase();
    const st = (statusFilter ? statusFilter.value : '').trim().toLowerCase();

    const filtered = allLibraryVideos.filter(v => {
        // Lọc nền tảng
        if (plat) {
            const vPlat = (v.platform || '').toLowerCase();
            if (plat === 'xiaohongshu' || plat === 'rednote') {
                if (vPlat !== 'xiaohongshu' && vPlat !== 'rednote') return false;
            } else if (vPlat !== plat) {
                return false;
            }
        }
        // Lọc trạng thái
        if (st && (v.status || '').toLowerCase() !== st) {
            return false;
        }
        // Lọc từ khóa tìm kiếm (tiêu đề, video_id, nguồn, đường dẫn)
        if (query) {
            const title = (v.title || '').toLowerCase();
            const vid = String(v.yt_video_id || v.id || '').toLowerCase();
            const src = (v.source_name || v.channel_title || v.channel_id || '').toLowerCase();
            const pth = (v.download_path || '').toLowerCase();
            if (!title.includes(query) && !vid.includes(query) && !src.includes(query) && !pth.includes(query)) {
                return false;
            }
        }
        return true;
    });

    if (countBadge) {
        countBadge.innerText = `${filtered.length} / ${allLibraryVideos.length} Video`;
    }

    // Pagination calculations
    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / videoLibPageSize));
    if (videoLibCurrentPage > totalPages) videoLibCurrentPage = totalPages;
    if (videoLibCurrentPage < 1) videoLibCurrentPage = 1;

    const startIdx = (videoLibCurrentPage - 1) * videoLibPageSize;
    const endIdx = Math.min(startIdx + videoLibPageSize, totalItems);
    const pagedVideos = filtered.slice(startIdx, endIdx);

    const infoEl = document.getElementById('videoLibPaginationInfo');
    if (infoEl) {
        infoEl.textContent = totalItems > 0 
            ? `Hiển thị ${startIdx + 1} - ${endIdx} / ${totalItems} video` 
            : `0 video`;
    }
    const navEl = document.getElementById('videoLibPaginationNav');
    if (navEl) {
        navEl.innerHTML = `
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToVideoLibPage(1)" ${videoLibCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang đầu">
                <i class="fa-solid fa-angles-left"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToVideoLibPage(${videoLibCurrentPage - 1})" ${videoLibCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang trước">
                <i class="fa-solid fa-angle-left"></i>
            </button>
            <span style="font-size: 12px; font-weight: 600; padding: 0 8px; color: var(--text-primary); white-space: nowrap;">
                Trang ${videoLibCurrentPage} / ${totalPages}
            </span>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToVideoLibPage(${videoLibCurrentPage + 1})" ${videoLibCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang sau">
                <i class="fa-solid fa-angle-right"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToVideoLibPage(${totalPages})" ${videoLibCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang cuối">
                <i class="fa-solid fa-angles-right"></i>
            </button>
        `;
    }

    if (pagedVideos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:30px; color:var(--text-muted);"><i class="fa-solid fa-film" style="margin-right:6px;"></i> Không tìm thấy video nào phù hợp với bộ lọc tìm kiếm.</td></tr>`;
        return;
    }

    tbody.innerHTML = pagedVideos.map(v => {
        const statusBadge = v.status === 'rendered'
            ? '<span class="badge badge-success" style="font-size:11px; white-space:nowrap;"><i class="fa-solid fa-circle-check" style="margin-right:4px;"></i>Đã Render AI</span>'
            : v.status === 'rendering'
                ? '<span class="badge" style="background:rgba(245, 158, 11, 0.2); color:#fbbf24; font-size:11px; white-space:nowrap;"><i class="fa-solid fa-spinner fa-spin" style="margin-right:4px;"></i>Đang Render</span>'
                : v.status === 'uploaded' || v.status === 'published'
                    ? '<span class="badge" style="background:rgba(56, 189, 248, 0.2); color:#38bdf8; font-size:11px; white-space:nowrap;"><i class="fa-solid fa-cloud-arrow-up" style="margin-right:4px;"></i>Đã Đăng</span>'
                    : '<span class="badge" style="background:rgba(255, 255, 255, 0.08); color:var(--text-muted); font-size:11px; white-space:nowrap;"><i class="fa-solid fa-download" style="margin-right:4px;"></i>Đã Tải Sẵn</span>';

        const existsBadge = v.file_exists
            ? '<span style="color:#22c55e; font-size:11.5px; font-weight:600; white-space:nowrap;"><i class="fa-solid fa-check"></i> Có file</span>'
            : '<span style="color:#ef4444; font-size:11.5px; font-weight:600; white-space:nowrap;"><i class="fa-solid fa-xmark"></i> Mất file</span>';

        const sourceText = v.source_name || v.channel_title || v.channel_display_name || v.channel_id || 'Direct Links';
        const isDirect = (v.source_type === 'direct') || sourceText.toLowerCase().includes('direct');
        const isYt = (v.source_type === 'youtube') || (!isDirect && sourceText !== 'LOCAL');

        const sourceBadge = isDirect
            ? `<span class="badge" style="background:rgba(56, 189, 248, 0.15); color:#38bdf8; border:1px solid rgba(56, 189, 248, 0.3); font-size:11px; white-space:nowrap;"><i class="fa-solid fa-link" style="margin-right:4px;"></i>Direct Links</span>`
            : isYt
                ? `<span class="badge" style="background:rgba(239, 68, 68, 0.15); color:#f87171; border:1px solid rgba(239, 68, 68, 0.3); font-size:11px; white-space:nowrap;" title="${escapeHtml(sourceText)}"><i class="fa-brands fa-youtube" style="margin-right:4px;"></i>${escapeHtml(sourceText)}</span>`
                : `<span class="badge" style="background:rgba(245, 158, 11, 0.15); color:#fbbf24; border:1px solid rgba(245, 158, 11, 0.3); font-size:11px; white-space:nowrap;"><i class="fa-solid fa-folder" style="margin-right:4px;"></i>${escapeHtml(sourceText)}</span>`;

        const platformBadge = getPlatformBadge(v.platform);
        const vKey = String(v.yt_video_id || v.id || '');
        const timeFormatted = formatDateTime(v.created_at);

        let shortPath = 'N/A';
        if (v.download_path) {
            const parts = v.download_path.split(/[\\/]/).filter(Boolean);
            shortPath = parts.slice(-2).join('/');
        }
        const rawDownloadPath = (v.download_path || '').replace(/\\/g, '\\\\');

        return `
            <tr>
                <td style="max-width: 280px; width: 280px; overflow: hidden;">
                    <div class="video-title-click-link" onclick="openVideoInStudio('${escapeHtml(vKey)}')" 
                         title="Bấm để mở video trong Studio Biên Tập: ${escapeHtml(v.title || '')}">
                        <i class="fa-solid fa-wand-magic-sparkles text-cyan" style="font-size:11px; margin-right:6px; flex-shrink:0;"></i>
                        <span class="video-title-text">${escapeHtml(v.title || 'Video #' + v.id)}</span>
                    </div>
                </td>
                <td>
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span class="channel-id-tag" title="${escapeHtml(vKey)}" style="max-width:115px;">${escapeHtml(vKey)}</span>
                        <button type="button" class="btn-copy-id" onclick="copyTextToClipboard('${escapeHtml(vKey)}', 'Đã sao chép Video ID!')" title="Sao chép Video ID">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                    </div>
                </td>
                <td>${platformBadge}</td>
                <td>${sourceBadge}</td>
                <td style="color:var(--text-primary); font-size:12px; font-weight:500; white-space:nowrap;">${v.size_mb ? v.size_mb + ' MB' : (v.duration ? v.duration + 's' : 'N/A')}</td>
                <td style="color:var(--text-muted); font-size:11.5px; white-space:nowrap;">${escapeHtml(timeFormatted)}</td>
                <td>${statusBadge}</td>
                <td>${existsBadge}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:5px; max-width:210px;">
                        <span style="font-family:monospace; font-size:10.5px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(v.download_path || '')}">
                            ${escapeHtml(shortPath)}
                        </span>
                        ${v.download_path ? `
                        <button type="button" class="btn-copy-id" onclick="copyTextToClipboard('${rawDownloadPath}', 'Đã sao chép đường dẫn file!')" title="Sao chép toàn bộ đường dẫn lưu">
                            <i class="fa-solid fa-copy"></i>
                        </button>` : ''}
                    </div>
                </td>
                <td data-col="col-actions" style="text-align:center;">
                    <div class="action-dropdown-wrap">
                        <button type="button" class="btn-more-actions" id="btn-more-video-${v.id}" 
                            onclick="toggleActionMenu(event, 'video-${v.id}')" 
                            title="Tùy chọn thao tác">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                        <div class="action-dropdown-menu" id="action-menu-video-${v.id}">
                            <button type="button" class="action-dropdown-item" onclick="switchTab('tab-video-studio'); selectStudioVideo('${escapeHtml(vKey)}'); closeAllActionMenus();">
                                <i class="fa-solid fa-wand-magic-sparkles text-cyan"></i> Mở Biên Tập 9:16
                            </button>
                            <button type="button" class="action-dropdown-item" onclick="copyVideoFilePath('${rawDownloadPath}'); closeAllActionMenus();">
                                <i class="fa-solid fa-copy text-gold"></i> Sao Chép Đường Dẫn
                            </button>
                            <button type="button" class="action-dropdown-item text-danger" onclick="deleteVideoLibraryItem(${v.id}); closeAllActionMenus();">
                                <i class="fa-solid fa-trash-can"></i> Xóa Video
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function resetVideoLibraryFilters() {
    const s = document.getElementById('videoLibSearchInput');
    const p = document.getElementById('videoLibPlatformFilter');
    const st = document.getElementById('videoLibStatusFilter');
    if (s) s.value = '';
    if (p) p.value = '';
    if (st) st.value = '';
    filterVideoLibrary(true);
}

function goToVideoLibPage(page) {
    videoLibCurrentPage = page;
    filterVideoLibrary(false);
}

function changeVideoLibPageSize(size) {
    videoLibPageSize = parseInt(size, 10) || 20;
    videoLibCurrentPage = 1;
    filterVideoLibrary(false);
}

async function deleteVideoLibraryItem(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa video #' + id + ' khỏi hệ thống?')) return;
    try {
        const res = await fetch(`/api/v2/videos/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadVideoLibraryTable();
        }
    } catch (e) {
        alert('Lỗi xóa video: ' + e.message);
    }
}

// Module Window Exposures
window.loadRssScanMode = loadRssScanMode;
window.toggleRssScanMode = toggleRssScanMode;
window.scanSelectedFolder = scanSelectedFolder;
window.ingestScannedVideos = ingestScannedVideos;
window.triggerMultiDownload = triggerMultiDownload;
window.loadElevenLabsInfo = loadElevenLabsInfo;
window.saveElevenApiKey = saveElevenApiKey;
window.previewElevenVoiceAudio = previewElevenVoiceAudio;
window.bindVoiceToSelectedChannel = bindVoiceToSelectedChannel;
window.generateTestTtsSpeech = generateTestTtsSpeech;
window.loadVideoLibraryTable = loadVideoLibraryTable;
window.deleteVideoLibraryItem = deleteVideoLibraryItem;
window.loadDirectDownloadSettings = loadDirectDownloadSettings;
window.browseDirectDownloadFolder = browseDirectDownloadFolder;
window.saveDirectDownloadDirFromInput = saveDirectDownloadDirFromInput;
window.resetDirectDownloadDirToDefault = resetDirectDownloadDirToDefault;
window.openVideoInStudio = openVideoInStudio;
window.filterVideoLibrary = filterVideoLibrary;
window.resetVideoLibraryFilters = resetVideoLibraryFilters;
window.copyVideoFilePath = copyVideoFilePath;
window.goToVideoLibPage = goToVideoLibPage;
window.changeVideoLibPageSize = changeVideoLibPageSize;

// Tự động nạp cấu hình thư mục khi tải trang
document.addEventListener('DOMContentLoaded', () => {
    loadDirectDownloadSettings();
});

