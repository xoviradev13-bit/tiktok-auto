// ==========================================
// 8. AUTOMATION PIPELINE, CAMPAIGNS & STUDIO
// ==========================================
function applyCachedSchedulerState() {
    try {
        const cached = localStorage.getItem('scheduler_running');
        if (cached === '0') {
            const masterLed = document.getElementById('masterSchedulerLed');
            const masterTitle = document.getElementById('masterSchedulerTitle');
            const masterBadge = document.getElementById('masterSchedulerBadge');
            const masterBtn = document.getElementById('btnToggleSchedulerMaster');
            const pipeScheduler = document.getElementById('pipelineSchedulerStatus');
            if (masterLed) masterLed.className = 'master-pulse-icon paused';
            if (masterTitle) masterTitle.textContent = 'HỆ THỐNG TỰ ĐỘNG: ĐÃ TẠM DỪNG';
            if (masterBadge) {
                masterBadge.className = 'badge badge-danger';
                masterBadge.textContent = 'Auto-Pilot Paused';
            }
            if (masterBtn) {
                masterBtn.className = 'btn btn-primary has-tooltip';
                masterBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span>Bật Tự Động</span>';
                masterBtn.setAttribute('data-tooltip', 'Khởi động hệ thống tự động: Quét RSS, tải, render & đăng bài');
                masterBtn.removeAttribute('title');
            }
            if (pipeScheduler) {
                pipeScheduler.className = 'badge badge-secondary';
                pipeScheduler.innerHTML = '<i class="fa-solid fa-pause"></i> Scheduler: Tạm Dừng';
            }
        }
    } catch (e) {
        // Ignore localStorage error if disabled
    }
}

let cachedPipelineVideos = [];

async function exportPipelineVideosCsv() {
    if (!cachedPipelineVideos || !cachedPipelineVideos.length) {
        try {
            await loadPipelineStatus();
        } catch (e) {
            console.warn('Lỗi tải pipeline trước khi xuất CSV:', e);
        }
    }
    if (!cachedPipelineVideos || !cachedPipelineVideos.length) {
        showToast('Chưa có dữ liệu tác vụ video nào để xuất CSV!', true);
        return;
    }
    const headers = [
        'ID Video',
        'Tiêu Đề Video',
        'Kênh Nguồn',
        'Channel ID',
        'Thời Lượng (giây)',
        'Trạng Thái Luồng',
        'Thời Gian Tạo'
    ];
    const rows = [headers];
    cachedPipelineVideos.forEach(v => {
        rows.push([
            v.id || '',
            v.title || '',
            v.channel_name || '',
            v.channel_id || '',
            v.duration ? Math.round(v.duration) : '',
            v.status || '',
            v.created_at || ''
        ]);
    });
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCsv(`tien_trinh_pipeline_video_${dateStr}.csv`, rows);
}

async function clearPipelineQueue(btn) {
    if (!confirm('Bạn có chắc chắn muốn XÓA TOÀN BỘ video đang chờ đăng trong hàng đợi?\n\n- Toàn bộ tác vụ chờ đăng sẽ bị hủy.\n- Các video thành phẩm đã render 9:16 sẽ được giải phóng và đưa trở lại trạng thái sẵn sàng để các chiến dịch có thể phân phối lại từ đầu.')) {
        return;
    }

    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.7';
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Đang xóa...</span>';
    }
    if (typeof showToast === 'function') {
        showToast('Đang xóa sạch hàng đợi và cập nhật trạng thái video...', 'info');
    }

    try {
        const res = await fetch('/api/pipeline/clear-queue', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.detail || data.message || 'Lỗi từ máy chủ');
        }
        if (typeof showToast === 'function') {
            showToast(data.message || '✅ Đã xóa sạch hàng đợi thành công!');
        }
        await loadPipelineStatus(false);
    } catch (err) {
        console.error('Lỗi khi xóa hàng đợi:', err);
        if (typeof showToast === 'function') {
            showToast('Lỗi xóa hàng đợi: ' + err.message, true);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
            btn.innerHTML = origHtml;
        }
    }
}
window.clearPipelineQueue = clearPipelineQueue;

async function loadPipelineStatus(isManual = false) {
    const btn = document.getElementById('btnRefreshPipelineQueue') || (isManual && window.event && window.event.target ? window.event.target.closest('button') : null);
    const icon = document.getElementById('iconRefreshPipelineQueue') || (btn ? btn.querySelector('i.fa-rotate, i.fa-spin') : null);

    if (isManual) {
        if (btn) {
            btn.disabled = true;
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.7';
        }
        if (icon) icon.classList.add('fa-spin');
        if (typeof showToast === 'function') {
            showToast('Đang làm mới tiến trình hàng đợi 4 công đoạn...', 'info');
        }
    }

    try {
        const res = await fetch('/api/pipeline/status');
        const data = await res.json();
        cachedPipelineVideos = data.recent_pipeline || [];

        if (data.scheduler_running !== undefined) {
            try {
                localStorage.setItem('scheduler_running', data.scheduler_running ? '1' : '0');
            } catch (e) { }
        }

        // 1. Top Badges
        const pipeActive = document.getElementById('pipeActiveChannels');
        if (pipeActive) pipeActive.textContent = `${data.active_channels || 0} Kênh Active`;

        const pipeDl = document.getElementById('pipeDownloadedCount');
        if (pipeDl) pipeDl.textContent = `${data.video_stats ? data.video_stats.downloaded : 0} Video Đã Tải`;

        const pipeRd = document.getElementById('pipeRenderedCount');
        if (pipeRd) pipeRd.textContent = `${data.video_stats ? data.video_stats.rendered : 0} Video Đã Render`;

        const pipeUp = document.getElementById('pipeUploadedCount');
        if (pipeUp) pipeUp.textContent = `${data.video_stats ? data.video_stats.uploaded : 0} Video Đã Đăng`;

        // 2. Master Banner Controls
        const masterLed = document.getElementById('masterSchedulerLed');
        const masterTitle = document.getElementById('masterSchedulerTitle');
        const masterBadge = document.getElementById('masterSchedulerBadge');
        const masterBtn = document.getElementById('btnToggleSchedulerMaster');
        const pipeScheduler = document.getElementById('pipelineSchedulerStatus');
        const interval = data.scheduler_interval_minutes || 15;

        const masterDesc = document.getElementById('masterSchedulerDesc');
        if (masterDesc) {
            masterDesc.innerHTML = `Chu kỳ quét RSS (${interval} phút) &rarr; Tự động tải MP4 &rarr; AI Render 9:16 Beta &rarr; Tự đăng lên tài khoản`;
        }
        const pipeRssMeta = document.getElementById('pipeRssIntervalMeta');
        if (pipeRssMeta) {
            pipeRssMeta.textContent = `Mỗi ${interval} phút qua XML YouTube`;
        }

        if (data.scheduler_running) {
            if (masterLed) masterLed.className = 'master-pulse-icon';
            if (masterTitle) masterTitle.textContent = 'HỆ THỐNG TỰ ĐỘNG: ĐANG HOẠT ĐỘNG';
            if (masterBadge) {
                masterBadge.className = 'badge badge-success';
                masterBadge.textContent = 'Auto-Pilot Active';
            }
            if (masterBtn) {
                masterBtn.className = 'btn btn-secondary has-tooltip';
                masterBtn.innerHTML = '<i class="fa-solid fa-pause"></i> <span>Tạm Dừng</span>';
                masterBtn.setAttribute('data-tooltip', `Tạm dừng toàn bộ quá trình tự động quét (${interval}p/lần) & đăng bài`);
                masterBtn.removeAttribute('title');
            }
            if (pipeScheduler) {
                pipeScheduler.className = 'badge badge-success';
                pipeScheduler.innerHTML = `<i class="fa-solid fa-circle-dot"></i> Scheduler: Đang Chạy (${interval}p/lần)`;
            }
        } else {
            if (masterLed) masterLed.className = 'master-pulse-icon paused';
            if (masterTitle) masterTitle.textContent = 'HỆ THỐNG TỰ ĐỘNG: ĐÃ TẠM DỪNG';
            if (masterBadge) {
                masterBadge.className = 'badge badge-danger';
                masterBadge.textContent = 'Auto-Pilot Paused';
            }
            if (masterBtn) {
                masterBtn.className = 'btn btn-primary has-tooltip';
                masterBtn.innerHTML = '<i class="fa-solid fa-play"></i> <span>Bật Tự Động</span>';
                masterBtn.setAttribute('data-tooltip', `Khởi động hệ thống tự động: Quét RSS ${interval}p/lần, tải, render 9:16 & đăng bài`);
                masterBtn.removeAttribute('title');
            }
            if (pipeScheduler) {
                pipeScheduler.className = 'badge badge-secondary';
                pipeScheduler.innerHTML = '<i class="fa-solid fa-pause"></i> Scheduler: Tạm Dừng';
            }
        }

        // 3. Raw Table
        const tbody = document.getElementById('pipelineTableBody');
        const recent = data.recent_pipeline || [];
        if (tbody) {
            if (!recent.length) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Chưa có video nào trong luồng xử lý. Hãy quét và lưu kênh để bắt đầu tải tự động!</td></tr>`;
            } else {
                tbody.innerHTML = recent.map(v => {
                    const statusBadgeMap = {
                        'pending': '<span class="badge badge-info"><i class="fa-solid fa-clock"></i> Chờ tải</span>',
                        'downloaded': '<span class="badge badge-blue"><i class="fa-solid fa-cloud-arrow-down"></i> Đã tải gốc</span>',
                        'rendering': '<span class="badge badge-purple"><i class="fa-solid fa-spinner fa-spin"></i> Đang render AI</span>',
                        'rendered': '<span class="badge badge-gold"><i class="fa-solid fa-wand-magic-sparkles"></i> Đã render 9:16</span>',
                        'queued': '<span class="badge badge-warning" style="color:#f59e0b; border:1px solid rgba(245,158,11,0.3); background:rgba(245,158,11,0.1);"><i class="fa-regular fa-clock"></i> Chờ đăng TikTok</span>',
                        'uploaded': '<span class="badge badge-success"><i class="fa-brands fa-tiktok"></i> Đã đăng</span>',
                        'error': '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi</span>'
                    };
                    const statusHtml = statusBadgeMap[v.status] || `<span class="badge">${escapeHtml(v.status)}</span>`;

                    return `
                        <tr>
                            <td>#${v.id}</td>
                            <td>
                                <div class="table-text-truncate" style="max-width: 240px;" title="${escapeHtml(v.title || 'Video #' + v.id)}">
                                    <strong>${escapeHtml(v.title || 'Video #' + v.id)}</strong>
                                </div>
                            </td>
                            <td>
                                <span class="badge badge-cyan table-text-truncate" style="max-width: 140px; display:inline-block; vertical-align:middle;" title="${escapeHtml(v.channel_name || 'Kênh ngoài')}">${escapeHtml(v.channel_name || 'Kênh ngoài')}</span>
                            </td>
                            <td>${v.duration ? v.duration + 's' : 'N/A'}</td>
                            <td>${statusHtml}</td>
                            <td><span style="font-size:12px; color:var(--text-muted);">${escapeHtml(v.created_at || '')}</span></td>
                            <td>
                                <button class="btn btn-sm btn-secondary" onclick="switchTab('tab-video-studio'); selectStudioVideo('${v.yt_video_id || v.id}')" title="Mở Studio xem trước & chỉnh sửa">
                                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }

        // 4. Kanban Columns
        renderKanbanPipeline(recent, data.recent_upload_tasks || []);

        if (isManual && typeof showToast === 'function') {
            const upTasks = data.recent_upload_tasks || [];
            const schedCount = upTasks.filter(t => t.status === 'queued' || t.status === 'processing' || t.status === 'failed').length;
            const renCount = data.video_stats ? data.video_stats.rendered : 0;
            const upCount = data.video_stats ? data.video_stats.uploaded : 0;
            showToast(`✅ Đã làm mới hàng đợi: ${schedCount} video chờ đăng, ${renCount} đã render, ${upCount} đã đăng!`);
        }
    } catch (err) {
        console.error('Lỗi khi tải trạng thái pipeline:', err);
        if (isManual && typeof showToast === 'function') {
            showToast('Lỗi khi làm mới hàng đợi: ' + err.message, true);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
        }
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 400);
        }
    }
}

function renderKanbanPipeline(videos, uploadTasks) {
    const colDl = document.getElementById('kanbanColDownloaded');
    const colRd = document.getElementById('kanbanColRendered');
    const colSc = document.getElementById('kanbanColScheduled');
    const colUp = document.getElementById('kanbanColUploaded');

    const cntDl = document.getElementById('kanbanCountDownloaded');
    const cntRd = document.getElementById('kanbanCountRendered');
    const cntSc = document.getElementById('kanbanCountScheduled');
    const cntUp = document.getElementById('kanbanCountUploaded');

    const downloaded = videos.filter(v => v.status === 'downloaded');
    const rendered = videos.filter(v => v.status === 'rendered');
    const scheduled = uploadTasks.filter(t => t.status === 'queued' || t.status === 'processing' || t.status === 'failed');
    const uploaded = uploadTasks.filter(t => t.status === 'completed');

    if (cntDl) cntDl.textContent = downloaded.length;
    if (cntRd) cntRd.textContent = rendered.length;
    if (cntSc) cntSc.textContent = scheduled.length;
    if (cntUp) cntUp.textContent = uploaded.length;

    const renderCard = (v, actionType) => `
        <div class="kanban-task-card">
            <strong style="font-size:12px; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(v.title || 'Video #' + v.id)}</strong>
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted);">
                <span><i class="fa-solid fa-clock"></i> ${v.duration || 65}s</span>
                <span class="badge badge-cyan" style="font-size:10px;">${escapeHtml(v.channel_name || 'Kênh')}</span>
            </div>
            <div style="display:flex; gap:6px; margin-top:4px;">
                ${actionType === 'render' ? `
                    <button class="btn btn-sm btn-primary" onclick="switchTab('tab-video-studio'); selectStudioVideo('${v.yt_video_id || v.id}')" style="width:100%; font-size:11px; padding:4px;">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Render 9:16
                    </button>
                ` : ''}
                ${actionType === 'upload' ? `
                    <button class="btn btn-sm btn-secondary" onclick="switchTab('tab-video-studio'); selectStudioVideo('${v.yt_video_id || v.id}')" style="flex:1; font-size:11px; padding:4px;">
                        <i class="fa-solid fa-eye"></i> Xem Thử
                    </button>
                    <button class="btn btn-sm btn-primary" onclick="openUploadModal('${v.id}')" style="flex:1; font-size:11px; padding:4px;">
                        <i class="fa-solid fa-cloud-arrow-up"></i> Đăng
                    </button>
                ` : ''}
            </div>
        </div>
    `;

    if (colDl) {
        colDl.innerHTML = downloaded.length ? downloaded.map(v => renderCard(v, 'render')).join('') : '<div class="text-center py-4 text-muted" style="font-size:11px;">Không có video chờ render</div>';
    }
    if (colRd) {
        colRd.innerHTML = rendered.length ? rendered.map(v => renderCard(v, 'upload')).join('') : '<div class="text-center py-4 text-muted" style="font-size:11px;">Không có video sẵn sàng</div>';
    }
    if (colSc) {
        colSc.innerHTML = scheduled.length ? scheduled.map(t => {
            const nick = t.tiktok_username ? (t.tiktok_username.startsWith('@') ? t.tiktok_username : '@' + t.tiktok_username) : (t.gpm_profile_name || 'Profile');
            const isFailed = t.status === 'failed';
            return `
            <div class="kanban-task-card" style="${isFailed ? 'border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.05);' : ''}">
                <strong style="font-size:12px; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${escapeHtml(t.video_title || t.title || 'Task #' + t.id)}">
                    ${escapeHtml(t.video_title || t.title || 'Task #' + t.id)}
                </strong>
                <div style="font-size:11px; color:${isFailed ? '#ef4444' : 'var(--accent-gold)'}; display:flex; align-items:center; gap:5px; margin-top:2px;">
                    <i class="fa-brands fa-tiktok"></i>
                    <strong>${escapeHtml(nick)}</strong>
                    ${isFailed ? '<span class="badge badge-danger" style="font-size:9px; padding:1px 4px;">Lỗi Đăng</span>' : ''}
                </div>
                ${isFailed ? `
                    <div style="font-size:10px; color:#f87171; margin-top:3px; display:flex; justify-content:space-between; align-items:center; gap:4px;">
                        <span title="${escapeHtml(t.error_message || 'Lỗi khi upload')}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">
                            <i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(t.error_message || 'Thất bại')}
                        </span>
                        <button class="btn btn-sm btn-warning" onclick="retryUploadTask(${t.id})" style="font-size:10px; padding:2px 7px; white-space:nowrap;">
                            <i class="fa-solid fa-rotate-right"></i> Thử Lại
                        </button>
                    </div>
                ` : `
                    <div style="font-size:10.5px; color:var(--text-muted); display:flex; align-items:center; gap:4px;">
                        <i class="fa-regular fa-clock"></i> Hẹn: ${escapeHtml(t.scheduled_time || 'Đang chờ')}
                    </div>
                `}
            </div>
            `;
        }).join('') : '<div class="text-center py-4 text-muted" style="font-size:11px;">Không có video lên lịch</div>';
    }
    if (colUp) {
        colUp.innerHTML = uploaded.length ? uploaded.map(t => {
            const nick = t.tiktok_username ? (t.tiktok_username.startsWith('@') ? t.tiktok_username : '@' + t.tiktok_username) : (t.gpm_profile_name || 'GPM');
            return `
            <div class="kanban-task-card">
                <strong style="font-size:12px; color:var(--text-primary); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;" title="${escapeHtml(t.video_title || t.title || 'Task #' + t.id)}">
                    ${escapeHtml(t.video_title || t.title || 'Task #' + t.id)}
                </strong>
                <div style="font-size:11px; color:var(--accent-green); display:flex; align-items:center; gap:5px; margin-top:2px;">
                    <i class="fa-solid fa-circle-check"></i>
                    <strong>${escapeHtml(nick)}</strong>
                </div>
                <div style="font-size:10.5px; color:var(--text-muted);">${escapeHtml(t.uploaded_at ? t.uploaded_at.substring(0, 16) : 'Đã hoàn tất')}</div>
            </div>
            `;
        }).join('') : '<div class="text-center py-4 text-muted" style="font-size:11px;">Chưa có bài đăng</div>';
    }
}

async function retryUploadTask(taskId) {
    try {
        const res = await fetch(`/api/pipeline/retry-upload/${taskId}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || 'Đã đưa tác vụ trở lại hàng đợi!', 'success');
            if (typeof loadPipelineStatus === 'function') loadPipelineStatus();
        } else {
            showToast(data.detail || 'Không thể thử lại tác vụ', 'error');
        }
    } catch (e) {
        showToast('Lỗi kết nối khi thử lại tác vụ: ' + e.message, 'error');
    }
}

async function triggerProcessUploads() {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Đăng Bài Tự Động')) {
        return;
    }
    try {
        const res = await fetch('/api/pipeline/process-uploads', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            showToast('Đang quét và tiến hành đăng video đến giờ...', 'info');
            setTimeout(() => {
                if (typeof loadPipelineStatus === 'function') loadPipelineStatus();
            }, 3000);
        } else {
            showToast(data.detail || 'Không thể kích hoạt đăng bài', 'error');
        }
    } catch (e) {
        showToast('Lỗi khi kích hoạt đăng bài: ' + e.message, 'error');
    }
}

// Master Scheduler Toggle
async function toggleMasterScheduler(btn) {
    const isCurrentlyRunning = localStorage.getItem('scheduler_running') === '1';
    if (!isCurrentlyRunning && window.LicenseManager && !window.LicenseManager.requireLicense('Bật Tự Động Hóa Auto-Pilot')) {
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Lưu...';
    }
    try {
        const res = await fetch('/api/pipeline/toggle-scheduler', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success' || data.scheduler_running !== undefined) {
            const isRun = data.running !== undefined ? data.running : data.scheduler_running;
            try {
                localStorage.setItem('scheduler_running', isRun ? '1' : '0');
            } catch (e) { }
            showToast(isRun ? 'Đã khởi động Scheduler tự động!' : 'Đã tạm dừng Scheduler tự động.');
            loadPipelineStatus();
        } else {
            showToast('Lỗi thay đổi trạng thái scheduler', true);
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, true);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Scan All Channels
async function scanAllChannelsPipeline(btn) {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Quét Kênh Ngay Lập Tức')) {
        return;
    }
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Quét...';
    }
    showToast('Đang quét RSS feed toàn bộ kênh đã lưu...');
    try {
        const res = await fetch('/api/pipeline/scan-all', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(`Quét hoàn tất: Tìm thấy và tải ${data.new_videos} video mới!`);
            loadPipelineStatus();
            loadVideos();
            loadDashboardStats();
        } else {
            showToast('Lỗi khi quét kênh: ' + (data.message || 'Thất bại'), true);
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// ==========================================
// 9. AUTO CAMPAIGNS HUB (CHIẾN DỊCH TỰ ĐỘNG)
// ==========================================
let campaignCurrentPage = 1;
let campaignPageSize = 10;

function renderCampaignCard(c) {
    const chCount = c.channel_count || (c.channel_ids_list ? c.channel_ids_list.length : 1);
    const gpmCount = c.gpm_count || (c.gpm_profile_ids_list ? c.gpm_profile_ids_list.length : 1);
    const chTitle = chCount > 1 ? `${chCount} Kênh YouTube Nguồn` : (c.channel_name || 'Kênh nguồn');
    const gpmTitle = gpmCount > 1 ? `${gpmCount} Dàn Account` : (c.gpm_profile_name ? '@' + (c.tiktok_username || c.gpm_profile_name) : 'Nick');

    const distBadge = c.distribution_mode === 'parallel_slots'
        ? '<span class="badge badge-green" title="Lấp đầy các khung giờ song song cho toàn bộ nick có Proxy riêng"><i class="fa-solid fa-bolt"></i> Song Song Giờ Vàng (Proxy Riêng)</span>'
        : (c.distribution_mode === 'round_robin'
            ? '<span class="badge badge-cyan" title="Chống trùng: chia vòng tròn clip"><i class="fa-solid fa-arrows-spin"></i> Round-Robin (Không trùng)</span>'
            : (c.distribution_mode === 'single_best'
                ? '<span class="badge badge-gold" title="Ưu tiên nick có điểm uy tín và follower cao nhất"><i class="fa-solid fa-star"></i> Điểm Uy Tín Cao Nhất</span>'
                : (c.distribution_mode === 'equal_random' || c.distribution_mode === 'random'
                    ? '<span class="badge badge-purple"><i class="fa-solid fa-shuffle"></i> Ngẫu Nhiên</span>'
                    : '<span class="badge badge-gold"><i class="fa-solid fa-bullhorn"></i> Đăng Toàn Bộ</span>')));

    let freqBadge = '';
    let freqText = 'Mỗi ngày';
    if (c.post_frequency === 'every_2_days') {
        freqBadge = '<span class="badge badge-purple" title="Đăng cách 2 ngày 1 lần"><i class="fa-solid fa-calendar-days"></i> Cách 2 ngày</span>';
        freqText = 'Cách 2 ngày/lần';
    } else if (c.post_frequency === 'every_3_days') {
        freqBadge = '<span class="badge badge-purple" title="Đăng cách 3 ngày 1 lần"><i class="fa-solid fa-calendar-days"></i> Cách 3 ngày</span>';
        freqText = 'Cách 3 ngày/lần';
    } else if (c.post_frequency === 'specific_days') {
        const daysMap = { 'mon': 'T2', 'tue': 'T3', 'wed': 'T4', 'thu': 'T5', 'fri': 'T6', 'sat': 'T7', 'sun': 'CN' };
        const daysStr = (c.post_days_of_week || '').split(',').map(d => daysMap[d.trim()] || d).join(', ');
        freqBadge = `<span class="badge badge-cyan" title="Các ngày: ${daysStr}"><i class="fa-solid fa-calendar-check"></i> ${daysStr}</span>`;
        freqText = daysStr;
    } else if (c.post_frequency === 'custom_interval') {
        freqBadge = `<span class="badge badge-purple" title="Khoảng cách: ${c.post_interval_days} ngày"><i class="fa-solid fa-hourglass-half"></i> Cách ${c.post_interval_days} ngày</span>`;
        freqText = `Cách ${c.post_interval_days} ngày`;
    } else {
        freqBadge = '<span class="badge badge-blue"><i class="fa-solid fa-calendar-days"></i> Mỗi ngày</span>';
    }

    const isWarmupOnly = (c.warmup_only === 1);
    const warmupBadge = isWarmupOnly
        ? `<span class="badge" style="background:rgba(234,179,8,0.18); color:#eab308; border:1px solid rgba(234,179,8,0.3); font-size:10.5px; padding:2px 8px; border-radius:4px;" title="Chiến dịch Chỉ Lướt Nuôi Nick (Không tải, không edit, không đăng)"><i class="fa-solid fa-fire"></i> Chỉ Lướt Nuôi Nick (${c.warmup_duration_mins || 10}p)</span>`
        : (c.warmup_mode ? '<span class="badge badge-gold" title="Chế độ warm-up nuôi nick mới"><i class="fa-solid fa-seedling"></i> Warm-up + Đăng</span>' : '');
    const uploadBadge = isWarmupOnly
        ? '<span class="badge" style="background:rgba(234,179,8,0.12); color:#eab308; border:1px solid rgba(234,179,8,0.25);" title="Chỉ lướt feed TikTok nuôi nick, không đăng video"><i class="fa-solid fa-fire"></i> Pure Warm-up</span>'
        : ((c.auto_upload === 0)
            ? '<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);" title="Chỉ tải và render video về máy, không upload lên TikTok"><i class="fa-solid fa-film"></i> Chỉ Render</span>'
            : '<span class="badge" style="background:rgba(16,185,129,0.12); color:#10b981; border:1px solid rgba(16,185,129,0.25);" title="Tự động upload lên dàn Account"><i class="fa-brands fa-tiktok"></i> Auto Upload</span>');

    const narrationBadge = (c.narration_enabled === 1)
        ? `<span class="badge" style="background:rgba(192, 132, 252, 0.15); color:#c084fc; border:1px solid rgba(192, 132, 252, 0.3); font-size:10.5px; padding:2px 6px;" title="Lồng tiếng AI & phụ đề đồng bộ: ${escapeHtml(c.narration_language || 'Gốc')}, Giọng: ${c.voice_gender === 'female' ? 'Nữ' : 'Nam'}, Style: ${c.narration_style || 'Giật gân'}"><i class="fa-solid fa-microphone-lines"></i> Lồng tiếng AI (${escapeHtml(c.narration_language || 'Gốc')})</span>`
        : '';

    const subBadge = c.subtitle_enabled
        ? `<span class="badge badge-gold" title="Phong cách: ${escapeHtml(c.subtitle_style || '')}"><i class="fa-solid fa-closed-captioning"></i> Phụ Đề AI Karaoke</span>`
        : '<span class="badge badge-secondary">Không phụ đề</span>';

    const dlDir = c.download_dir || 'data/downloads';
    const rdDir = c.render_dir || 'data/rendered';

    const filterTypes = [];
    if (c.include_shorts !== 0) filterTypes.push('Shorts');
    if (c.include_longform !== 0) filterTypes.push('Video Dài');
    const filterBadge = filterTypes.length > 0
        ? `<span class="badge badge-secondary" style="font-size:10px; margin-top:3px;" title="Bộ lọc định dạng tải"><i class="fa-solid fa-filter"></i> ${filterTypes.join(' + ')}</span>`
        : '';

    return `
    <div class="campaign-card ${c.is_active ? '' : 'campaign-paused'}">
        <div class="campaign-header-row">
            <div class="campaign-header-left">
                <span class="badge ${c.is_active ? 'badge-success' : 'badge-secondary'}">
                    <i class="fa-solid fa-circle-dot"></i> ${c.is_active ? 'Đang Chạy Auto' : 'Tạm Dừng'}
                </span>
                ${uploadBadge}
                <h4 class="campaign-card-title has-tooltip" title="${escapeHtml(c.name)}" data-tooltip="${escapeHtml(c.name)}">${escapeHtml(c.name)}</h4>
                ${distBadge}
                ${freqBadge}
                ${warmupBadge}
            </div>
            <div class="campaign-header-actions">
                ${isWarmupOnly ? `
                <button class="btn btn-sm btn-secondary has-tooltip" onclick="triggerCampaignWarmupNow(${c.id}, this)" data-tooltip="Khởi động phiên lướt TikTok nuôi nick ngay cho dàn profile này">
                    <i class="fa-solid fa-fire text-warning"></i> Nuôi Nick Ngay
                </button>
                ` : `
                <button class="btn btn-sm btn-secondary has-tooltip" id="btnDirectRun_${c.id}" onclick="triggerDirectCampaignRun(${c.id}, '${escapeHtml(c.name).replace(/'/g, "\\'")}', this)" data-tooltip="Quét RSS & chạy thử biên tập AI cho chiến dịch này ngay (Bấm lại để dừng)">
                    <i class="fa-solid fa-bolt text-gold"></i> Chạy Thử
                </button>
                `}
                <button class="btn btn-sm btn-secondary has-tooltip" onclick="openCampaignLogs(${c.id}, '${escapeHtml(c.name).replace(/'/g, "\\'")}')" data-tooltip="Xem dữ liệu & nhật ký hoạt động chiến dịch này">
                    <i class="fa-solid fa-list-check text-cyan"></i> Nhật Ký
                </button>
                <button class="btn btn-sm btn-secondary has-tooltip" onclick="openEditCampaignModal(${c.id})" data-tooltip="Chỉnh sửa cấu hình chiến dịch này">
                    <i class="fa-solid fa-pen-to-square text-cyan"></i> Sửa
                </button>
                <button class="btn btn-sm ${c.is_active ? 'btn-secondary' : 'btn-success'} has-tooltip" onclick="toggleCampaign(${c.id}, this)" data-tooltip="${c.is_active ? 'Tạm dừng quy trình tự động của chiến dịch này' : 'Bật chạy lại chiến dịch này'}">
                    <i class="fa-solid ${c.is_active ? 'fa-pause' : 'fa-play'}"></i> ${c.is_active ? 'Tạm Dừng' : 'Kích Hoạt'}
                </button>
                <button class="btn btn-sm btn-danger has-tooltip tooltip-left" onclick="deleteCampaign(${c.id})" data-tooltip="Xóa vĩnh viễn chiến dịch này">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>

        <div class="campaign-pipeline-flow">
            <!-- Node 1: Multi-Channels Source -->
            <div class="pipeline-node">
                <div class="node-icon bg-blue"><i class="fa-brands fa-youtube" style="color:#ff0000;"></i></div>
                <div class="node-text">
                    <h5 title="${escapeHtml(chTitle)}">${escapeHtml(chTitle)}</h5>
                    <p title="${escapeHtml(chCount > 1 ? `Nhóm ${chCount} kênh lấy video tự động` : 'Quét RSS mỗi 15 phút')}">${chCount > 1 ? `Nhóm ${chCount} kênh lấy video tự động` : 'Quét RSS mỗi 15 phút'}</p>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                        <span class="pipeline-dir-tag" title="Thư mục tải MP4 gốc: ${escapeHtml(dlDir)}"><i class="fa-regular fa-folder"></i> ${escapeHtml(dlDir)}</span>
                        ${filterBadge}
                    </div>
                </div>
            </div>

            <div class="flow-step-arrow"><i class="fa-solid fa-arrow-right"></i></div>

            <!-- Node 2: Edit Recipe, Folders & Subtitles -->
            <div class="pipeline-node">
                <div class="node-icon bg-purple"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
                <div class="node-text">
                    <h5 title="${escapeHtml(c.aspect_ratio === '9:16_blur' ? '9:16 Nền Mờ' : (c.preset_name || 'Chuẩn Beta 9:16'))}">${escapeHtml(c.aspect_ratio === '9:16_blur' ? '9:16 Nền Mờ' : (c.preset_name || 'Chuẩn Beta 9:16'))}</h5>
                    <p title="${c.video_duration || 65}s Beta • Speed x${c.speed_factor} • ${c.flip_horizontal ? 'Lật hình' : 'Gốc'} • ${c.clips_per_video || 3} clips/video • ${c.add_part_label !== 0 ? 'Hiện Part' : 'Ẩn Part'}">${c.video_duration || 65}s Beta • Speed x${c.speed_factor} • ${c.flip_horizontal ? 'Lật hình' : 'Gốc'} • <strong>${c.clips_per_video || 3} clips/video</strong> • <span style="color:${c.add_part_label !== 0 ? 'var(--accent-cyan)' : 'var(--text-muted)'}; font-weight:600;">${c.add_part_label !== 0 ? 'Hiện Part' : 'Ẩn Part'}</span></p>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:3px;">${subBadge}${narrationBadge}</div>
                    <span class="pipeline-dir-tag" title="Thư mục lưu video 9:16: ${escapeHtml(rdDir)}"><i class="fa-solid fa-folder-open"></i> ${escapeHtml(rdDir)}</span>
                </div>
            </div>

            <div class="flow-step-arrow"><i class="fa-solid fa-arrow-right"></i></div>

            <!-- Node 3: Target Multi-Profiles & Schedule -->
            <div class="pipeline-node">
                <div class="node-icon bg-gold"><i class="fa-brands fa-tiktok"></i></div>
                <div class="node-text">
                    <h5 title="${escapeHtml(gpmTitle)}">${escapeHtml(gpmTitle)}</h5>
                    <p title="${escapeHtml(freqText)} • ${c.daily_limit} video/ngày">${freqText} • ${c.daily_limit} video/ngày</p>
                    <span class="pipeline-dir-tag" style="color:var(--accent-gold);" title="Khung giờ: ${escapeHtml(c.post_schedule || '11:30, 18:00, 20:30')}${c.random_delay_minutes ? ' (±' + c.random_delay_minutes + 'p)' : ''}"><i class="fa-regular fa-clock"></i> Khung: ${escapeHtml(c.post_schedule || '11:30, 18:00, 20:30')}${c.random_delay_minutes ? ' (&plusmn;' + c.random_delay_minutes + 'p)' : ''}</span>
                    <span class="pipeline-dir-tag" style="color:#10b981; margin-top:2px;" title="Giãn cách an toàn tối thiểu giữa các lần đăng trên cùng 1 nick"><i class="fa-solid fa-hourglass-half"></i> Giãn cách: ${c.min_post_interval_minutes ? c.min_post_interval_minutes + 'p' : 'Toàn cục'}</span>
                </div>
            </div>
        </div>

        <div class="campaign-footer-row">
            <div class="campaign-footer-meta">
                <span class="campaign-footer-meta-item">
                    <i class="fa-regular fa-calendar" style="color:var(--text-muted);"></i> Tạo lúc: ${escapeHtml(c.created_at || '')}
                </span>
                <span class="campaign-footer-meta-item" style="color:var(--accent-cyan);">
                    <i class="fa-solid fa-bolt"></i> Phân phối: ${chCount} kênh &rarr; ${gpmCount} nick (${c.distribution_mode === 'round_robin' ? 'Xoay vòng không trùng clip' : 'Chia đều'})
                </span>
            </div>
            <a href="javascript:void(0)" onclick="openCampaignLogs(${c.id}, '${escapeHtml(c.name)}')" class="campaign-history-link has-tooltip" data-tooltip="Xem nhật ký & tỷ lệ thành công">
                <i class="fa-solid fa-chart-line"></i> Xem Lịch Sử Hoạt Động &rarr;
            </a>
        </div>
    </div>
    `;
}

function filterAndRenderCampaigns() {
    const grid = document.getElementById('campaignsFlowGrid');
    if (!grid) return;
    const campaigns = cachedCampaigns || [];

    const stepperCamp = document.getElementById('stepperCampaignStats');
    if (stepperCamp) {
        const activeCount = campaigns.filter(c => c.is_active === 1).length;
        stepperCamp.textContent = `${activeCount} chiến dịch đang chạy`;
    }

    if (!campaigns.length) {
        grid.innerHTML = `
            <div class="card-empty-state">
                <i class="fa-solid fa-robot"></i>
                <h4>Chưa có chiến dịch tự động nào</h4>
                <p>Hãy tạo chiến dịch đầu tiên để kết nối Kênh YouTube nguồn với công thức Edit và Nick TikTok nhận video.</p>
                <button class="btn btn-primary mt-3" onclick="openNewCampaignModal()" style="display:inline-flex; align-items:center; justify-content:center; gap:8px;">
                    <i class="fa-solid fa-plus"></i> <span>Tạo Chiến Dịch Tự Động Đầu Tiên</span>
                </button>
            </div>
        `;
        const paginationBar = document.getElementById('campaignsPaginationBar');
        if (paginationBar) paginationBar.style.display = 'none';
        return;
    }

    const keyword = (document.getElementById('searchCampaignKeyword')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('filterCampaignStatus')?.value || 'ALL';

    const filtered = campaigns.filter(c => {
        // Trạng thái hoạt động
        if (statusFilter === 'ACTIVE' && c.is_active !== 1) return false;
        if (statusFilter === 'PAUSED' && c.is_active !== 0) return false;

        // Từ khóa tìm kiếm
        if (keyword) {
            const name = (c.name || '').toLowerCase();
            const chName = (c.channel_name || '').toLowerCase();
            const gpmName = (c.gpm_profile_name || '').toLowerCase();
            const uName = (c.tiktok_username || '').toLowerCase();
            const preset = (c.preset_name || '').toLowerCase();
            const match = name.includes(keyword) || chName.includes(keyword) || gpmName.includes(keyword) || uName.includes(keyword) || preset.includes(keyword);
            if (!match) return false;
        }
        return true;
    });

    const badgeCount = document.getElementById('badgeCampaignCount');
    if (badgeCount) {
        badgeCount.textContent = `${filtered.length}/${campaigns.length} Chiến Dịch`;
    }

    const paginationBar = document.getElementById('campaignsPaginationBar');
    if (paginationBar) paginationBar.style.display = 'flex';

    if (!filtered.length) {
        grid.innerHTML = `
            <div class="card-empty-state" style="padding:32px 20px;">
                <i class="fa-solid fa-magnifying-glass" style="font-size:26px; opacity:0.4; margin-bottom:8px;"></i>
                <h4>Không tìm thấy chiến dịch phù hợp</h4>
                <p style="color:var(--text-muted); font-size:12.5px;">Không có chiến dịch nào khớp với từ khóa "<strong>${escapeHtml(keyword)}</strong>".</p>
                <button class="btn btn-sm btn-secondary mt-2" onclick="document.getElementById('searchCampaignKeyword').value=''; document.getElementById('filterCampaignStatus').value='ALL'; filterAndRenderCampaigns();">
                    <i class="fa-solid fa-rotate-left"></i> Đặt lại bộ lọc tìm kiếm
                </button>
            </div>
        `;
        const navEl = document.getElementById('campaignsPaginationNav');
        if (navEl) navEl.innerHTML = '';
        const infoEl = document.getElementById('campaignsPaginationInfo');
        if (infoEl) infoEl.textContent = '0 chiến dịch';
        return;
    }

    const totalPages = Math.ceil(filtered.length / campaignPageSize) || 1;
    if (campaignCurrentPage > totalPages) campaignCurrentPage = totalPages;
    if (campaignCurrentPage < 1) campaignCurrentPage = 1;

    const startIdx = (campaignCurrentPage - 1) * campaignPageSize;
    const endIdx = Math.min(startIdx + campaignPageSize, filtered.length);
    const pagedList = filtered.slice(startIdx, endIdx);

    grid.innerHTML = pagedList.map(renderCampaignCard).join('');

    // Cập nhật thông tin phân trang
    const infoEl = document.getElementById('campaignsPaginationInfo');
    if (infoEl) {
        infoEl.textContent = `Hiển thị ${startIdx + 1} - ${endIdx} / ${filtered.length} chiến dịch`;
    }

    // Cập nhật thanh điều hướng phân trang (nằm gọn gàng bên phải)
    const navEl = document.getElementById('campaignsPaginationNav');
    if (navEl) {
        navEl.innerHTML = `
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToCampaignPage(1)" ${campaignCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang đầu">
                <i class="fa-solid fa-angles-left"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToCampaignPage(${campaignCurrentPage - 1})" ${campaignCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang trước">
                <i class="fa-solid fa-angle-left"></i>
            </button>
            <span style="font-size: 12px; font-weight: 600; padding: 0 10px; color: var(--text-primary); white-space: nowrap;">
                Trang ${campaignCurrentPage} / ${totalPages}
            </span>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToCampaignPage(${campaignCurrentPage + 1})" ${campaignCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang sau">
                <i class="fa-solid fa-angle-right"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToCampaignPage(${totalPages})" ${campaignCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang cuối">
                <i class="fa-solid fa-angles-right"></i>
            </button>
        `;
    }
}

function goToCampaignPage(page) {
    campaignCurrentPage = page;
    filterAndRenderCampaigns();
}

function changeCampaignsPageSize(size) {
    campaignPageSize = parseInt(size, 10) || 10;
    campaignCurrentPage = 1;
    filterAndRenderCampaigns();
}

async function loadCampaigns(btnOrManual = false) {
    let btn = null;
    let icon = null;
    let isManual = Boolean(btnOrManual);

    if (btnOrManual instanceof HTMLElement) {
        btn = btnOrManual;
        icon = btn.querySelector('i.fa-rotate, i.fa-spin');
        isManual = true;
    } else if (btnOrManual === true) {
        btn = document.getElementById('btnRefreshCampaigns');
        icon = document.getElementById('iconRefreshCampaigns') || (btn ? btn.querySelector('i.fa-rotate, i.fa-spin') : null);
    }

    if (isManual) {
        if (btn) {
            btn.disabled = true;
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.7';
        }
        if (icon) icon.classList.add('fa-spin');
        if (typeof showToast === 'function') {
            showToast('Đang làm mới danh sách chiến dịch...', 'info');
        }
    }

    try {
        const res = await fetch('/api/campaigns');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const campaigns = await res.json();
        cachedCampaigns = campaigns;
        filterAndRenderCampaigns();

        if (isManual && typeof showToast === 'function') {
            showToast(`✅ Đã làm mới danh sách: ${campaigns.length} chiến dịch!`);
        }
    } catch (err) {
        console.error('Lỗi nạp chiến dịch:', err);
        if (isManual && typeof showToast === 'function') {
            showToast('Lỗi tải chiến dịch: ' + err.message, true);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.pointerEvents = '';
            btn.style.opacity = '';
        }
        if (icon) {
            setTimeout(() => icon.classList.remove('fa-spin'), 400);
        }
    }
}

// Global cached lists for modal
let modalAllSavedChannels = [];
let modalAllGpmProfiles = [];
let modalAvailableSavedChannels = [];
let modalAvailableGpmProfiles = [];
let editModalAvailableSavedChannels = [];
let editModalAvailableGpmProfiles = [];

function getUsedCampaignResources(excludeCampaignId = null) {
    const usedChannelIds = new Set();
    const usedProfileIds = new Set();

    const camps = cachedCampaigns || [];
    camps.forEach(c => {
        if (excludeCampaignId !== null && Number(c.id) === Number(excludeCampaignId)) {
            return;
        }

        // Extract channel IDs
        let chList = c.channel_ids_list;
        if (!Array.isArray(chList)) {
            if (typeof c.channel_ids === 'string') {
                try { chList = JSON.parse(c.channel_ids); } catch (_) { chList = []; }
            } else if (Array.isArray(c.channel_ids)) {
                chList = c.channel_ids;
            } else if (c.channel_id) {
                chList = [c.channel_id];
            }
        }
        if (Array.isArray(chList)) {
            chList.forEach(id => {
                if (id) usedChannelIds.add(String(id).trim());
            });
        }

        // Extract GPM Profile IDs
        let gpmList = c.gpm_profile_ids_list;
        if (!Array.isArray(gpmList)) {
            if (typeof c.gpm_profile_ids === 'string') {
                try { gpmList = JSON.parse(c.gpm_profile_ids); } catch (_) { gpmList = []; }
            } else if (Array.isArray(c.gpm_profile_ids)) {
                gpmList = c.gpm_profile_ids;
            } else if (c.gpm_profile_id) {
                gpmList = [c.gpm_profile_id];
            }
        }
        if (Array.isArray(gpmList)) {
            gpmList.forEach(id => {
                if (id !== undefined && id !== null && id !== '') {
                    usedProfileIds.add(String(id).trim());
                }
            });
        }
    });

    return { usedChannelIds, usedProfileIds };
}
window.getUsedCampaignResources = getUsedCampaignResources;

// Sorting & Group state for Campaign Modals
let campaignChannelsSortAsc = true;
let campaignGpmSortAsc = true;
let editCampaignChannelsSortAsc = true;
let editCampaignGpmSortAsc = true;

function getCampaignProfileGroupName(p) {
    if (typeof getProfileGroupName === 'function') {
        return getProfileGroupName(p);
    }
    if (!p) return '';
    const isUuid = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const name = (p.group_name || '').trim();
    if (name && !isUuid(name)) return name;
    const id = (p.group_id || '').trim();
    if (id && !isUuid(id)) return id;
    if ((name && isUuid(name)) || (id && isUuid(id))) {
        return 'Default group';
    }
    return '';
}
window.getCampaignProfileGroupName = getCampaignProfileGroupName;

function updateCampaignSortBtnUI(btnId, iconId, textId, isAsc) {
    const icon = document.getElementById(iconId);
    const text = document.getElementById(textId);
    if (icon) {
        icon.className = isAsc ? 'fa-solid fa-arrow-down-short-wide' : 'fa-solid fa-arrow-up-wide-short';
    }
    if (text) {
        text.textContent = isAsc ? 'Tăng dần' : 'Giảm dần';
    }
}
window.updateCampaignSortBtnUI = updateCampaignSortBtnUI;

function toggleSortCampaignChannels() {
    campaignChannelsSortAsc = !campaignChannelsSortAsc;
    updateCampaignSortBtnUI('btnSortCampaignChannels', 'sortCampaignChannelsIcon', 'sortCampaignChannelsText', campaignChannelsSortAsc);
    const checkedIds = Array.from(document.querySelectorAll('#campaignChannelsList .campaign-ch-check:checked')).map(el => el.value);
    const listToRender = modalAvailableSavedChannels && modalAvailableSavedChannels.length ? modalAvailableSavedChannels : modalAllSavedChannels;
    renderCampaignChannelsCheckboxes(listToRender, checkedIds);
    filterCampaignChannelList();
}
window.toggleSortCampaignChannels = toggleSortCampaignChannels;

function toggleSortCampaignGpm() {
    campaignGpmSortAsc = !campaignGpmSortAsc;
    updateCampaignSortBtnUI('btnSortCampaignGpm', 'sortCampaignGpmIcon', 'sortCampaignGpmText', campaignGpmSortAsc);
    const checkedProfileIds = Array.from(document.querySelectorAll('#campaignGpmList .campaign-gpm-check:checked')).map(el => el.value);
    const listToRender = modalAvailableGpmProfiles && modalAvailableGpmProfiles.length ? modalAvailableGpmProfiles : modalAllGpmProfiles;
    renderCampaignGpmCheckboxes(listToRender, checkedProfileIds);
    filterCampaignGpmAccounts('new');
}
window.toggleSortCampaignGpm = toggleSortCampaignGpm;

function toggleEditSortCampaignChannels() {
    editCampaignChannelsSortAsc = !editCampaignChannelsSortAsc;
    updateCampaignSortBtnUI('btnEditSortCampaignChannels', 'editSortCampaignChannelsIcon', 'editSortCampaignChannelsText', editCampaignChannelsSortAsc);
    const checkedIds = Array.from(document.querySelectorAll('#editCampaignChannelsList .edit-campaign-ch-check:checked')).map(el => el.value);
    const listToRender = editModalAvailableSavedChannels && editModalAvailableSavedChannels.length ? editModalAvailableSavedChannels : modalAllSavedChannels;
    renderEditCampaignChannelsCheckboxes(listToRender, checkedIds);
    filterEditCampaignChannelList();
}
window.toggleEditSortCampaignChannels = toggleEditSortCampaignChannels;

function toggleEditSortCampaignGpm() {
    editCampaignGpmSortAsc = !editCampaignGpmSortAsc;
    updateCampaignSortBtnUI('btnEditSortCampaignGpm', 'editSortCampaignGpmIcon', 'editSortCampaignGpmText', editCampaignGpmSortAsc);
    const checkedProfileIds = Array.from(document.querySelectorAll('#editCampaignGpmList .edit-campaign-gpm-check:checked')).map(el => el.value);
    const listToRender = editModalAvailableGpmProfiles && editModalAvailableGpmProfiles.length ? editModalAvailableGpmProfiles : modalAllGpmProfiles;
    renderEditCampaignGpmCheckboxes(listToRender, checkedProfileIds);
    filterCampaignGpmAccounts('edit');
}
window.toggleEditSortCampaignGpm = toggleEditSortCampaignGpm;

async function populateCampaignGroupFilters(mode = 'both') {
    // 1. YouTube Channel Groups
    let groups = window.cachedChannelGroups || [];
    if (!groups.length) {
        try {
            const res = await fetch('/api/channel-groups');
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'success' && data.groups) {
                    groups = data.groups;
                    window.cachedChannelGroups = groups;
                }
            } else {
                const resAlt = await fetch('/api/youtube/groups');
                if (resAlt.ok) {
                    const dataAlt = await resAlt.json();
                    if (dataAlt.status === 'success' && dataAlt.groups) {
                        groups = dataAlt.groups;
                        window.cachedChannelGroups = groups;
                    }
                }
            }
        } catch (_) { }
    }

    const fillChannelGroupSelect = (selId) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const curVal = sel.value || 'all';
        let html = '<option value="all">Tất cả nhóm</option><option value="ungrouped">Chưa phân nhóm</option>';
        groups.forEach(g => {
            const rawName = g.name || 'Nhóm';
            const displayName = rawName.length > 22 ? (rawName.substring(0, 21) + '…') : rawName;
            html += `<option value="${g.id}" title="${escapeHtml(rawName)}">${escapeHtml(displayName)} (${g.channel_count || 0})</option>`;
        });
        sel.innerHTML = html;
        if (curVal) sel.value = curVal;
    };

    if (mode === 'new' || mode === 'both') {
        fillChannelGroupSelect('campaignChannelGroupFilter');
    }
    if (mode === 'edit' || mode === 'both') {
        fillChannelGroupSelect('editCampaignChannelGroupFilter');
    }

    // 2. GPM Profile Groups
    const fillGpmGroupSelect = (selId, profilesList) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const curVal = sel.value || 'all';
        const groupCountMap = new Map();
        let ungroupedCount = 0;

        (profilesList || []).forEach(p => {
            const grp = getCampaignProfileGroupName(p);
            if (grp) {
                groupCountMap.set(grp, (groupCountMap.get(grp) || 0) + 1);
            } else {
                ungroupedCount++;
            }
        });

        let html = '<option value="all">Tất cả nhóm</option>';
        if (ungroupedCount > 0) {
            html += `<option value="ungrouped">Chưa phân nhóm (${ungroupedCount})</option>`;
        }
        const sortedGroups = Array.from(groupCountMap.keys()).sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
        sortedGroups.forEach(grp => {
            const count = groupCountMap.get(grp);
            const displayName = grp.length > 22 ? (grp.substring(0, 21) + '…') : grp;
            html += `<option value="${escapeHtml(grp)}" title="${escapeHtml(grp)}">${escapeHtml(displayName)} (${count})</option>`;
        });
        sel.innerHTML = html;
        if (curVal) sel.value = curVal;
    };

    if (mode === 'new' || mode === 'both') {
        const newProfiles = modalAvailableGpmProfiles && modalAvailableGpmProfiles.length ? modalAvailableGpmProfiles : modalAllGpmProfiles;
        fillGpmGroupSelect('campaignGpmGroupFilter', newProfiles);
        if (typeof filterCampaignChannelList === 'function') filterCampaignChannelList();
        if (typeof filterCampaignGpmAccounts === 'function') filterCampaignGpmAccounts('new');
    }
    if (mode === 'edit' || mode === 'both') {
        const editProfiles = editModalAvailableGpmProfiles && editModalAvailableGpmProfiles.length ? editModalAvailableGpmProfiles : modalAllGpmProfiles;
        fillGpmGroupSelect('editCampaignGpmGroupFilter', editProfiles);
        if (typeof filterEditCampaignChannelList === 'function') filterEditCampaignChannelList();
        if (typeof filterCampaignGpmAccounts === 'function') filterCampaignGpmAccounts('edit');
    }
}
window.populateCampaignGroupFilters = populateCampaignGroupFilters;

// ========================================================
// 6-TAB CAMPAIGN MODAL LOGIC & HELPERS
// ========================================================
function switchModalTab(prefix, tabName) {
    const modalId = (prefix === 'new') ? 'newCampaignModal' : 'editCampaignModal';
    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.querySelectorAll('.modal-tab-nav').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    modal.querySelectorAll('.modal-tab-pane').forEach(pane => {
        if (pane.id === `${prefix}CampPane-${tabName}`) {
            pane.classList.add('active');
            pane.style.display = 'flex';
        } else {
            pane.classList.remove('active');
            pane.style.display = 'none';
        }
    });
}
window.switchModalTab = switchModalTab;

function updateCampaignSourceModeUI(prefix, mode) {
    const p = (prefix === 'new') ? 'campaign' : 'editCampaign';
    const ytSection = document.getElementById(`${p}YoutubeSourceSection`);
    if (ytSection) ytSection.style.display = 'block';
}
window.updateCampaignSourceModeUI = updateCampaignSourceModeUI;

function updateSourceModeBadge(mode) {
    // Mode is always YouTube channels
}
window.updateSourceModeBadge = updateSourceModeBadge;

function toggleCampaignTtsEngine(prefix, engine) { }
window.toggleCampaignTtsEngine = toggleCampaignTtsEngine;
function toggleChannelTtsEngine(engine) { }
window.toggleChannelTtsEngine = toggleChannelTtsEngine;
function toggleStudioTtsEngine(engine) { }
window.toggleStudioTtsEngine = toggleStudioTtsEngine;
function populateElevenLabsVoicesToSelect(selectElId, selectedVoiceId = '') { }
window.populateElevenLabsVoicesToSelect = populateElevenLabsVoicesToSelect;
function populateCampaignElevenLabsVoices(prefix, selectedVoiceId = '') { }
window.populateCampaignElevenLabsVoices = populateCampaignElevenLabsVoices;

function toggleCampaignNarration(prefix, isChecked) {
    const p = (prefix === 'new') ? 'campaign' : 'editCampaign';
    const wrap = document.getElementById(`${p}NarrationWrap`);
    if (wrap) wrap.style.display = isChecked ? 'flex' : 'none';
}
window.toggleCampaignNarration = toggleCampaignNarration;

function toggleCampaignAutoEngagement(prefix, isChecked) {
    const p = (prefix === 'new') ? 'campaign' : 'editCampaign';
    const wrap = document.getElementById(`${p}EngagementWrap`);
    if (wrap) wrap.style.display = isChecked ? 'flex' : 'none';
}
window.toggleCampaignAutoEngagement = toggleCampaignAutoEngagement;

function toggleCampaignWarmupOnly(prefix, isChecked) {
    const p = (prefix === 'new') ? 'campaign' : 'editCampaign';
    const optWrap = document.getElementById(`${p}WarmupOnlyOptions`);
    if (optWrap) optWrap.style.display = isChecked ? 'block' : 'none';

    // Disable posting warmup pacing when pure warmup is active to avoid confusion
    const postWarmupSwitch = document.getElementById(`${p}WarmupSwitch`);
    if (postWarmupSwitch) {
        if (isChecked) {
            postWarmupSwitch.dataset.prevChecked = postWarmupSwitch.checked ? '1' : '0';
            postWarmupSwitch.checked = false;
            postWarmupSwitch.disabled = true;
            if (postWarmupSwitch.parentElement) {
                postWarmupSwitch.parentElement.style.opacity = '0.45';
                postWarmupSwitch.parentElement.title = 'Chế độ tăng dần số bài chỉ áp dụng khi đăng video';
            }
        } else {
            postWarmupSwitch.disabled = false;
            if (postWarmupSwitch.dataset.prevChecked === '1') {
                postWarmupSwitch.checked = true;
            }
            if (postWarmupSwitch.parentElement) {
                postWarmupSwitch.parentElement.style.opacity = '1';
                postWarmupSwitch.parentElement.title = '';
            }
        }
    }

    // Hide or show the Auto Upload Section to eliminate any user confusion
    const autoUpSec = document.getElementById(`${p}AutoUploadSection`);
    if (autoUpSec) {
        autoUpSec.style.display = isChecked ? 'none' : 'block';
    }

    // Keep the Account Selection List ALWAYS visible so user can select/view profiles to warm up!
    const selectionWrap = document.getElementById(`${p}AccountSelectionWrap`);
    if (selectionWrap) {
        selectionWrap.style.display = 'block';
    }

    // Dynamically update the Account Selection header text
    const gpmLabel = document.querySelector(`#${p}AccountSelectionWrap label`);
    if (gpmLabel) {
        if (isChecked) {
            gpmLabel.innerHTML = '<i class="fa-solid fa-fire text-warning"></i> Chọn Account / Profile Cần Lướt Nuôi (Chọn nhiều nick):';
        } else {
            gpmLabel.innerHTML = '<i class="fa-solid fa-robot" style="color:var(--accent-gold);"></i> Chọn Account Nhận Video (Chọn nhiều nick):';
        }
    }
}
window.toggleCampaignWarmupOnly = toggleCampaignWarmupOnly;

async function triggerCampaignWarmupNow(campaignId, btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang nuôi...';
    }
    try {
        const res = await fetch(`/api/campaigns/${campaignId}/warmup-now`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.message || 'Đã kích hoạt phiên nuôi nick thành công!');
        } else {
            showToast(data.detail || data.error || 'Lỗi khi kích hoạt nuôi nick', true);
        }
    } catch (e) {
        showToast('Lỗi: ' + e.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml || '<i class="fa-solid fa-fire text-warning"></i> Nuôi Nick Ngay';
        }
    }
}
window.triggerCampaignWarmupNow = triggerCampaignWarmupNow;

async function openNewCampaignModal() {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Tạo Chiến Dịch Tự Động')) {
        return;
    }
    const modal = document.getElementById('newCampaignModal');
    if (!modal) return;
    switchModalTab('new', 'source');

    updateCampaignSourceModeUI('new', 'youtube');

    // Reset inputs
    const nameInput = document.getElementById('campaignNameInput');
    if (nameInput) nameInput.value = '';
    const incShorts = document.getElementById('campaignIncludeShorts');
    if (incShorts) incShorts.checked = true;
    const incLong = document.getElementById('campaignIncludeLongform');
    if (incLong) incLong.checked = false;
    const minDurInput = document.getElementById('campaignMinDurationInput');
    // Shorts checked, Longform unchecked → disabled min duration (0s)
    applyMinDurationState(
        document.getElementById('campaignIncludeShorts'),
        document.getElementById('campaignIncludeLongform'),
        minDurInput, null
    );
    const maxDurInput = document.getElementById('campaignMaxDurationInput');
    if (maxDurInput) maxDurInput.value = '';
    const newCampNoSubShorts = document.getElementById('campaignDisableSubtitleForShorts');
    if (newCampNoSubShorts) newCampNoSubShorts.checked = true;  // default checked when subtitle is on
    const campVisSrc = document.getElementById('campaignVisualSource');
    if (campVisSrc) campVisSrc.value = 'ai';
    const campStkWrap = document.getElementById('campaignStockWrap');
    if (campStkWrap) campStkWrap.style.display = 'none';

    const campDistMode = document.getElementById('campaignDistributionMode');
    if (campDistMode) campDistMode.value = 'parallel_slots';

    // Reset sort states & buttons
    campaignChannelsSortAsc = true;
    campaignGpmSortAsc = true;
    updateCampaignSortBtnUI('btnSortCampaignChannels', 'sortCampaignChannelsIcon', 'sortCampaignChannelsText', true);
    updateCampaignSortBtnUI('btnSortCampaignGpm', 'sortCampaignGpmIcon', 'sortCampaignGpmText', true);

    // Reset channel & gpm search filters & group dropdowns
    const campChFilterInp = document.getElementById('campaignChannelFilterInput');
    if (campChFilterInp) campChFilterInp.value = '';
    const campChGrpSel = document.getElementById('campaignChannelGroupFilter');
    if (campChGrpSel) campChGrpSel.value = 'all';
    const campGpmGrpSel = document.getElementById('campaignGpmGroupFilter');
    if (campGpmGrpSel) campGpmGrpSel.value = 'all';

    // Reset Aspect Ratio & Split Screen
    const campAspect = document.getElementById('campaignAspectRatio');
    if (campAspect) {
        campAspect.value = '9:16_blur';
        campAspect.disabled = false;
        campAspect.style.opacity = '';
        campAspect.style.cursor = '';
        if (typeof handleAspectRatioChange === 'function') handleAspectRatioChange('campaign', '9:16_blur');
    }
    const campAspectNotice = document.getElementById('campaignAspectLockNotice');
    if (campAspectNotice) campAspectNotice.style.display = 'none';
    const campSplitLocRadio = document.getElementById('campaignSplitSourceLocal');
    if (campSplitLocRadio) campSplitLocRadio.checked = true;
    if (typeof handleSplitSourceChange === 'function') handleSplitSourceChange('campaign', 'local');
    const campSplitFld = document.getElementById('campaignSplitFolder');
    if (campSplitFld) campSplitFld.value = 'data/gameplay';
    const campSplitKw = document.getElementById('campaignSplitKeywords');
    if (campSplitKw) campSplitKw.value = 'minecraft parkour, satisfying asmr, subway surfers, soap cutting';

    // Reset Narration & TTS
    const newCampNarr = document.getElementById('campaignNarrationSwitch');
    if (newCampNarr) {
        newCampNarr.checked = false;
        toggleCampaignNarration('new', false);
    }
    // Reset subtitle switch & wrapper visibility
    const newSubSwitch = document.getElementById('campaignSubtitleSwitch');
    if (newSubSwitch) {
        newSubSwitch.checked = false;
        const newSubWrap = document.getElementById('campaignSubtitleSettingsWrap');
        if (newSubWrap) newSubWrap.style.display = 'none';
    }

    const clipsInput = document.getElementById('campaignClipsPerVideoInput');
    if (clipsInput) clipsInput.value = '3';
    handleCampaignClipsInputChange('new', 3);

    // Reset Golden 30-Minute Engagement options
    const autoUpSwitch = document.getElementById('campaignAutoUploadSwitch');
    if (autoUpSwitch) {
        autoUpSwitch.checked = true;
        toggleCampaignAutoUpload('new', true);
    }
    const newAutoEng = document.getElementById('campaignAutoEngagementSwitch');
    if (newAutoEng) newAutoEng.checked = false;
    toggleCampaignEngagementOptions('new', false);
    const newAutoPin = document.getElementById('campaignAutoPinCommentSwitch');
    if (newAutoPin) newAutoPin.checked = true;
    const newPinDelay = document.getElementById('campaignPinCommentDelaySelect');
    if (newPinDelay) newPinDelay.value = '3';
    const newAutoRep = document.getElementById('campaignAutoReplyCommentsSwitch');
    if (newAutoRep) newAutoRep.checked = true;
    const newRepDelay = document.getElementById('campaignReplyCommentsDelaySelect');
    if (newRepDelay) newRepDelay.value = '20';

    // Reset Warmup Only Mode
    const newWarmupOnlySwitch = document.getElementById('campaignWarmupOnlySwitch');
    if (newWarmupOnlySwitch) newWarmupOnlySwitch.checked = false;
    toggleCampaignWarmupOnly('new', false);
    const newWarmupDur = document.getElementById('campaignWarmupDurationSelect');
    if (newWarmupDur) newWarmupDur.value = '10';

    // Reset Target Platforms & Account Filter Input
    const newTtCheck = document.getElementById('newCampTargetTikTok');
    if (newTtCheck) newTtCheck.checked = true;
    const newGpmFilterInput = document.getElementById('campaignGpmFilterInput');
    if (newGpmFilterInput) newGpmFilterInput.value = '';

    const chListEl = document.getElementById('campaignChannelsList');
    const gpmListEl = document.getElementById('campaignGpmList');

    // 0. Instant Optimistic Render from Memory Cache if available (Zero wait time)
    if (window.cachedChannelGroups && window.cachedChannelGroups.length) {
        populateCampaignGroupFilters('new');
    }
    const existingSavedChannels = (modalAllSavedChannels && modalAllSavedChannels.length) ? modalAllSavedChannels : (window.cachedSavedChannels || []);
    const existingGpmProfiles = (modalAllGpmProfiles && modalAllGpmProfiles.length) ? modalAllGpmProfiles : (window.cachedProfiles || []);
    const { usedChannelIds: initUsedCh, usedProfileIds: initUsedProf } = getUsedCampaignResources();

    if (existingSavedChannels.length) {
        modalAllSavedChannels = existingSavedChannels;
        modalAvailableSavedChannels = existingSavedChannels.filter(ch => !initUsedCh.has(String(ch.channel_id).trim()));
        renderCampaignChannelsCheckboxes(modalAvailableSavedChannels);
    } else {
        if (chListEl) chListEl.innerHTML = '<div class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Đang nạp danh sách kênh...</div>';
    }

    if (existingGpmProfiles.length) {
        modalAllGpmProfiles = existingGpmProfiles;
        modalAvailableGpmProfiles = existingGpmProfiles.filter(p => !initUsedProf.has(String(p.id).trim()) && (!p.gpm_id || !initUsedProf.has(String(p.gpm_id).trim())));
        renderCampaignGpmCheckboxes(modalAvailableGpmProfiles);
    } else {
        if (gpmListEl) gpmListEl.innerHTML = '<div class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Đang nạp profile...</div>';
    }

    modal.classList.add('show');

    // 1. Concurrently fetch fresh data in parallel using Promise.all (Campaigns, Channels, Profiles, Groups, Settings)
    try {
        const [cRes, chRes, gpmRes, grpRes, defData] = await Promise.all([
            fetch('/api/campaigns').then(r => r.ok ? r.json() : []).catch(() => cachedCampaigns || []),
            fetch('/api/youtube/channels').then(r => r.ok ? r.json() : []).catch(() => modalAllSavedChannels || []),
            fetch('/api/gpm/profiles').then(r => r.ok ? r.json() : []).catch(() => modalAllGpmProfiles || []),
            (!window.cachedChannelGroups || !window.cachedChannelGroups.length)
                ? fetch('/api/channel-groups').then(r => r.ok ? r.json() : null).catch(() => null)
                : Promise.resolve(null),
            fetch('/api/settings/defaults').then(r => r.ok ? r.json() : {}).catch(() => ({}))
        ]);

        if (Array.isArray(cRes)) cachedCampaigns = cRes;
        if (Array.isArray(chRes) && chRes.length) {
            modalAllSavedChannels = chRes;
            window.cachedSavedChannels = chRes;
        }
        if (Array.isArray(gpmRes) && gpmRes.length) {
            modalAllGpmProfiles = gpmRes;
            window.cachedProfiles = gpmRes;
        }
        if (grpRes && grpRes.status === 'success' && grpRes.groups) {
            window.cachedChannelGroups = grpRes.groups;
        }

        const { usedChannelIds, usedProfileIds } = getUsedCampaignResources();

        // Bảo lưu các kênh và profile mà người dùng đã tick chọn trong lúc chờ tải dữ liệu ngầm
        const currentCheckedChannelIds = Array.from(document.querySelectorAll('#campaignChannelsList .campaign-ch-check:checked')).map(b => b.value);
        const currentCheckedGpmIds = Array.from(document.querySelectorAll('#campaignGpmList .campaign-gpm-check:checked')).map(b => b.value);

        modalAvailableSavedChannels = (modalAllSavedChannels || []).filter(ch => !usedChannelIds.has(String(ch.channel_id).trim()) || currentCheckedChannelIds.includes(String(ch.channel_id).trim()));
        renderCampaignChannelsCheckboxes(modalAvailableSavedChannels, currentCheckedChannelIds.length ? currentCheckedChannelIds : null);

        modalAvailableGpmProfiles = (modalAllGpmProfiles || []).filter(p => (!usedProfileIds.has(String(p.id).trim()) && (!p.gpm_id || !usedProfileIds.has(String(p.gpm_id).trim()))) || currentCheckedGpmIds.includes(String(p.id)));
        renderCampaignGpmCheckboxes(modalAvailableGpmProfiles, currentCheckedGpmIds.length ? currentCheckedGpmIds : null);

        await populateCampaignGroupFilters('new');

        // Restore persisted folder defaults
        if (defData) {
            const dlInput = document.getElementById('campaignDownloadDir');
            const rdInput = document.getElementById('campaignRenderDir');
            if (dlInput && defData.download_dir) dlInput.value = defData.download_dir;
            if (rdInput && defData.render_dir) rdInput.value = defData.render_dir;
        }
    } catch (e) {
        console.warn('Lỗi đồng bộ dữ liệu chiến dịch:', e);
    }

    // 4. Ensure BGM Categories loaded
    if (!cachedAudioCategories.length) {
        try {
            const aRes = await fetch('/api/audio/categories');
            const aData = await aRes.json();
            if (aData.status === 'success') {
                cachedAudioCategories = aData.categories || [];
            }
        } catch (_) { }
    }
}

function renderCampaignChannelsCheckboxes(channels, selectedIds = null) {
    const chListEl = document.getElementById('campaignChannelsList');
    if (!chListEl) return;

    if (!channels || !channels.length) {
        const allList = (modalAllSavedChannels && modalAllSavedChannels.length) ? modalAllSavedChannels : (window.modalAllSavedChannels || []);
        const hasSaved = allList && allList.length > 0;
        chListEl.innerHTML = hasSaved ? `
            <div class="text-muted text-center py-4" style="font-size:12.5px; padding: 20px 10px;">
                <i class="fa-solid fa-circle-info" style="font-size:22px; color:var(--accent-cyan); display:block; margin-bottom:8px;"></i>
                Tất cả kênh YouTube đã được phân bổ vào các chiến dịch khác.<br>
                <span style="font-size:11px; opacity:0.8;">Hãy thêm kênh mới ở tab <strong>"1. Nguồn YouTube"</strong> hoặc xóa chiến dịch cũ để sử dụng lại kênh!</span>
            </div>
        ` : `
            <div class="text-muted text-center py-3" style="font-size:12px;">
                Chưa có kênh nào được lưu. Hãy qua tab <strong>"1. Nguồn YouTube"</strong> để quét và lưu kênh trước!
            </div>
        `;
        updateSelectedChannelsCount();
        return;
    }

    if (selectedIds === null) {
        const currentlyChecked = Array.from(chListEl.querySelectorAll('.campaign-ch-check:checked')).map(el => el.value);
        if (currentlyChecked.length > 0) {
            selectedIds = currentlyChecked;
        }
    }

    const selSet = selectedIds ? new Set(selectedIds.map(String)) : null;

    const sorted = [...channels].sort((a, b) => {
        const nameA = (a.display_name || a.title || '').toLowerCase();
        const nameB = (b.display_name || b.title || '').toLowerCase();
        return campaignChannelsSortAsc
            ? nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' })
            : nameB.localeCompare(nameA, 'vi', { sensitivity: 'base' });
    });

    chListEl.innerHTML = sorted.map((ch, idx) => {
        const isChecked = selSet ? selSet.has(String(ch.channel_id)) : false;
        const grpBadge = ch.group_name
            ? `<span class="badge" title="Nhóm: ${escapeHtml(ch.group_name)}" style="font-size:9.5px; background:rgba(99,102,241,0.15); color:#818cf8; border:1px solid rgba(99,102,241,0.3); padding:1px 6px; border-radius:4px; flex-shrink:0; max-width:130px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle;"><i class="${escapeHtml(ch.group_icon || 'fa-solid fa-folder')}" style="flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ch.group_name)}</span></span>`
            : '';
        return `
        <label class="multi-select-item" data-channel-id="${escapeHtml(ch.channel_id)}" data-group-id="${escapeHtml(String(ch.group_id || ''))}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; min-width:0; overflow:hidden; min-height:42px; margin-bottom:4px;">
            <input type="checkbox" class="campaign-ch-check" value="${escapeHtml(ch.channel_id)}" ${isChecked ? 'checked' : ''} onchange="updateSelectedChannelsCount()" style="flex-shrink:0;">
            <i class="fa-brands fa-youtube" style="color:#ff0000; font-size:14px; flex-shrink:0;"></i>
            <span style="font-weight:600; color:#fff; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(ch.display_name || ch.title)}">${escapeHtml(ch.display_name || ch.title)}</span>
            ${grpBadge}
            <span style="font-size:11px; color:var(--accent-cyan); white-space:nowrap; flex-shrink:0;">${formatNumber(ch.subscriber_count || 0)} subs</span>
            <span class="badge badge-secondary" style="font-size:10px; white-space:nowrap; flex-shrink:0;">${escapeHtml(ch.country || 'US')}</span>
        </label>
        `;
    }).join('');

    chListEl.scrollTop = 0;
    updateSelectedChannelsCount();
}

function renderCampaignGpmCheckboxes(profiles, selectedIds = null) {
    const gpmListEl = document.getElementById('campaignGpmList');
    if (!gpmListEl) return;

    if (!profiles || !profiles.length) {
        const allList = (modalAllGpmProfiles && modalAllGpmProfiles.length) ? modalAllGpmProfiles : (window.modalAllGpmProfiles || []);
        const hasProfiles = allList && allList.length > 0;
        gpmListEl.innerHTML = hasProfiles ? `
            <div class="text-muted text-center py-4" style="font-size:12.5px; padding: 20px 10px;">
                <i class="fa-solid fa-circle-info" style="font-size:22px; color:var(--accent-gold); display:block; margin-bottom:8px;"></i>
                Tất cả tài khoản / profile đã được gán vào các chiến dịch khác.<br>
                <span style="font-size:11px; opacity:0.8;">Hãy thêm profile mới ở tab <strong>"Dàn Profile"</strong> hoặc xóa chiến dịch cũ để sử dụng lại tài khoản!</span>
            </div>
        ` : `
            <div class="text-muted text-center py-3" style="font-size:12px;">
                Chưa có profile nào. Hãy bấm <strong>"Đồng Bộ"</strong> ở tab "Dàn Profile"!
            </div>
        `;
        updateSelectedGpmCount();
        return;
    }

    if (selectedIds === null) {
        const currentlyChecked = Array.from(gpmListEl.querySelectorAll('.campaign-gpm-check:checked')).map(el => el.value);
        if (currentlyChecked.length > 0) {
            selectedIds = currentlyChecked;
        }
    }

    const selSet = selectedIds ? new Set(selectedIds.map(String)) : null;

    // Không tự động pre-check tài khoản khi tạo chiến dịch mới
    const activePlatforms = new Set(['tiktok']);

    const itemsHtml = [];

    const sorted = [...profiles].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return campaignGpmSortAsc
            ? nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' })
            : nameB.localeCompare(nameA, 'vi', { sensitivity: 'base' });
    });

    sorted.forEach(p => {
        const plat = (p.platform || 'tiktok').toLowerCase();
        const hasSubChannels = (plat === 'youtube' || plat === 'facebook') && Array.isArray(p.channels) && p.channels.length > 0;
        const grpName = getCampaignProfileGroupName(p);
        const grpBadge = grpName
            ? `<span class="badge" title="Nhóm: ${escapeHtml(grpName)}" style="background:rgba(99,102,241,0.15); color:#a5b4fc; border:1px solid rgba(99,102,241,0.3); font-size:9.5px; padding:1px 6px; border-radius:4px; flex-shrink:0; max-width:120px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle;"><i class="fa-solid fa-folder" style="flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(grpName)}</span></span>`
            : '';

        if (hasSubChannels) {
            p.channels.forEach(ch => {
                let platIcon = '<i class="fa-brands fa-youtube" style="color:#ef4444; font-size:14px;"></i>';
                let platColor = '#ef4444';
                let typeBadge = '';
                const count = ch.followers_count || 0;
                const flwText = plat === 'youtube' ? 'subs' : 'flw';

                if (plat === 'youtube') {
                    platIcon = '<i class="fa-brands fa-youtube" style="color:#ef4444; font-size:14px;"></i>';
                    platColor = '#ef4444';
                    typeBadge = ch.is_default
                        ? `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3);" data-i18n="campaign_channel_default">${window.i18n ? window.i18n.t('campaign_channel_default', 'Mặc định') : 'Mặc định'}</span>`
                        : `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(255,255,255,0.08); color:var(--text-secondary);" data-i18n="campaign_channel_sub">${window.i18n ? window.i18n.t('campaign_channel_sub', 'Kênh phụ') : 'Kênh phụ'}</span>`;
                } else if (plat === 'facebook') {
                    platIcon = '<i class="fa-brands fa-facebook" style="color:#1877f2; font-size:14px;"></i>';
                    platColor = '#60a5fa';
                    typeBadge = ch.is_default
                        ? `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);" data-i18n="campaign_fb_personal">${window.i18n ? window.i18n.t('campaign_fb_personal', 'Cá nhân') : 'Cá nhân'}</span>`
                        : `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3);" data-i18n="campaign_fb_fanpage">${window.i18n ? window.i18n.t('campaign_fb_fanpage', 'Fanpage') : 'Fanpage'}</span>`;
                }

                const chTitle = ch.channel_name || ch.channel_url || p.name;
                const chSub = ch.channel_url || '';
                const isMatchingPlat = activePlatforms.has(plat);
                const shouldPreCheck = selSet ? selSet.has(String(p.id)) : false;

                const bType = (p.browser_type || 'gpm').toLowerCase();
                const bBadge = bType === 'genlogin'
                    ? '<span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; font-size:9px; padding:1px 4px; flex-shrink:0;">GEN</span>'
                    : '<span class="badge" style="background:rgba(59,130,246,0.18); color:#93c5fd; font-size:9px; padding:1px 4px; flex-shrink:0;">GPM</span>';
                const bLabel = bType === 'genlogin' ? 'GenLogin' : (bType === 'adspower' ? 'AdsPower' : (bType === 'dolphin' ? 'Dolphin' : 'GPMLogin'));
                const accountKey = getCanonicalAccountKey(p, ch);
                const isDup = profiles.some(o => o.id !== p.id && getCanonicalAccountKey(o, ch) === accountKey);
                const dupBadge = isDup ? '<span class="badge" style="background:rgba(234,179,8,0.18); color:#eab308; font-size:9px; padding:1px 4px; flex-shrink:0;" title="Tài khoản này có mặt trên nhiều trình duyệt"><i class="fa-solid fa-link"></i> Trùng nick</span>' : '';

                itemsHtml.push(`
                <label class="multi-select-item" data-platform="${plat}" data-group-name="${escapeHtml(grpName)}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; min-width:0; overflow:hidden; min-height:42px; margin-bottom:4px;">
                    <input type="checkbox" class="campaign-gpm-check" value="${p.id}" data-gpm-id="${escapeHtml(p.gpm_id)}" data-account-key="${escapeHtml(accountKey)}" data-browser-label="${escapeHtml(bLabel)}" data-profile-name="${escapeHtml(p.name)}" data-channel-id="${escapeHtml(ch.channel_id || '')}" data-channel-name="${escapeHtml(chTitle)}" data-platform="${plat}" ${shouldPreCheck ? 'checked' : ''} onchange="syncCampaignDuplicateCheckboxes('new'); if(this.checked && '${escapeHtml(ch.channel_id)}') handleChannelSelectionChange('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}')" style="flex-shrink:0;">
                    <span style="flex-shrink:0; display:inline-flex; align-items:center;">${platIcon}</span>
                    <div style="flex:1; min-width:0; display:flex; align-items:center; gap:8px; overflow:hidden;">
                        ${bBadge}
                        <span style="font-size:11px; flex-shrink:0; color:var(--text-secondary); background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:4px; white-space:nowrap; max-width:110px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                        <span style="font-weight:600; color:#fff; min-width:0; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${escapeHtml(chTitle)}">${escapeHtml(chTitle)}</span>
                        ${grpBadge}
                        ${typeBadge}
                        ${dupBadge}
                    </div>
                    <div style="margin-left:auto; display:flex; align-items:center; gap:10px; flex-shrink:0;">
                        <span style="font-size:11px; color:${platColor}; white-space:nowrap; max-width:140px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(chSub)}">${escapeHtml(chSub)}</span>
                        <span class="badge ${count >= 1000 ? 'badge-success' : 'badge-secondary'}" style="font-size:10px; white-space:nowrap; flex-shrink:0;">${count.toLocaleString()} ${flwText}</span>
                    </div>
                </label>
                `);
            });
        } else {
            let platIcon = '<i class="fa-brands fa-tiktok" style="color:#ff0050; font-size:14px;"></i>';
            let platColor = 'var(--accent-gold)';
            let displayName = `@${escapeHtml(p.tiktok_username || 'Chưa gắn')}`;
            if (plat === 'youtube') {
                platIcon = '<i class="fa-brands fa-youtube" style="color:#ef4444; font-size:14px;"></i>';
                platColor = '#ef4444';
                displayName = escapeHtml(p.channel_handle || p.tiktok_username || 'YouTube');
            } else if (plat === 'facebook') {
                platIcon = '<i class="fa-brands fa-facebook" style="color:#1877f2; font-size:14px;"></i>';
                platColor = '#60a5fa';
                displayName = escapeHtml(p.tiktok_nickname || `FB: ${p.fb_page_id || p.tiktok_username || ''}`);
            }

            const isMatchingPlat = activePlatforms.has(plat);
            const shouldPreCheck = selSet ? selSet.has(String(p.id)) : false;

            const bType = (p.browser_type || 'gpm').toLowerCase();
            const bBadge = bType === 'genlogin'
                ? '<span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; font-size:9px; padding:1px 4px; flex-shrink:0;">GEN</span>'
                : '<span class="badge" style="background:rgba(59,130,246,0.18); color:#93c5fd; font-size:9px; padding:1px 4px; flex-shrink:0;">GPM</span>';
            const bLabel = bType === 'genlogin' ? 'GenLogin' : (bType === 'adspower' ? 'AdsPower' : (bType === 'dolphin' ? 'Dolphin' : 'GPMLogin'));
            const accountKey = getCanonicalAccountKey(p);
            const isDup = profiles.some(o => o.id !== p.id && getCanonicalAccountKey(o) === accountKey);
            const dupBadge = isDup ? '<span class="badge" style="background:rgba(234,179,8,0.18); color:#eab308; font-size:9px; padding:1px 4px; flex-shrink:0;" title="Tài khoản này có mặt trên nhiều trình duyệt"><i class="fa-solid fa-link"></i> Trùng nick</span>' : '';

            itemsHtml.push(`
            <label class="multi-select-item" data-platform="${plat}" data-group-name="${escapeHtml(grpName)}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; min-width:0; overflow:hidden; min-height:42px; margin-bottom:4px;">
                <input type="checkbox" class="campaign-gpm-check" value="${p.id}" data-gpm-id="${escapeHtml(p.gpm_id)}" data-account-key="${escapeHtml(accountKey)}" data-browser-label="${escapeHtml(bLabel)}" data-profile-name="${escapeHtml(p.name)}" data-channel-id="" data-channel-name="${escapeHtml(displayName)}" data-platform="${plat}" ${shouldPreCheck ? 'checked' : ''} onchange="syncCampaignDuplicateCheckboxes('new');" style="flex-shrink:0;">
                <span style="flex-shrink:0; display:inline-flex; align-items:center;">${platIcon}</span>
                <div style="flex:1; min-width:0; display:flex; align-items:center; gap:8px; overflow:hidden;">
                    ${bBadge}
                    <span style="font-weight:600; color:#fff; min-width:0; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                    ${grpBadge}
                    ${dupBadge}
                </div>
                <div style="margin-left:auto; display:flex; align-items:center; gap:10px; flex-shrink:0;">
                    <span style="font-size:11px; color:${platColor}; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${displayName}">${displayName}</span>
                    <span class="badge ${p.eligible_10k ? 'badge-success' : 'badge-secondary'}" style="font-size:10px; white-space:nowrap; flex-shrink:0;">${(p.followers_count || 0).toLocaleString()} flw</span>
                </div>
            </label>
            `);
        }
    });

    gpmListEl.innerHTML = itemsHtml.join('');
    gpmListEl.scrollTop = 0;
    filterCampaignGpmAccounts('new');
    syncCampaignDuplicateCheckboxes('new');
}

function updateSelectedChannelsCount() {
    const checked = document.querySelectorAll('.campaign-ch-check:checked');
    const badge = document.getElementById('campaignSelectedChannelsCount');
    if (badge) badge.textContent = `Đã chọn: ${checked.length} kênh`;
    updateSourceModeBadge('new');
}

function updateSelectedGpmCount() {
    const checked = Array.from(document.querySelectorAll('.campaign-gpm-check:checked')).filter(b => {
        const item = b.closest('label');
        return item && item.style.display !== 'none';
    });
    const badge = document.getElementById('campaignSelectedGpmCount');
    if (badge) badge.textContent = `Đã chọn: ${checked.length} nick`;
}

// Channel Picker — hiển thị dropdown chọn kênh YouTube / trang Facebook cho mỗi profile
async function loadChannelPicker(gpmId, platform, checkbox) {
    const container = document.getElementById(`channel-picker-${gpmId}`);
    if (!container) return;

    if (!checkbox.checked) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    if (platform !== 'youtube' && platform !== 'facebook') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách kênh...';

    try {
        const res = await fetch(`/api/gpm/profiles/${gpmId}/channels`);
        const channels = await res.json();

        if (!channels.length) {
            // Chưa có dữ liệu — thử sync trước
            container.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét kênh...';
            const syncRes = await fetch(`/api/gpm/profiles/${gpmId}/channels/sync`, { method: 'POST' });
            const syncData = await syncRes.json();
            const resAfter = await fetch(`/api/gpm/profiles/${gpmId}/channels`);
            const channelsAfter = await resAfter.json();

            if (!channelsAfter.length) {
                container.innerHTML = `<span class="text-muted" style="font-size:11px;"><i class="fa-solid fa-info-circle"></i> Chỉ có 1 kênh (mặc định)</span>`;
                return;
            }
            renderChannelDropdown(container, channelsAfter, gpmId, platform);
        } else {
            renderChannelDropdown(container, channels, gpmId, platform);
        }
    } catch (err) {
        container.innerHTML = `<span class="text-muted" style="font-size:11px;"><i class="fa-solid fa-exclamation-triangle"></i> Lỗi tải kênh</span>`;
    }
}

function renderChannelDropdown(container, channels, gpmId, platform) {
    if (channels.length <= 1) {
        const ch = channels[0];
        container.innerHTML = `<span style="font-size:11px; color:var(--text-secondary);"><i class="fa-solid fa-check-circle" style="color:#34d399;"></i> Kênh: <strong>${escapeHtml(ch.channel_name)}</strong></span>`;
        return;
    }

    const icon = platform === 'youtube' ? 'fa-brands fa-youtube' : 'fa-brands fa-facebook';
    const color = platform === 'youtube' ? '#ef4444' : '#1877f2';
    const label = platform === 'youtube' ? 'Chọn kênh YouTube:' : 'Chọn trang Facebook:';

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; padding:4px 0;">
            <i class="${icon}" style="color:${color}; font-size:12px;"></i>
            <span style="font-size:11px; color:var(--text-secondary);">${label}</span>
            <select class="custom-select channel-select-for-profile" data-gpm-id="${escapeHtml(gpmId)}" data-platform="${platform}" style="font-size:11px; padding:2px 6px; max-width:220px;" onchange="handleChannelSelectionChange('${escapeHtml(gpmId)}', this.value)">
                ${channels.map(ch => `
                    <option value="${escapeHtml(ch.channel_id)}" ${ch.is_default ? 'selected' : ''}>
                        ${escapeHtml(ch.channel_name)} ${ch.is_default ? '(mặc định)' : ''}
                    </option>
                `).join('')}
            </select>
        </div>
    `;
}

async function handleChannelSelectionChange(gpmId, channelId) {
    try {
        const res = await fetch(`/api/gpm/profiles/${gpmId}/channels/${encodeURIComponent(channelId)}/set-default`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('✅ Đã chọn kênh upload mặc định cho profile!');
        }
    } catch (e) {
        console.warn('Lỗi lưu kênh mặc định:', e);
    }
}

function selectAllCampaignChannels(select) {
    const boxes = document.querySelectorAll('.campaign-ch-check');
    boxes.forEach(b => {
        if (b.closest('label').style.display !== 'none') {
            b.checked = select;
        }
    });
    updateSelectedChannelsCount();
    updateSourceModeBadge('new');
}

function selectAllCampaignGpm(select) {
    const listEl = document.getElementById('campaignGpmList');
    if (!listEl) return;
    const boxes = Array.from(listEl.querySelectorAll('.campaign-gpm-check'));
    if (!select) {
        boxes.forEach(b => { b.checked = false; });
    } else {
        const seenKeys = new Set();
        boxes.forEach(b => {
            const item = b.closest('label');
            if (item && item.style.display !== 'none') {
                const k = b.dataset.accountKey;
                if (k && seenKeys.has(k)) {
                    b.checked = false; // Không chọn duplicate account!
                } else {
                    b.checked = true;
                    if (k) seenKeys.add(k);
                }
            }
        });
    }
    syncCampaignDuplicateCheckboxes('new');
}

function filterCampaignChannelList(query) {
    const q = (query !== undefined ? query : (document.getElementById('campaignChannelFilterInput')?.value || '')).toLowerCase().trim();
    const groupFilter = document.getElementById('campaignChannelGroupFilter')?.value || 'all';
    const items = document.querySelectorAll('#campaignChannelsList .multi-select-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        const groupId = item.getAttribute('data-group-id') || '';
        const matchQuery = !q || text.includes(q);
        let matchGroup = true;
        if (groupFilter === 'ungrouped') {
            matchGroup = !groupId || groupId === '0' || groupId === 'null';
        } else if (groupFilter !== 'all') {
            matchGroup = (groupId === groupFilter);
        }
        item.style.display = (matchQuery && matchGroup) ? 'flex' : 'none';
    });
}

// Lọc danh sách account nhận video theo các nền tảng mục tiêu đã tick ở trên & ô tìm kiếm
function filterCampaignGpmAccounts(mode = 'new') {
    const isNew = mode === 'new';
    const listId = isNew ? 'campaignGpmList' : 'editCampaignGpmList';
    const searchId = isNew ? 'campaignGpmFilterInput' : 'editCampaignGpmFilterInput';
    const groupFilterId = isNew ? 'campaignGpmGroupFilter' : 'editCampaignGpmGroupFilter';
    const prefix = isNew ? 'newCampTarget' : 'editCampTarget';

    const activePlatforms = new Set(['tiktok']);

    const searchInput = document.getElementById(searchId);
    const query = (searchInput?.value || '').toLowerCase().trim();
    const groupFilter = document.getElementById(groupFilterId)?.value || 'all';

    const listEl = document.getElementById(listId);
    if (!listEl) return;

    const items = listEl.querySelectorAll('.multi-select-item');
    let visibleCount = 0;

    items.forEach(item => {
        const plat = (item.getAttribute('data-platform') || 'tiktok').toLowerCase();
        const groupName = item.getAttribute('data-group-name') || '';
        const input = item.querySelector('input');
        const gpmId = input?.getAttribute('data-gpm-id');
        const pickerEl = gpmId ? document.getElementById(`channel-picker-${gpmId}`) : null;

        const matchPlatform = activePlatforms.has(plat);
        const matchQuery = !query || item.textContent.toLowerCase().includes(query);
        let matchGroup = true;
        if (groupFilter === 'ungrouped') {
            matchGroup = !groupName;
        } else if (groupFilter !== 'all') {
            matchGroup = (groupName.toLowerCase() === groupFilter.toLowerCase());
        }

        if (matchPlatform && matchQuery && matchGroup) {
            item.style.display = 'flex';
            visibleCount++;
            if (pickerEl && input && input.checked) {
                pickerEl.style.display = 'block';
            }
        } else {
            item.style.display = 'none';
            if (pickerEl) {
                pickerEl.style.display = 'none';
            }
            // Nếu bị ẩn do bỏ chọn nền tảng thì tự động bỏ tick để tránh gửi nhầm
            if (!matchPlatform && input && input.checked) {
                input.checked = false;
            }
        }
    });

    // Thông báo trạng thái khi rỗng
    let hintEl = listEl.querySelector('.platform-filter-empty-hint');
    if (activePlatforms.size === 0) {
        if (!hintEl) {
            hintEl = document.createElement('div');
            hintEl.className = 'platform-filter-empty-hint text-warning text-center py-3';
            hintEl.style.fontSize = '12px';
            listEl.appendChild(hintEl);
        }
        hintEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Vui lòng chọn ít nhất một nền tảng ở mục "Nền Tảng Đăng Bài Mục Tiêu" phía trên.';
        hintEl.style.display = 'block';
    } else if (visibleCount === 0) {
        if (!hintEl) {
            hintEl = document.createElement('div');
            hintEl.className = 'platform-filter-empty-hint text-muted text-center py-3';
            hintEl.style.fontSize = '12px';
            listEl.appendChild(hintEl);
        }
        const platNames = [];
        if (ttChecked) platNames.push('TikTok');
        if (ytChecked) platNames.push('YouTube Shorts');
        if (fbChecked) platNames.push('Facebook Reels');
        hintEl.innerHTML = `<i class="fa-solid fa-folder-open"></i> Không có profile nào thuộc nền tảng: <strong>${platNames.join(', ')}</strong>${query ? ` khớp với từ khóa "${escapeHtml(query)}"` : ''}.`;
        hintEl.style.display = 'block';
    } else if (hintEl) {
        hintEl.style.display = 'none';
    }

    if (isNew) {
        updateSelectedGpmCount();
    } else {
        updateEditSelectedGpmCount();
    }
}
window.filterCampaignGpmAccounts = filterCampaignGpmAccounts;

function filterCampaignGpmList(query) {
    filterCampaignGpmAccounts('new');
}

function onCampaignFrequencyChange(val) {
    const customWrap = document.getElementById('campaignCustomIntervalWrap');
    const daysWrap = document.getElementById('campaignDaysOfWeekWrap');
    if (customWrap) customWrap.style.display = val === 'custom_interval' ? 'block' : 'none';
    if (daysWrap) daysWrap.style.display = val === 'specific_days' ? 'block' : 'none';
}

function setCampaignSchedulePreset(val) {
    const inp = document.getElementById('campaignScheduleInput');
    if (inp) inp.value = val;
}

let _isBrowsingFolderCampaign = false;

async function browseFolderForInput(inputId) {
    if (_isBrowsingFolderCampaign) return;
    _isBrowsingFolderCampaign = true;
    const input = document.getElementById(inputId);
    showToast('Đang mở hộp thoại chọn thư mục Windows...');
    try {
        const res = await fetch('/api/utils/browse-folder', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success' && data.path) {
            if (input) input.value = data.path;
            showToast(`Đã chọn: ${data.path}`);
            // Update source mode badge if this is a campaign folder input
            if (inputId === 'campaignLocalFolderInput') updateSourceModeBadge('new');
            if (inputId === 'editCampaignLocalFolderInput') updateSourceModeBadge('edit');
        } else if (data.status === 'busy') {
            showToast(data.message || 'Hộp thoại chọn thư mục đang được mở', 'warning');
        } else if (data.status === 'cancelled') {
            // User cancelled folder picker
        } else if (data.status === 'error') {
            showToast('Lỗi mở hộp thoại chọn thư mục: ' + (data.message || 'Không rõ'), true);
        }
    } catch (err) {
        showToast('Lỗi kết nối máy chủ: ' + err.message, true);
    } finally {
        _isBrowsingFolderCampaign = false;
    }
}

function closeNewCampaignModal() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    const modal = document.getElementById('newCampaignModal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
    }
}

async function handleCreateCampaignSubmit(e) {
    e.preventDefault();
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Kích Hoạt Chiến Dịch')) {
        return;
    }
    const btn = document.getElementById('btnSubmitCampaign');

    // Validate Campaign Name
    const campNameInput = document.getElementById('campaignNameInput');
    const campName = campNameInput ? campNameInput.value.trim() : '';

    // 1. Source: YouTube Channels only
    const chBoxes = document.querySelectorAll('.campaign-ch-check:checked');
    const selectedChannelIds = Array.from(chBoxes).map(b => b.value);
    const sourceMode = 'youtube';
    const localFolder = '';
    const isWarmupOnly = document.getElementById('campaignWarmupOnlySwitch')?.checked ? 1 : 0;

    if (!isWarmupOnly && selectedChannelIds.length === 0) {
        showToast('⚠️ Vui lòng chọn ít nhất 1 Kênh YouTube nguồn!', 'warning');
        switchModalTab('new', 'source');
        return;
    }

    // Target Platforms: TikTok only
    const targetPlatforms = ['tiktok'];

    const autoUpload = isWarmupOnly ? 0 : (document.getElementById('campaignAutoUploadSwitch')?.checked ? 1 : 0);

    // 2. Gather Selected GPM Profiles
    const gpmBoxes = Array.from(document.querySelectorAll('.campaign-gpm-check:checked')).filter(b => {
        const item = b.closest('label');
        return item && item.style.display !== 'none';
    });
    const selectedGpmIds = Array.from(new Set(gpmBoxes.map(b => parseInt(b.value, 10)).filter(id => !isNaN(id))));
    if ((autoUpload || isWarmupOnly) && selectedGpmIds.length === 0) {
        showToast('⚠️ Vui lòng chọn ít nhất 1 Profile nhận video / nuôi nick!', 'warning');
        return;
    }

    let safeDailyLimit = 3;
    let cleanScheduleStr = "11:30, 18:00, 20:30";

    if (autoUpload) {
        // 1. Validate daily_limit
        const dailyLimitInput = document.getElementById('campaignDailyLimitInput');
        const rawDailyLimit = parseInt(dailyLimitInput?.value, 10);
        if (isNaN(rawDailyLimit) || rawDailyLimit < 1) {
            markInputError('campaignDailyLimitInput', 'Giới hạn video/ngày trên mỗi nick phải là số nguyên >= 1!');
            return;
        }
        safeDailyLimit = Math.max(1, rawDailyLimit);

        // 2. Validate post_schedule
        const scheduleInput = document.getElementById('campaignScheduleInput');
        const scheduleRaw = (scheduleInput?.value || '').trim();
        const rawSlots = scheduleRaw.split(',').map(s => s.trim()).filter(Boolean);
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        const invalidSlot = rawSlots.find(s => !timeRegex.test(s));
        if (!rawSlots.length || invalidSlot) {
            markInputError('campaignScheduleInput', `Khung giờ đăng không hợp lệ: "${invalidSlot || 'trống'}". Định dạng chuẩn: HH:MM`);
            return;
        }
        const safeSlots = Array.from(new Set(rawSlots.map(s => {
            const [h, m] = s.split(':');
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        })));
        cleanScheduleStr = safeSlots.join(', ');
    }

    // Gather frequency & advanced options
    const freq = document.getElementById('campaignFrequencySelect')?.value || 'daily';
    let intervalDays = 1;
    if (freq === 'every_2_days') intervalDays = 2;
    else if (freq === 'every_3_days') intervalDays = 3;
    else if (freq === 'custom_interval') {
        const customIntVal = parseInt(document.getElementById('campaignCustomIntervalInput')?.value, 10);
        if (isNaN(customIntVal) || customIntVal < 1 || customIntVal > 365) {
            markInputError('campaignCustomIntervalInput', 'Chu kỳ lặp lại phải từ 1 đến 365 ngày!');
            return;
        }
        intervalDays = customIntVal;
    }

    const incShorts = document.getElementById('campaignIncludeShorts')?.checked ? 1 : 0;
    const incLong = document.getElementById('campaignIncludeLongform')?.checked ? 1 : 0;
    if (!incShorts && !incLong) {
        showToast('⚠️ Vui lòng chọn ít nhất một định dạng video: Shorts hoặc Video Dài!', true);
        return;
    }

    const minDurVal = document.getElementById('campaignMinDurationInput')?.value.trim();
    const maxDurVal = document.getElementById('campaignMaxDurationInput')?.value.trim();
    if (minDurVal && maxDurVal) {
        const minD = parseInt(minDurVal, 10);
        const maxD = parseInt(maxDurVal, 10);
        if (minD >= maxD) {
            markInputError('campaignMinDurationInput', 'Thời lượng tối thiểu phải nhỏ hơn thời lượng tối đa!');
            return;
        }
    }

    const clipsPerVid = parseInt(document.getElementById('campaignClipsPerVideoInput')?.value, 10) || 3;
    if (clipsPerVid < 1 || clipsPerVid > 20) {
        markInputError('campaignClipsPerVideoInput', 'Số phần cắt mỗi video phải từ 1 đến 20!');
        return;
    }


    // Validate Split Screen (Ghép 2 tầng) nếu được chọn
    const campAspectRatio = document.getElementById('campaignAspectRatio')?.value || '9:16_blur';
    let splitSourceType = 'local';
    let splitFolder = 'data/gameplay';
    let splitKeywords = 'minecraft parkour, satisfying asmr, subway surfers';
    let splitProvider = 'all';

    if (campAspectRatio === '9:16_split') {
        const isLocal = document.getElementById('campaignSplitSourceLocal')?.checked;
        splitSourceType = isLocal ? 'local' : 'stock';
        if (isLocal) {
            splitFolder = document.getElementById('campaignSplitFolder')?.value.trim();
            if (!splitFolder) {
                markInputError('campaignSplitFolder', 'Vui lòng nhập đường dẫn thư mục chứa video phụ (Tầng Dưới) cho Split Screen!');
                return;
            }
        } else {
            splitKeywords = document.getElementById('campaignSplitKeywords')?.value.trim();
            if (!splitKeywords) {
                markInputError('campaignSplitKeywords', 'Vui lòng nhập từ khóa tìm kiếm Stock Video cho Split Screen!');
                return;
            }
            splitProvider = document.getElementById('campaignSplitProvider')?.value || 'all';
        }
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Kích Hoạt...';
    }

    const dowBoxes = document.querySelectorAll('.campaign-dow-check:checked');
    const daysOfWeek = Array.from(dowBoxes).map(b => b.value).join(',');
    const randomDelay = parseInt(document.getElementById('campaignRandomDelaySelect')?.value, 10) || 10;
    const warmup = document.getElementById('campaignWarmupSwitch')?.checked ? 1 : 0;

    const payload = {
        name: campName || `Chiến Dịch Auto ${selectedChannelIds.length} Kênh -> ${selectedGpmIds.length} Nick`,
        channel_id: selectedChannelIds[0],
        channel_ids: selectedChannelIds,
        gpm_profile_id: selectedGpmIds[0],
        gpm_profile_ids: selectedGpmIds,
        distribution_mode: document.getElementById('campaignDistributionMode')?.value || 'parallel_slots',
        download_dir: document.getElementById('campaignDownloadDir')?.value.trim() || 'data/downloads',
        render_dir: document.getElementById('campaignRenderDir')?.value.trim() || 'data/rendered',
        aspect_ratio: campAspectRatio,
        preset_name: campAspectRatio === '9:16_blur' ? 'TikTok Beta Chuẩn 9:16 (Nền Mờ)' : (campAspectRatio === '9:16_split' ? '9:16 Split Screen Ghép 2 Tầng' : 'TikTok Chuẩn 9:16'),
        split_source_type: splitSourceType,
        split_folder: splitFolder,
        split_keywords: splitKeywords,
        split_provider: splitProvider,
        video_duration: parseInt(document.getElementById('campaignVideoDuration')?.value, 10) || 65,
        min_video_duration: minDurVal ? parseInt(minDurVal, 10) : null,
        max_video_duration: maxDurVal ? parseInt(maxDurVal, 10) : null,
        include_shorts: incShorts,
        include_longform: incLong,
        shorts_keep_original: document.getElementById('campaignShortsKeepOriginal')?.checked ? 1 : 0,
        ai_model: document.getElementById('campaignAiModel')?.value || 'default',
        ai_provider: (document.getElementById('campaignAiModel')?.value || '').startsWith('gemini') ? 'gemini' : ((document.getElementById('campaignAiModel')?.value || '').startsWith('gpt') ? 'openai' : 'deepseek'),
        hook_angle: document.getElementById('campaignHookAngle')?.value || 'auto',
        generate_variants: document.getElementById('campaignGenerateVariants')?.checked ? 1 : 0,
        subtitle_enabled: document.getElementById('campaignSubtitleSwitch')?.checked ? 1 : 0,
        disable_subtitle_for_shorts: document.getElementById('campaignDisableSubtitleForShorts')?.checked ? 1 : 0,
        subtitle_style: document.getElementById('campaignSubtitleStyle')?.value || 'karaoke_yellow',
        subtitle_position: document.getElementById('campaignSubtitlePosition')?.value || 'center',
        add_part_label: document.getElementById('campaignAddPartLabelSwitch')?.checked ? 1 : 0,
        clips_per_video: clipsPerVid,
        speed_factor: document.getElementById('campaignSpeedSwitch')?.checked ? 1.03 : 1.0,
        flip_horizontal: document.getElementById('campaignFlipSwitch')?.checked ? 1 : 0,
        daily_limit: safeDailyLimit,
        post_schedule: cleanScheduleStr,
        post_frequency: freq,
        post_interval_days: intervalDays,
        post_days_of_week: daysOfWeek || 'mon,tue,wed,thu,fri,sat,sun',
        random_delay_minutes: randomDelay,
        min_post_interval_minutes: document.getElementById('campaignMinPostIntervalSelect')?.value ? parseInt(document.getElementById('campaignMinPostIntervalSelect').value, 10) : null,
        warmup_mode: warmup,
        warmup_only: isWarmupOnly,
        warmup_duration_mins: parseInt(document.getElementById('campaignWarmupDurationSelect')?.value, 10) || 10,
        is_active: 1,
        auto_engagement_enabled: document.getElementById('campaignAutoEngagementSwitch')?.checked ? 1 : 0,
        auto_pin_comment: document.getElementById('campaignAutoPinCommentSwitch')?.checked ? 1 : 0,
        pin_comment_delay_mins: parseInt(document.getElementById('campaignPinCommentDelaySelect')?.value, 10) || 3,
        auto_reply_comments: document.getElementById('campaignAutoReplyCommentsSwitch')?.checked ? 1 : 0,
        reply_comments_delay_mins: parseInt(document.getElementById('campaignReplyCommentsDelaySelect')?.value, 10) || 20,
        narration_enabled: document.getElementById('campaignNarrationSwitch')?.checked ? 1 : 0,
        narration_language: document.getElementById('campaignNarrationLanguage')?.value || 'original',
        voice_gender: document.getElementById('campaignVoiceGender')?.value || 'male',
        narration_style: document.getElementById('campaignNarrationStyle')?.value || 'giat_gan',
        disable_narration_for_shorts: document.getElementById('campaignDisableNarrationForShorts')?.checked ? 1 : 0,

        ken_burns_enabled: document.getElementById('campaignKenBurnsSwitch')?.checked ? 1 : 0,
        endcard_enabled: document.getElementById('campaignEndcardSwitch')?.checked ? 1 : 0,
        auto_upload: autoUpload,
        source_mode: sourceMode,
        local_folder_path: localFolder,
        target_platforms: targetPlatforms.join(','),
        youtube_profile_ids: gpmBoxes.filter(b => b.getAttribute('data-platform') === 'youtube' && b.getAttribute('data-channel-id')).map(b => b.getAttribute('data-channel-id')).join(','),
        facebook_profile_ids: gpmBoxes.filter(b => b.getAttribute('data-platform') === 'facebook' && b.getAttribute('data-channel-id')).map(b => b.getAttribute('data-channel-id')).join(','),
        tts_engine: 'edge-tts'
    };

    try {
        const res = await fetch('/api/campaigns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = {};
        try {
            data = await res.json();
        } catch (_) {
            data = { detail: 'Lỗi máy chủ (' + res.status + '): Phản hồi không hợp lệ' };
        }
        if (res.ok && data.status === 'success') {
            showToast(`✅ Đã tạo chiến dịch tự động thành công! (${selectedChannelIds.length} kênh &rarr; ${selectedGpmIds.length} nick TikTok)`, 'success');
            closeNewCampaignModal();
            loadCampaigns();
            loadPipelineStatus();
        } else {
            showToast('Lỗi: ' + (data.detail || data.message || 'Không thể tạo chiến dịch'), 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Kích Hoạt Chiến Dịch Tự Động';
        }
    }
}

async function toggleCampaign(id, btn) {
    const camp = cachedCampaigns.find(c => c.id === id);
    const isCurrentlyActive = camp ? (camp.is_active === 1) : false;
    // Nếu chiến dịch đang tắt và người dùng muốn BẬT -> bắt buộc phải có License Key hợp lệ
    if (!isCurrentlyActive && window.LicenseManager && !window.LicenseManager.requireLicense('Kích Hoạt Chiến Dịch')) {
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Lưu...';
    }
    try {
        const res = await fetch(`/api/campaigns/${id}/toggle`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(data.is_active ? '✅ Đã kích hoạt chiến dịch!' : '⏸️ Đã tạm dừng chiến dịch.');
            await loadCampaigns();
        } else {
            showToast('Lỗi thay đổi trạng thái chiến dịch', true);
            if (btn) btn.disabled = false;
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, true);
        if (btn) btn.disabled = false;
    }
}

async function deleteCampaign(id) {
    const camp = cachedCampaigns.find(c => c.id === id);
    const rawName = camp ? (camp.name || `Chiến dịch #${id}`) : `Chiến dịch #${id}`;
    const campName = rawName.length > 36 ? rawName.slice(0, 33) + '...' : rawName;
    const ok = await showConfirmDialog({
        title: 'Xóa Chiến Dịch Tự Động',
        message: `Bạn có chắc chắn muốn xóa chiến dịch "${campName}"?`,
        details: 'Các thiết lập tự động hóa, chu kỳ quét RSS và lịch đăng của chiến dịch này sẽ dừng ngay lập tức.',
        confirmText: 'Xóa Chiến Dịch',
        confirmClass: 'btn-danger'
    });
    if (!ok) return;

    try {
        const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Đã xóa chiến dịch thành công!');
            loadCampaigns();
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, true);
    }
}

// ==========================================
// 9.1 EDIT CAMPAIGN MODAL LOGIC
// ==========================================
let editCampaignOriginalData = null;

function syncCampaignVariantModeUI(type, mode) {
    const isVariants = (mode === 'variants');
    const pfx = (type === 'edit') ? 'editCampaign' : 'campaign';

    const hookAngleWrap = document.getElementById(`${pfx}HookAngleWrap`);
    const noticeWrap = document.getElementById(`${pfx}VariantsNoticeWrap`);
    const clipsCol = document.getElementById(`${pfx}ClipsColWrap`);
    const genCheck = document.getElementById(`${pfx}GenerateVariants`);
    const partSwitch = document.getElementById(`${pfx}AddPartLabelSwitch`);

    if (genCheck) genCheck.checked = isVariants;

    if (isVariants) {
        if (hookAngleWrap) hookAngleWrap.style.display = 'none';
        if (noticeWrap) noticeWrap.style.display = 'block';
        if (clipsCol) clipsCol.style.display = 'none';
        if (partSwitch) partSwitch.checked = false;
    } else {
        if (hookAngleWrap) hookAngleWrap.style.display = 'block';
        if (noticeWrap) noticeWrap.style.display = 'none';
        if (clipsCol) clipsCol.style.display = 'block';
        if (partSwitch) partSwitch.checked = true;
    }
}
window.syncCampaignVariantModeUI = syncCampaignVariantModeUI;

async function openEditCampaignModal(id) {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Chỉnh Sửa Chiến Dịch')) {
        return;
    }
    const modal = document.getElementById('editCampaignModal');
    if (!modal) return;
    switchModalTab('edit', 'source');

    modal.classList.add('show');
    modal.classList.add('active');
    const chListEl = document.getElementById('editCampaignChannelsList');
    const gpmListEl = document.getElementById('editCampaignGpmList');
    if (chListEl) chListEl.innerHTML = '<div class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Đang nạp danh sách kênh...</div>';
    if (gpmListEl) gpmListEl.innerHTML = '<div class="text-muted text-center py-2"><i class="fa-solid fa-spinner fa-spin"></i> Đang nạp profile GPMLogin...</div>';

    try {
        // Fetch campaign details
        const res = await fetch(`/api/campaigns/${id}`);
        const c = await res.json();
        editCampaignOriginalData = c;

        document.getElementById('editCampaignId').value = c.id;
        document.getElementById('editCampaignNameInput').value = c.name || '';

        // Reset sort states & buttons
        editCampaignChannelsSortAsc = true;
        editCampaignGpmSortAsc = true;
        updateCampaignSortBtnUI('btnEditSortCampaignChannels', 'editSortCampaignChannelsIcon', 'editSortCampaignChannelsText', true);
        updateCampaignSortBtnUI('btnEditSortCampaignGpm', 'editSortCampaignGpmIcon', 'editSortCampaignGpmText', true);

        // Reset channel & gpm search filters & group dropdowns
        const editChSearch = document.getElementById('editCampaignChannelFilterInput');
        if (editChSearch) editChSearch.value = '';
        const editChGrpSel = document.getElementById('editCampaignChannelGroupFilter');
        if (editChGrpSel) editChGrpSel.value = 'all';
        const editGpmSearch = document.getElementById('editCampaignGpmFilterInput');
        if (editGpmSearch) editGpmSearch.value = '';
        const editGpmGrpSel = document.getElementById('editCampaignGpmGroupFilter');
        if (editGpmGrpSel) editGpmGrpSel.value = 'all';

        // Restore Source Mode & Local Folder
        updateCampaignSourceModeUI('edit', 'youtube');
        const tCheck = document.getElementById('editCampTargetTikTok');
        if (tCheck) tCheck.checked = true;
        const editAutoUploadSwitch = document.getElementById('editCampaignAutoUploadSwitch');
        if (editAutoUploadSwitch) {
            editAutoUploadSwitch.checked = (c.auto_upload !== 0);
            toggleCampaignAutoUpload('edit', editAutoUploadSwitch.checked);
        }

        // Concurrently fetch fresh campaign, channels, profiles and groups in parallel
        const [cRes, chRes, gpmRes, grpRes, defData] = await Promise.all([
            fetch('/api/campaigns').then(r => r.ok ? r.json() : []).catch(() => cachedCampaigns || []),
            (!modalAllSavedChannels || !modalAllSavedChannels.length)
                ? fetch('/api/youtube/channels').then(r => r.ok ? r.json() : []).catch(() => [])
                : Promise.resolve(modalAllSavedChannels),
            (!modalAllGpmProfiles || !modalAllGpmProfiles.length)
                ? fetch('/api/gpm/profiles').then(r => r.ok ? r.json() : []).catch(() => [])
                : Promise.resolve(modalAllGpmProfiles),
            (!window.cachedChannelGroups || !window.cachedChannelGroups.length)
                ? fetch('/api/channel-groups').then(r => r.ok ? r.json() : null).catch(() => null)
                : Promise.resolve(null),
            fetch('/api/settings/defaults').then(r => r.ok ? r.json() : {}).catch(() => ({}))
        ]);

        if (Array.isArray(cRes)) cachedCampaigns = cRes;
        if (Array.isArray(chRes) && chRes.length) {
            modalAllSavedChannels = chRes;
            window.cachedSavedChannels = chRes;
        }
        if (Array.isArray(gpmRes) && gpmRes.length) {
            modalAllGpmProfiles = gpmRes;
            window.cachedProfiles = gpmRes;
        }
        if (grpRes && grpRes.status === 'success' && grpRes.groups) {
            window.cachedChannelGroups = grpRes.groups;
        }

        const { usedChannelIds, usedProfileIds } = getUsedCampaignResources(c.id);

        const curEditCheckedCh = Array.from(document.querySelectorAll('#editCampaignChannelsList .edit-campaign-ch-check:checked')).map(b => b.value);
        const curEditCheckedGpm = Array.from(document.querySelectorAll('#editCampaignGpmList .edit-campaign-gpm-check:checked')).map(b => b.value);
        const editChToSelect = curEditCheckedCh.length ? curEditCheckedCh : (c.channel_ids_list || []);
        const editGpmToSelect = curEditCheckedGpm.length ? curEditCheckedGpm : (c.gpm_profile_ids_list || []);

        editModalAvailableSavedChannels = (modalAllSavedChannels || []).filter(ch => !usedChannelIds.has(String(ch.channel_id).trim()) || editChToSelect.includes(String(ch.channel_id).trim()));
        editModalAvailableGpmProfiles = (modalAllGpmProfiles || []).filter(p => (!usedProfileIds.has(String(p.id).trim()) && (!p.gpm_id || !usedProfileIds.has(String(p.gpm_id).trim()))) || editGpmToSelect.includes(String(p.id)));

        renderEditCampaignChannelsCheckboxes(editModalAvailableSavedChannels, editChToSelect);
        renderEditCampaignGpmCheckboxes(editModalAvailableGpmProfiles, editGpmToSelect);

        await populateCampaignGroupFilters('edit');

        // Directories
        let defaultDl = 'data/downloads';
        let defaultRd = 'data/rendered';
        if (defData) {
            if (defData.download_dir) defaultDl = defData.download_dir;
            if (defData.render_dir) defaultRd = defData.render_dir;
        }

        const editDlInput = document.getElementById('editCampaignDownloadDir');
        const editRdInput = document.getElementById('editCampaignRenderDir');
        if (editDlInput) {
            editDlInput.value = (c.download_dir && isAbsolutePath(c.download_dir)) ? c.download_dir : defaultDl;
        }
        if (editRdInput) {
            editRdInput.value = (c.render_dir && isAbsolutePath(c.render_dir)) ? c.render_dir : defaultRd;
        }

        // Edit Recipe
        const aspectSel = document.getElementById('editCampaignAspectRatio');
        if (aspectSel) {
            aspectSel.value = c.aspect_ratio || '9:16_blur';
            if (typeof handleAspectRatioChange === 'function') handleAspectRatioChange('editCampaign', aspectSel.value);
        }
        const editSplitType = c.split_source_type || 'local';
        const editLocRadio = document.getElementById('editCampaignSplitSourceLocal');
        const editStRadio = document.getElementById('editCampaignSplitSourceStock');
        if (editSplitType === 'stock') {
            if (editStRadio) editStRadio.checked = true;
        } else {
            if (editLocRadio) editLocRadio.checked = true;
        }
        if (typeof handleSplitSourceChange === 'function') handleSplitSourceChange('editCampaign', editSplitType);
        const editSplitFld = document.getElementById('editCampaignSplitFolder');
        if (editSplitFld) editSplitFld.value = c.split_folder || 'data/gameplay';
        const editSplitKw = document.getElementById('editCampaignSplitKeywords');
        if (editSplitKw) editSplitKw.value = c.split_keywords || 'minecraft parkour, satisfying asmr, subway surfers, soap cutting';
        const editSplitProv = document.getElementById('editCampaignSplitProvider');
        if (editSplitProv) editSplitProv.value = c.split_provider || 'all';

        const durSel = document.getElementById('editCampaignVideoDuration');
        if (durSel) durSel.value = String(c.video_duration || 65);

        const editIncShorts = document.getElementById('editCampaignIncludeShorts');
        if (editIncShorts) editIncShorts.checked = (c.include_shorts !== 0);

        const editIncLong = document.getElementById('editCampaignIncludeLongform');
        if (editIncLong) editIncLong.checked = (c.include_longform !== 0);

        const minDurInput = document.getElementById('editCampaignMinDurationInput');
        applyMinDurationState(editIncShorts, editIncLong, minDurInput, c.min_video_duration ?? null);

        const maxDurInput = document.getElementById('editCampaignMaxDurationInput');
        if (maxDurInput) maxDurInput.value = (c.max_video_duration != null) ? c.max_video_duration : '';

        const aiModelSel = document.getElementById('editCampaignAiModel');
        if (aiModelSel) aiModelSel.value = c.ai_model || 'default';

        // Load Hook Angle & Variants Mode for Edit Campaign
        const editVarModeSel = document.getElementById('editCampaignVariantMode');
        const editHookAngleSel = document.getElementById('editCampaignHookAngle');
        const isVariantsMode = (c.generate_variants === 1);
        if (editVarModeSel) {
            editVarModeSel.value = isVariantsMode ? 'variants' : 'single';
            syncCampaignVariantModeUI('edit', editVarModeSel.value);
        }
        if (editHookAngleSel) {
            editHookAngleSel.value = c.hook_angle || 'auto';
        }

        const subSwitch = document.getElementById('editCampaignSubtitleSwitch');
        if (subSwitch) subSwitch.checked = c.subtitle_enabled === 1;

        const editCampNoSubShorts = document.getElementById('editCampaignDisableSubtitleForShorts');
        if (editCampNoSubShorts) editCampNoSubShorts.checked = (c.disable_subtitle_for_shorts !== 0);

        // Show/hide subtitle settings based on subtitle_enabled
        const editSubWrap = document.getElementById('editCampaignSubtitleSettingsWrap');
        if (editSubWrap) editSubWrap.style.display = (c.subtitle_enabled === 1) ? '' : 'none';

        const subStyle = document.getElementById('editCampaignSubtitleStyle');
        if (subStyle) subStyle.value = c.subtitle_style || 'karaoke_yellow';

        const subPos = document.getElementById('editCampaignSubtitlePosition');
        if (subPos) subPos.value = c.subtitle_position || 'center';

        // Load cài đặt Lồng tiếng AI & ElevenLabs cho Edit Campaign
        const editNarrSwitch = document.getElementById('editCampaignNarrationSwitch');
        const editNarrWrap = document.getElementById('editCampaignNarrationWrap');
        const editNarrLang = document.getElementById('editCampaignNarrationLanguage');
        const editNarrGender = document.getElementById('editCampaignVoiceGender');
        const editNarrStyle = document.getElementById('editCampaignNarrationStyle');
        if (editNarrSwitch) {
            editNarrSwitch.checked = (c.narration_enabled !== 0);
            toggleCampaignNarration('edit', editNarrSwitch.checked);
        }

        if (editNarrLang) editNarrLang.value = c.narration_language || 'original';
        updateVoiceDropdownOptions('editCampaignVoiceGender', c.narration_language || 'original', c.voice_gender || 'male', false);
        if (editNarrStyle) editNarrStyle.value = c.narration_style || 'giat_gan';
        const editNoNarrShorts = document.getElementById('editCampaignDisableNarrationForShorts');
        if (editNoNarrShorts) editNoNarrShorts.checked = (c.disable_narration_for_shorts !== 0);

        const editMpImgSwitch = document.getElementById('editCampaignUseAiImages');
        const editMpImgWrap = document.getElementById('editCampaignImageStyleWrap');
        const editMpImgStyle = document.getElementById('editCampaignImageStyle');
        if (editMpImgSwitch) {
            editMpImgSwitch.checked = (c.use_ai_images === 1);
        }
        if (editMpImgStyle && c.image_style) editMpImgStyle.value = c.image_style;
        const editVisualSource = document.getElementById('editCampaignVisualSource');
        if (editVisualSource && c.visual_source) {
            editVisualSource.value = c.visual_source;
            const editStockWrap = document.getElementById('editCampaignStockWrap');
            if (editStockWrap) {
                editStockWrap.style.display = (c.visual_source === 'stock' || c.visual_source === 'mixed') ? 'block' : 'none';
            }
        }
        const editAiModel = document.getElementById('editCampaignAiImageModel');
        if (editAiModel && c.ai_image_model) editAiModel.value = c.ai_image_model;
        const editAiVideoModel = document.getElementById('editCampaignAiVideoModel');
        if (editAiVideoModel && c.ai_video_model) editAiVideoModel.value = c.ai_video_model;
        const editStockProvider = document.getElementById('editCampaignStockProvider');
        if (editStockProvider && c.stock_provider) editStockProvider.value = c.stock_provider;


        const editKbSwitch = document.getElementById('editCampaignKenBurnsSwitch');
        if (editKbSwitch) editKbSwitch.checked = (c.ken_burns_enabled !== 0);
        const editEcSwitch = document.getElementById('editCampaignEndcardSwitch');
        if (editEcSwitch) editEcSwitch.checked = (c.endcard_enabled !== 0);

        const flipSwitch = document.getElementById('editCampaignFlipSwitch');
        if (flipSwitch) flipSwitch.checked = c.flip_horizontal === 1;

        const clipsPerVidInput = document.getElementById('editCampaignClipsPerVideoInput');
        const clipsVal = c.clips_per_video || 3;
        if (clipsPerVidInput) clipsPerVidInput.value = clipsVal;
        handleCampaignClipsInputChange('edit', clipsVal);
        if (clipsVal > 1) {
            const partSwitch = document.getElementById('editCampaignAddPartLabelSwitch');
            if (partSwitch) partSwitch.checked = c.add_part_label !== 0;
        }

        const speedSwitch = document.getElementById('editCampaignSpeedSwitch');
        if (speedSwitch) speedSwitch.checked = (c.speed_factor && c.speed_factor > 1.0);

        const editShortsKeep = document.getElementById('editCampaignShortsKeepOriginal');
        if (editShortsKeep) editShortsKeep.checked = (c.shorts_keep_original !== 0);

        // Multi-Account & Schedule
        const distMode = document.getElementById('editCampaignDistributionMode');
        if (distMode) distMode.value = c.distribution_mode || 'round_robin';

        const dailyLim = document.getElementById('editCampaignDailyLimitInput');
        if (dailyLim) dailyLim.value = c.daily_limit || 3;

        const freqSel = document.getElementById('editCampaignFrequencySelect');
        if (freqSel) freqSel.value = c.post_frequency || 'daily';
        onEditCampaignFrequencyChange(c.post_frequency || 'daily');

        const customInt = document.getElementById('editCampaignCustomIntervalInput');
        if (customInt) customInt.value = c.post_interval_days || 2;

        // Check days of week
        const dows = (c.post_days_of_week || 'mon,tue,wed,thu,fri,sat,sun').split(',').map(s => s.trim().toLowerCase());
        document.querySelectorAll('.edit-campaign-dow-check').forEach(chk => {
            chk.checked = dows.includes(chk.value.toLowerCase());
        });

        const schedInput = document.getElementById('editCampaignScheduleInput');
        if (schedInput) schedInput.value = c.post_schedule || '11:30, 18:00, 20:30';

        const randDelay = document.getElementById('editCampaignRandomDelaySelect');
        if (randDelay) randDelay.value = String(c.random_delay_minutes !== undefined ? c.random_delay_minutes : 10);

        const editMinInterval = document.getElementById('editCampaignMinPostIntervalSelect');
        if (editMinInterval) editMinInterval.value = c.min_post_interval_minutes ? String(c.min_post_interval_minutes) : '';

        const warmup = document.getElementById('editCampaignWarmupSwitch');
        if (warmup) warmup.checked = c.warmup_mode === 1;

        const editWarmupOnly = document.getElementById('editCampaignWarmupOnlySwitch');
        if (editWarmupOnly) {
            editWarmupOnly.checked = (c.warmup_only === 1);
            toggleCampaignWarmupOnly('edit', c.warmup_only === 1);
        }
        const editWarmupDur = document.getElementById('editCampaignWarmupDurationSelect');
        if (editWarmupDur) editWarmupDur.value = String(c.warmup_duration_mins || 10);


        // Golden 30-Minute Engagement restore
        const autoEngSwitch = document.getElementById('editCampaignAutoEngagementSwitch');
        const isEngOn = c.auto_engagement_enabled === 1;
        if (autoEngSwitch) autoEngSwitch.checked = isEngOn;
        toggleCampaignAutoEngagement('edit', isEngOn);
        toggleCampaignEngagementOptions('edit', isEngOn);

        const autoPinSwitch = document.getElementById('editCampaignAutoPinCommentSwitch');
        if (autoPinSwitch) autoPinSwitch.checked = (c.auto_pin_comment !== 0);

        const pinDelaySel = document.getElementById('editCampaignPinCommentDelaySelect');
        if (pinDelaySel) pinDelaySel.value = String(c.pin_comment_delay_mins || 3);

        const autoRepSwitch = document.getElementById('editCampaignAutoReplyCommentsSwitch');
        if (autoRepSwitch) autoRepSwitch.checked = (c.auto_reply_comments !== 0);

        const repDelaySel = document.getElementById('editCampaignReplyCommentsDelaySelect');
        if (repDelaySel) repDelaySel.value = String(c.reply_comments_delay_mins || 20);

    } catch (err) {
        showToast('Lỗi nạp thông tin chiến dịch: ' + err.message, true);
        closeEditCampaignModal();
    }
}

function closeEditCampaignModal() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    const modal = document.getElementById('editCampaignModal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
    }
}

function renderEditCampaignChannelsCheckboxes(channels, selectedIds = []) {
    const chListEl = document.getElementById('editCampaignChannelsList');
    if (!chListEl) return;

    if (!channels || !channels.length) {
        const allList = (modalAllSavedChannels && modalAllSavedChannels.length) ? modalAllSavedChannels : (window.modalAllSavedChannels || []);
        const hasSaved = allList && allList.length > 0;
        chListEl.innerHTML = hasSaved ? `
            <div class="text-muted text-center py-4" style="font-size:12.5px; padding: 20px 10px;">
                <i class="fa-solid fa-circle-info" style="font-size:22px; color:var(--accent-cyan); display:block; margin-bottom:8px;"></i>
                Tất cả kênh YouTube đã được phân bổ vào các chiến dịch khác.
            </div>
        ` : '<div class="text-muted text-center py-3" style="font-size:12px;">Chưa có kênh nào được lưu.</div>';
        updateEditSelectedChannelsCount();
        return;
    }

    const selSet = new Set((selectedIds || []).map(String));

    const sorted = [...channels].sort((a, b) => {
        const nameA = (a.display_name || a.title || '').toLowerCase();
        const nameB = (b.display_name || b.title || '').toLowerCase();
        return editCampaignChannelsSortAsc
            ? nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' })
            : nameB.localeCompare(nameA, 'vi', { sensitivity: 'base' });
    });

    chListEl.innerHTML = sorted.map(ch => {
        const isChecked = selSet.has(String(ch.channel_id));
        const grpBadge = ch.group_name
            ? `<span class="badge" title="Nhóm: ${escapeHtml(ch.group_name)}" style="font-size:9.5px; background:rgba(99,102,241,0.15); color:#818cf8; border:1px solid rgba(99,102,241,0.3); padding:1px 6px; border-radius:4px; flex-shrink:0; max-width:130px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle;"><i class="${escapeHtml(ch.group_icon || 'fa-solid fa-folder')}" style="flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ch.group_name)}</span></span>`
            : '';
        return `
            <label class="multi-select-item" data-channel-id="${escapeHtml(ch.channel_id)}" data-group-id="${escapeHtml(String(ch.group_id || ''))}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; min-width:0; overflow:hidden; min-height:42px; margin-bottom:4px;">
                <input type="checkbox" class="edit-campaign-ch-check" value="${escapeHtml(ch.channel_id)}" ${isChecked ? 'checked' : ''} onchange="updateEditSelectedChannelsCount()" style="flex-shrink:0;">
                <i class="fa-brands fa-youtube" style="color:#ff0000; font-size:14px; flex-shrink:0;"></i>
                <span style="font-weight:600; color:#fff; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(ch.display_name || ch.title)}">${escapeHtml(ch.display_name || ch.title)}</span>
                ${grpBadge}
                <span style="font-size:11px; color:var(--accent-cyan); white-space:nowrap; flex-shrink:0;">${formatNumber(ch.subscriber_count || 0)} subs</span>
                <span class="badge badge-secondary" style="font-size:10px; white-space:nowrap; flex-shrink:0;">${escapeHtml(ch.country || 'US')}</span>
            </label>
        `;
    }).join('');
    chListEl.scrollTop = 0;

    updateEditSelectedChannelsCount();
}

function renderEditCampaignGpmCheckboxes(profiles, selectedIds = []) {
    const gpmListEl = document.getElementById('editCampaignGpmList');
    if (!gpmListEl) return;

    if (!profiles || !profiles.length) {
        const allList = (modalAllGpmProfiles && modalAllGpmProfiles.length) ? modalAllGpmProfiles : (window.modalAllGpmProfiles || []);
        const hasProfiles = allList && allList.length > 0;
        gpmListEl.innerHTML = hasProfiles ? `
            <div class="text-muted text-center py-4" style="font-size:12.5px; padding: 20px 10px;">
                <i class="fa-solid fa-circle-info" style="font-size:22px; color:var(--accent-gold); display:block; margin-bottom:8px;"></i>
                Tất cả tài khoản / profile đã được gán vào các chiến dịch khác.
            </div>
        ` : '<div class="text-muted text-center py-3" style="font-size:12px;">Chưa có profile nào.</div>';
        updateEditSelectedGpmCount();
        return;
    }

    const selSet = new Set((selectedIds || []).map(String));
    const itemsHtml = [];

    const sorted = [...profiles].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return editCampaignGpmSortAsc
            ? nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' })
            : nameB.localeCompare(nameA, 'vi', { sensitivity: 'base' });
    });

    sorted.forEach(p => {
        const plat = (p.platform || 'tiktok').toLowerCase();
        const hasSubChannels = (plat === 'youtube' || plat === 'facebook') && Array.isArray(p.channels) && p.channels.length > 0;
        const grpName = getCampaignProfileGroupName(p);
        const grpBadge = grpName
            ? `<span class="badge" title="Nhóm: ${escapeHtml(grpName)}" style="background:rgba(99,102,241,0.15); color:#a5b4fc; border:1px solid rgba(99,102,241,0.3); font-size:9.5px; padding:1px 6px; border-radius:4px; flex-shrink:0; max-width:120px; display:inline-flex; align-items:center; gap:4px; vertical-align:middle;"><i class="fa-solid fa-folder" style="flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(grpName)}</span></span>`
            : '';

        if (hasSubChannels) {
            p.channels.forEach(ch => {
                let platIcon = '<i class="fa-brands fa-youtube" style="color:#ef4444; font-size:14px;"></i>';
                let platColor = '#ef4444';
                let typeBadge = '';
                const count = ch.followers_count || 0;
                const flwText = plat === 'youtube' ? 'subs' : 'flw';

                if (plat === 'youtube') {
                    platIcon = '<i class="fa-brands fa-youtube" style="color:#ef4444; font-size:14px;"></i>';
                    platColor = '#ef4444';
                    typeBadge = ch.is_default
                        ? `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3);" data-i18n="campaign_channel_default">${window.i18n ? window.i18n.t('campaign_channel_default', 'Mặc định') : 'Mặc định'}</span>`
                        : `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(255,255,255,0.08); color:var(--text-secondary);" data-i18n="campaign_channel_sub">${window.i18n ? window.i18n.t('campaign_channel_sub', 'Kênh phụ') : 'Kênh phụ'}</span>`;
                } else if (plat === 'facebook') {
                    platIcon = '<i class="fa-brands fa-facebook" style="color:#1877f2; font-size:14px;"></i>';
                    platColor = '#60a5fa';
                    typeBadge = ch.is_default
                        ? `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);" data-i18n="campaign_fb_personal">${window.i18n ? window.i18n.t('campaign_fb_personal', 'Cá nhân') : 'Cá nhân'}</span>`
                        : `<span class="badge" style="font-size:9.5px; flex-shrink:0; white-space:nowrap; background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3);" data-i18n="campaign_fb_fanpage">${window.i18n ? window.i18n.t('campaign_fb_fanpage', 'Fanpage') : 'Fanpage'}</span>`;
                }

                const chTitle = ch.channel_name || ch.channel_url || p.name;
                const chSub = ch.channel_url || '';
                const isChecked = selSet.has(String(p.id)) && (ch.is_default || p.channels.length === 1);

                const bType = (p.browser_type || 'gpm').toLowerCase();
                const bBadge = bType === 'genlogin'
                    ? '<span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; font-size:9px; padding:1px 4px; flex-shrink:0;">GEN</span>'
                    : '<span class="badge" style="background:rgba(59,130,246,0.18); color:#93c5fd; font-size:9px; padding:1px 4px; flex-shrink:0;">GPM</span>';
                const bLabel = bType === 'genlogin' ? 'GenLogin' : (bType === 'adspower' ? 'AdsPower' : (bType === 'dolphin' ? 'Dolphin' : 'GPMLogin'));
                const accountKey = getCanonicalAccountKey(p, ch);
                const isDup = profiles.some(o => o.id !== p.id && getCanonicalAccountKey(o, ch) === accountKey);
                const dupBadge = isDup ? '<span class="badge" style="background:rgba(234,179,8,0.18); color:#eab308; font-size:9px; padding:1px 4px; flex-shrink:0;" title="Tài khoản này có mặt trên nhiều trình duyệt"><i class="fa-solid fa-link"></i> Trùng nick</span>' : '';

                itemsHtml.push(`
                <label class="multi-select-item" data-platform="${plat}" data-group-name="${escapeHtml(grpName)}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; min-width:0; overflow:hidden; min-height:42px; margin-bottom:4px;">
                    <input type="checkbox" class="edit-campaign-gpm-check" value="${p.id}" data-gpm-id="${escapeHtml(p.gpm_id)}" data-account-key="${escapeHtml(accountKey)}" data-browser-label="${escapeHtml(bLabel)}" data-profile-name="${escapeHtml(p.name)}" data-channel-id="${escapeHtml(ch.channel_id || '')}" data-channel-name="${escapeHtml(chTitle)}" data-platform="${plat}" ${isChecked ? 'checked' : ''} onchange="syncCampaignDuplicateCheckboxes('edit'); if(this.checked && '${escapeHtml(ch.channel_id)}') handleChannelSelectionChange('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}')" style="flex-shrink:0;">
                    <span style="flex-shrink:0; display:inline-flex; align-items:center;">${platIcon}</span>
                    <div style="flex:1; min-width:0; display:flex; align-items:center; gap:8px; overflow:hidden;">
                        ${bBadge}
                        <span style="font-size:11px; flex-shrink:0; color:var(--text-secondary); background:rgba(255,255,255,0.06); padding:1px 6px; border-radius:4px; white-space:nowrap; max-width:110px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                        <span style="font-weight:600; color:#fff; min-width:0; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${escapeHtml(chTitle)}">${escapeHtml(chTitle)}</span>
                        ${grpBadge}
                        ${typeBadge}
                        ${dupBadge}
                    </div>
                    <div style="margin-left:auto; display:flex; align-items:center; gap:10px; flex-shrink:0;">
                        <span style="font-size:11px; color:${platColor}; white-space:nowrap; max-width:140px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(chSub)}">${escapeHtml(chSub)}</span>
                        <span class="badge ${count >= 1000 ? 'badge-success' : 'badge-secondary'}" style="font-size:10px; white-space:nowrap; flex-shrink:0;">${count.toLocaleString()} ${flwText}</span>
                    </div>
                </label>
                `);
            });
        } else {
            const isChecked = selSet.has(String(p.id));
            let platIcon = '<i class="fa-brands fa-tiktok" style="color:#ff0050; font-size:14px;"></i>';
            let platColor = 'var(--accent-gold)';
            let displayName = `@${escapeHtml(p.tiktok_username || 'Chưa gắn')}`;
            if (plat === 'youtube') {
                platIcon = '<i class="fa-brands fa-youtube" style="color:#ef4444; font-size:14px;"></i>';
                platColor = '#ef4444';
                displayName = escapeHtml(p.channel_handle || p.tiktok_username || 'YouTube');
            } else if (plat === 'facebook') {
                platIcon = '<i class="fa-brands fa-facebook" style="color:#1877f2; font-size:14px;"></i>';
                platColor = '#60a5fa';
                displayName = escapeHtml(p.tiktok_nickname || `FB: ${p.fb_page_id || p.tiktok_username || ''}`);
            }

            const bType = (p.browser_type || 'gpm').toLowerCase();
            const bBadge = bType === 'genlogin'
                ? '<span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; font-size:9px; padding:1px 4px; flex-shrink:0;">GEN</span>'
                : '<span class="badge" style="background:rgba(59,130,246,0.18); color:#93c5fd; font-size:9px; padding:1px 4px; flex-shrink:0;">GPM</span>';
            const bLabel = bType === 'genlogin' ? 'GenLogin' : (bType === 'adspower' ? 'AdsPower' : (bType === 'dolphin' ? 'Dolphin' : 'GPMLogin'));
            const accountKey = getCanonicalAccountKey(p);
            const isDup = profiles.some(o => o.id !== p.id && getCanonicalAccountKey(o) === accountKey);
            const dupBadge = isDup ? '<span class="badge" style="background:rgba(234,179,8,0.18); color:#eab308; font-size:9px; padding:1px 4px; flex-shrink:0;" title="Tài khoản này có mặt trên nhiều trình duyệt"><i class="fa-solid fa-link"></i> Trùng nick</span>' : '';

            itemsHtml.push(`
            <label class="multi-select-item" data-platform="${plat}" data-group-name="${escapeHtml(grpName)}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; font-size:12.5px; min-width:0; overflow:hidden; min-height:42px; margin-bottom:4px;">
                <input type="checkbox" class="edit-campaign-gpm-check" value="${p.id}" data-gpm-id="${escapeHtml(p.gpm_id)}" data-account-key="${escapeHtml(accountKey)}" data-browser-label="${escapeHtml(bLabel)}" data-profile-name="${escapeHtml(p.name)}" data-channel-id="" data-channel-name="${escapeHtml(displayName)}" data-platform="${plat}" ${isChecked ? 'checked' : ''} onchange="syncCampaignDuplicateCheckboxes('edit');" style="flex-shrink:0;">
                <span style="flex-shrink:0; display:inline-flex; align-items:center;">${platIcon}</span>
                <div style="flex:1; min-width:0; display:flex; align-items:center; gap:8px; overflow:hidden;">
                    ${bBadge}
                    <span style="font-weight:600; color:#fff; min-width:0; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
                    ${grpBadge}
                    ${dupBadge}
                </div>
                <div style="margin-left:auto; display:flex; align-items:center; gap:10px; flex-shrink:0;">
                    <span style="font-size:11px; color:${platColor}; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${displayName}">${displayName}</span>
                    <span class="badge ${p.eligible_10k ? 'badge-success' : 'badge-secondary'}" style="font-size:10px; white-space:nowrap; flex-shrink:0;">${(p.followers_count || 0).toLocaleString()} flw</span>
                </div>
            </label>
            `);
        }
    });

    gpmListEl.innerHTML = itemsHtml.join('');
    gpmListEl.scrollTop = 0;
    filterCampaignGpmAccounts('edit');
    syncCampaignDuplicateCheckboxes('edit');
}

function updateEditSelectedChannelsCount() {
    const checked = document.querySelectorAll('.edit-campaign-ch-check:checked');
    const badge = document.getElementById('editCampaignSelectedChannelsCount');
    if (badge) badge.textContent = `Đã chọn: ${checked.length} kênh`;
    updateSourceModeBadge('edit');
}

function updateEditSelectedGpmCount() {
    const checked = Array.from(document.querySelectorAll('.edit-campaign-gpm-check:checked')).filter(b => {
        const item = b.closest('label');
        return item && item.style.display !== 'none';
    });
    const badge = document.getElementById('editCampaignSelectedGpmCount');
    if (badge) badge.textContent = `Đã chọn: ${checked.length} nick`;
}

function selectAllEditCampaignChannels(select) {
    const boxes = document.querySelectorAll('.edit-campaign-ch-check');
    boxes.forEach(b => {
        if (b.closest('label').style.display !== 'none') {
            b.checked = select;
        }
    });
    updateEditSelectedChannelsCount();
    updateSourceModeBadge('edit');
}

function selectAllEditCampaignGpm(select) {
    const listEl = document.getElementById('editCampaignGpmList');
    if (!listEl) return;
    const boxes = Array.from(listEl.querySelectorAll('.edit-campaign-gpm-check'));
    if (!select) {
        boxes.forEach(b => { b.checked = false; });
    } else {
        const seenKeys = new Set();
        boxes.forEach(b => {
            const item = b.closest('label');
            if (item && item.style.display !== 'none') {
                const k = b.dataset.accountKey;
                if (k && seenKeys.has(k)) {
                    b.checked = false; // Không chọn duplicate account!
                } else {
                    b.checked = true;
                    if (k) seenKeys.add(k);
                }
            }
        });
    }
    syncCampaignDuplicateCheckboxes('edit');
}

function filterEditCampaignChannelList(query) {
    const q = (query !== undefined ? query : (document.getElementById('editCampaignChannelFilterInput')?.value || '')).toLowerCase().trim();
    const groupFilter = document.getElementById('editCampaignChannelGroupFilter')?.value || 'all';
    const items = document.querySelectorAll('#editCampaignChannelsList .multi-select-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        const groupId = item.getAttribute('data-group-id') || '';
        const matchQuery = !q || text.includes(q);
        let matchGroup = true;
        if (groupFilter === 'ungrouped') {
            matchGroup = !groupId || groupId === '0' || groupId === 'null';
        } else if (groupFilter !== 'all') {
            matchGroup = (groupId === groupFilter);
        }
        item.style.display = (matchQuery && matchGroup) ? 'flex' : 'none';
    });
}

function filterEditCampaignGpmList(query) {
    filterCampaignGpmAccounts('edit');
}

function onEditCampaignFrequencyChange(val) {
    const customWrap = document.getElementById('editCampaignCustomIntervalWrap');
    const daysWrap = document.getElementById('editCampaignDaysOfWeekWrap');
    if (customWrap) customWrap.style.display = val === 'custom_interval' ? 'block' : 'none';
    if (daysWrap) daysWrap.style.display = val === 'specific_days' ? 'block' : 'none';
}

function setEditCampaignSchedulePreset(val) {
    const inp = document.getElementById('editCampaignScheduleInput');
    if (inp) inp.value = val;
}

async function handleEditCampaignSubmit(e) {
    e.preventDefault();
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Lưu Chỉnh Sửa Chiến Dịch')) {
        return;
    }
    const campId = document.getElementById('editCampaignId')?.value;
    if (!campId) return;

    const btn = document.getElementById('btnSubmitEditCampaign');

    // Validate Campaign Name
    const campNameInput = document.getElementById('editCampaignNameInput');
    const campName = campNameInput ? campNameInput.value.trim() : '';

    const chBoxes = document.querySelectorAll('.edit-campaign-ch-check:checked');
    const selectedChannelIds = Array.from(chBoxes).map(b => b.value);
    const editLocalFolder = '';
    const editSourceMode = 'youtube';
    const isWarmupOnly = document.getElementById('editCampaignWarmupOnlySwitch')?.checked ? 1 : 0;

    if (!isWarmupOnly && selectedChannelIds.length === 0) {
        showToast('⚠️ Vui lòng chọn ít nhất 1 Kênh YouTube nguồn!', 'warning');
        switchModalTab('edit', 'source');
        return;
    }

    const autoUpload = isWarmupOnly ? 0 : (document.getElementById('editCampaignAutoUploadSwitch')?.checked ? 1 : 0);

    const gpmBoxes = Array.from(document.querySelectorAll('.edit-campaign-gpm-check:checked')).filter(b => {
        const item = b.closest('label');
        return item && item.style.display !== 'none';
    });
    const selectedGpmIds = Array.from(new Set(gpmBoxes.map(b => parseInt(b.value, 10)).filter(id => !isNaN(id))));
    if ((autoUpload || isWarmupOnly) && selectedGpmIds.length === 0) {
        showToast('⚠️ Vui lòng chọn ít nhất 1 Profile nhận video / nuôi nick!', 'warning');
        return;
    }

    let safeDailyLimit = 3;
    let cleanScheduleStr = "11:30, 18:00, 20:30";

    if (autoUpload) {
        // 1. Validate daily_limit
        const dailyLimitInput = document.getElementById('editCampaignDailyLimitInput');
        const rawDailyLimit = parseInt(dailyLimitInput?.value, 10);
        if (isNaN(rawDailyLimit) || rawDailyLimit < 1) {
            markInputError('editCampaignDailyLimitInput', 'Giới hạn video/ngày trên mỗi nick phải là số nguyên >= 1!');
            return;
        }
        safeDailyLimit = Math.max(1, rawDailyLimit);

        // 2. Validate post_schedule
        const scheduleInput = document.getElementById('editCampaignScheduleInput');
        const scheduleRaw = (scheduleInput?.value || '').trim();
        const rawSlots = scheduleRaw.split(',').map(s => s.trim()).filter(Boolean);
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        const invalidSlot = rawSlots.find(s => !timeRegex.test(s));
        if (!rawSlots.length || invalidSlot) {
            markInputError('editCampaignScheduleInput', `Khung giờ đăng không hợp lệ: "${invalidSlot || 'trống'}". Định dạng chuẩn: HH:MM`);
            return;
        }
        const safeSlots = Array.from(new Set(rawSlots.map(s => {
            const [h, m] = s.split(':');
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        })));
        cleanScheduleStr = safeSlots.join(', ');
    }

    const freq = document.getElementById('editCampaignFrequencySelect')?.value || 'daily';
    let intervalDays = 1;
    if (freq === 'every_2_days') intervalDays = 2;
    else if (freq === 'every_3_days') intervalDays = 3;
    else if (freq === 'custom_interval') {
        const customIntVal = parseInt(document.getElementById('editCampaignCustomIntervalInput')?.value, 10);
        if (isNaN(customIntVal) || customIntVal < 1 || customIntVal > 365) {
            markInputError('editCampaignCustomIntervalInput', 'Chu kỳ lặp lại phải từ 1 đến 365 ngày!');
            return;
        }
        intervalDays = customIntVal;
    }

    const editIncShorts = document.getElementById('editCampaignIncludeShorts')?.checked ? 1 : 0;
    const editIncLong = document.getElementById('editCampaignIncludeLongform')?.checked ? 1 : 0;
    if (!editIncShorts && !editIncLong) {
        showToast('⚠️ Vui lòng chọn ít nhất một định dạng video: Shorts hoặc Video Dài!', true);
        return;
    }

    const minDurVal = document.getElementById('editCampaignMinDurationInput')?.value.trim();
    const maxDurVal = document.getElementById('editCampaignMaxDurationInput')?.value.trim();
    if (minDurVal && maxDurVal) {
        const minD = parseInt(minDurVal, 10);
        const maxD = parseInt(maxDurVal, 10);
        if (minD >= maxD) {
            markInputError('editCampaignMinDurationInput', 'Thời lượng tối thiểu phải nhỏ hơn thời lượng tối đa!');
            return;
        }
    }

    const clipsPerVid = parseInt(document.getElementById('editCampaignClipsPerVideoInput')?.value, 10) || 3;
    if (clipsPerVid < 1 || clipsPerVid > 20) {
        markInputError('editCampaignClipsPerVideoInput', 'Số phần cắt mỗi video phải từ 1 đến 20!');
        return;
    }


    // Validate Split Screen (Ghép 2 tầng) nếu được chọn
    const editAspectRatio = document.getElementById('editCampaignAspectRatio')?.value || '9:16_blur';
    let editSplitSourceType = 'local';
    let editSplitFolder = 'data/gameplay';
    let editSplitKeywords = 'minecraft parkour, satisfying asmr, subway surfers';
    let editSplitProvider = 'all';

    if (editAspectRatio === '9:16_split') {
        const isLocal = document.getElementById('editCampaignSplitSourceLocal')?.checked;
        editSplitSourceType = isLocal ? 'local' : 'stock';
        if (isLocal) {
            editSplitFolder = document.getElementById('editCampaignSplitFolder')?.value.trim();
            if (!editSplitFolder) {
                markInputError('editCampaignSplitFolder', 'Vui lòng nhập đường dẫn thư mục chứa video phụ (Tầng Dưới) cho Split Screen!');
                return;
            }
        } else {
            editSplitKeywords = document.getElementById('editCampaignSplitKeywords')?.value.trim();
            if (!editSplitKeywords) {
                markInputError('editCampaignSplitKeywords', 'Vui lòng nhập từ khóa tìm kiếm Stock Video cho Split Screen!');
                return;
            }
            editSplitProvider = document.getElementById('editCampaignSplitProvider')?.value || 'all';
        }
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Lưu Thay Đổi...';
    }

    const dowBoxes = document.querySelectorAll('.edit-campaign-dow-check:checked');
    const daysOfWeek = Array.from(dowBoxes).map(b => b.value).join(',');
    const randomDelay = parseInt(document.getElementById('editCampaignRandomDelaySelect')?.value, 10) || 10;
    const warmup = document.getElementById('editCampaignWarmupSwitch')?.checked ? 1 : 0;

    const payload = {
        name: campName || `Chiến Dịch Auto`,
        channel_id: selectedChannelIds[0],
        channel_ids: selectedChannelIds,
        gpm_profile_id: selectedGpmIds[0],
        gpm_profile_ids: selectedGpmIds,
        distribution_mode: document.getElementById('editCampaignDistributionMode')?.value || 'round_robin',
        download_dir: document.getElementById('editCampaignDownloadDir')?.value.trim() || 'data/downloads',
        render_dir: document.getElementById('editCampaignRenderDir')?.value.trim() || 'data/rendered',
        aspect_ratio: editAspectRatio,
        preset_name: editAspectRatio === '9:16_blur' ? 'TikTok Beta Chuẩn 9:16 (Nền Mờ)' : (editAspectRatio === '9:16_split' ? '9:16 Split Screen Ghép 2 Tầng' : 'TikTok Chuẩn 9:16'),
        split_source_type: editSplitSourceType,
        split_folder: editSplitFolder,
        split_keywords: editSplitKeywords,
        split_provider: editSplitProvider,
        video_duration: parseInt(document.getElementById('editCampaignVideoDuration')?.value, 10) || 65,
        min_video_duration: minDurVal ? parseInt(minDurVal, 10) : null,
        max_video_duration: maxDurVal ? parseInt(maxDurVal, 10) : null,
        include_shorts: editIncShorts,
        include_longform: editIncLong,
        shorts_keep_original: document.getElementById('editCampaignShortsKeepOriginal')?.checked ? 1 : 0,
        ai_model: document.getElementById('editCampaignAiModel')?.value || 'default',
        ai_provider: (document.getElementById('editCampaignAiModel')?.value || '').startsWith('gemini') ? 'gemini' : ((document.getElementById('editCampaignAiModel')?.value || '').startsWith('gpt') ? 'openai' : 'deepseek'),
        hook_angle: document.getElementById('editCampaignHookAngle')?.value || 'auto',
        generate_variants: document.getElementById('editCampaignGenerateVariants')?.checked ? 1 : 0,
        subtitle_enabled: document.getElementById('editCampaignSubtitleSwitch')?.checked ? 1 : 0,
        disable_subtitle_for_shorts: document.getElementById('editCampaignDisableSubtitleForShorts')?.checked ? 1 : 0,
        subtitle_style: document.getElementById('editCampaignSubtitleStyle')?.value || 'karaoke_yellow',
        subtitle_position: document.getElementById('editCampaignSubtitlePosition')?.value || 'center',
        add_part_label: document.getElementById('editCampaignAddPartLabelSwitch')?.checked ? 1 : 0,
        clips_per_video: clipsPerVid,
        speed_factor: document.getElementById('editCampaignSpeedSwitch')?.checked ? 1.03 : 1.0,
        flip_horizontal: document.getElementById('editCampaignFlipSwitch')?.checked ? 1 : 0,
        daily_limit: safeDailyLimit,
        post_schedule: cleanScheduleStr,
        post_frequency: freq,
        post_interval_days: intervalDays,
        post_days_of_week: daysOfWeek || 'mon,tue,wed,thu,fri,sat,sun',
        random_delay_minutes: randomDelay,
        min_post_interval_minutes: document.getElementById('editCampaignMinPostIntervalSelect')?.value ? parseInt(document.getElementById('editCampaignMinPostIntervalSelect').value, 10) : null,
        warmup_mode: warmup,
        warmup_only: isWarmupOnly,
        warmup_duration_mins: parseInt(document.getElementById('editCampaignWarmupDurationSelect')?.value, 10) || 10,
        is_active: editCampaignOriginalData ? editCampaignOriginalData.is_active : 1,
        auto_engagement_enabled: document.getElementById('editCampaignAutoEngagementSwitch')?.checked ? 1 : 0,
        auto_pin_comment: document.getElementById('editCampaignAutoPinCommentSwitch')?.checked ? 1 : 0,
        pin_comment_delay_mins: parseInt(document.getElementById('editCampaignPinCommentDelaySelect')?.value, 10) || 3,
        auto_reply_comments: document.getElementById('editCampaignAutoReplyCommentsSwitch')?.checked ? 1 : 0,
        reply_comments_delay_mins: parseInt(document.getElementById('editCampaignReplyCommentsDelaySelect')?.value, 10) || 20,
        narration_enabled: document.getElementById('editCampaignNarrationSwitch')?.checked ? 1 : 0,
        narration_language: document.getElementById('editCampaignNarrationLanguage')?.value || 'original',
        voice_gender: document.getElementById('editCampaignVoiceGender')?.value || 'male',
        narration_style: document.getElementById('editCampaignNarrationStyle')?.value || 'giat_gan',
        disable_narration_for_shorts: document.getElementById('editCampaignDisableNarrationForShorts')?.checked ? 1 : 0,

        ken_burns_enabled: document.getElementById('editCampaignKenBurnsSwitch')?.checked ? 1 : 0,
        endcard_enabled: document.getElementById('editCampaignEndcardSwitch')?.checked ? 1 : 0,
        auto_upload: autoUpload,
        source_mode: 'youtube',
        local_folder_path: '',
        tts_engine: 'edge-tts',
        youtube_profile_ids: '',
        facebook_profile_ids: '',
        target_platforms: 'tiktok'
    };

    try {
        const res = await fetch(`/api/campaigns/${campId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        let data = {};
        try {
            data = await res.json();
        } catch (_) {
            data = { detail: 'Lỗi máy chủ (' + res.status + '): Phản hồi không hợp lệ' };
        }
        if (res.ok && data.status === 'success') {
            showToast('✅ Đã lưu cập nhật chiến dịch thành công!', 'success');
            closeEditCampaignModal();
            loadCampaigns();
            loadPipelineStatus();
        } else {
            showToast('Lỗi: ' + (data.detail || data.message || 'Không thể cập nhật chiến dịch'), 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-save"></i> Lưu Thay Đổi Chiến Dịch';
        }
    }
}

// ==========================================
// 9.2 CAMPAIGN LOGS & ACTIVITY MONITOR LOGIC
// ==========================================
let activeLogCampaignId = null;

async function openCampaignLogs(campaignId, campaignName) {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Xem Nhật Ký Chiến Dịch')) {
        return;
    }
    activeLogCampaignId = campaignId;
    const modal = document.getElementById('campaignLogsModal');
    if (!modal) return;

    const titleEl = document.getElementById('campLogTitle');
    if (titleEl) {
        const displayName = campaignName || `Chiến Dịch #${campaignId}`;
        titleEl.textContent = displayName;
        titleEl.title = displayName;
        titleEl.setAttribute('data-tooltip', displayName);
    }

    modal.classList.add('show');
    modal.classList.add('active');
    await refreshCurrentCampaignLogs();
}

function closeCampaignLogsModal() {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    const modal = document.getElementById('campaignLogsModal');
    if (modal) {
        modal.classList.remove('show');
        modal.classList.remove('active');
    }
}

let cachedActiveCampaignVideos = [];

function populateCampaignVideoFilterOptions(videos) {
    const chSel = document.getElementById('filterCampVideoChannel');
    const accSel = document.getElementById('filterCampVideoAccount');
    if (!chSel || !accSel) return;

    const curCh = chSel.value || 'all';
    const curAcc = accSel.value || 'all';

    // Unique Channels & Accounts
    const channelsMap = {};
    const accountsMap = {};

    (videos || []).forEach(v => {
        const chName = (v.channel_name || '').trim();
        if (chName) {
            channelsMap[chName] = (channelsMap[chName] || 0) + 1;
        }
        const acc = (v.tiktok_username || v.gpm_name || '').trim();
        if (acc) {
            const cleanAcc = acc.startsWith('@') ? acc : '@' + acc;
            accountsMap[cleanAcc] = (accountsMap[cleanAcc] || 0) + 1;
        }
    });

    let chOpts = '<option value="all">📺 Tất cả kênh nguồn</option>';
    Object.keys(channelsMap).sort().forEach(ch => {
        chOpts += `<option value="${escapeHtml(ch)}">📺 ${escapeHtml(ch)} (${channelsMap[ch]})</option>`;
    });
    chSel.innerHTML = chOpts;
    if (curCh && chSel.querySelector(`option[value="${curCh}"]`)) chSel.value = curCh;

    let accOpts = '<option value="all">👤 Tất cả nick TikTok</option>';
    Object.keys(accountsMap).sort().forEach(acc => {
        accOpts += `<option value="${escapeHtml(acc)}">👤 ${escapeHtml(acc)} (${accountsMap[acc]})</option>`;
    });
    accSel.innerHTML = accOpts;
    if (curAcc && accSel.querySelector(`option[value="${curAcc}"]`)) accSel.value = curAcc;
}

function applyCampaignVideoFilters() {
    renderCampaignVideosList();
}

function renderCampaignVideosList() {
    const vListEl = document.getElementById('campaignVideosList');
    if (!vListEl) return;

    const chSel = document.getElementById('filterCampVideoChannel');
    const accSel = document.getElementById('filterCampVideoAccount');
    const selectedChannel = chSel ? chSel.value : 'all';
    const selectedAccount = accSel ? accSel.value : 'all';

    let filtered = [...cachedActiveCampaignVideos];
    if (selectedChannel !== 'all') {
        filtered = filtered.filter(v => (v.channel_name || '').trim() === selectedChannel);
    }
    if (selectedAccount !== 'all') {
        filtered = filtered.filter(v => {
            const acc = (v.tiktok_username || v.gpm_name || '').trim();
            const cleanAcc = acc.startsWith('@') ? acc : '@' + acc;
            return cleanAcc === selectedAccount;
        });
    }

    const badge = document.getElementById('campVideosCountBadge');
    if (badge) {
        badge.textContent = `${filtered.length}/${cachedActiveCampaignVideos.length}`;
    }

    if (!filtered.length) {
        vListEl.innerHTML = `
            <div style="text-align:center; padding:32px 20px; background:rgba(255,255,255,0.02); border-radius:10px; border:1px dashed rgba(255,255,255,0.1);">
                <i class="fa-solid fa-filter-circle-xmark text-cyan" style="font-size:30px; opacity:0.6; margin-bottom:10px; display:block;"></i>
                <div style="font-size:13.5px; font-weight:700; color:var(--text-primary);">Không có video nào khớp với bộ lọc đã chọn</div>
                <button type="button" class="btn btn-sm btn-secondary mt-2" onclick="resetCampaignVideoFilters()">
                    <i class="fa-solid fa-rotate-left"></i> Đặt lại bộ lọc
                </button>
            </div>
        `;
        return;
    }

    vListEl.innerHTML = filtered.map(v => {
        const dlBadge = v.download_path
            ? `<span class="badge badge-blue" style="font-size:10.5px;" title="${escapeHtml(v.download_path)}"><i class="fa-solid fa-cloud-arrow-down"></i> Đã tải MP4 gốc</span>`
            : '<span class="badge badge-secondary" style="font-size:10.5px;"><i class="fa-solid fa-clock"></i> Chờ tải</span>';

        const rdBadge = v.rendered_path
            ? `<span class="badge badge-purple" style="font-size:10.5px;" title="${escapeHtml(v.rendered_path)}"><i class="fa-solid fa-wand-magic-sparkles"></i> Đã Render 9:16</span>`
            : (v.status === 'rendering' ? '<span class="badge badge-purple" style="font-size:10.5px;"><i class="fa-solid fa-spinner fa-spin"></i> Đang render</span>' : '<span class="badge badge-secondary" style="font-size:10.5px;">Chưa render</span>');

        const tiktokNick = v.tiktok_username || v.gpm_name;
        const gpmBadge = tiktokNick
            ? `<span class="badge badge-gold" style="font-size:11px;"><i class="fa-brands fa-tiktok"></i> ${escapeHtml(tiktokNick.startsWith('@') ? tiktokNick : '@' + tiktokNick)}</span>`
            : '<span class="badge badge-secondary" style="font-size:10.5px;">Đang xếp lịch</span>';

        let upBadge = '';
        if (v.upload_status === 'completed') {
            upBadge = `<span class="badge badge-success" style="font-size:10.5px;"><i class="fa-solid fa-circle-check"></i> Đã đăng (${escapeHtml(v.uploaded_at ? v.uploaded_at.substring(11, 16) : 'xong')})</span>`;
        } else if (v.upload_status === 'failed') {
            upBadge = '<span class="badge badge-danger" style="font-size:10.5px;"><i class="fa-solid fa-circle-xmark"></i> Lỗi đăng bài</span>';
        } else if (v.scheduled_time) {
            upBadge = `<span class="badge badge-cyan" style="font-size:10.5px;"><i class="fa-regular fa-clock"></i> Giờ hẹn: ${escapeHtml(v.scheduled_time)}</span>`;
        } else if (v.rendered_path) {
            upBadge = '<span class="badge badge-warning" style="font-size:10.5px;"><i class="fa-solid fa-hourglass-start"></i> Chờ đến khung giờ đăng</span>';
        } else {
            upBadge = '<span class="badge badge-secondary" style="font-size:10.5px;">Chờ render xong</span>';
        }

        return `
            <div class="camp-video-card" style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px; padding:10px 14px; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; transition:border-color 0.2s;" onmouseover="this.style.borderColor='rgba(0,242,254,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)'">
                <div style="flex:1 1 260px; min-width:0; max-width:320px; overflow:hidden;">
                    <div style="display:flex; align-items:center; gap:8px; font-size:11.5px; color:var(--text-muted); margin-bottom:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        <span style="color:#ff0000; flex-shrink:0;"><i class="fa-brands fa-youtube"></i></span>
                        <strong style="color:var(--accent-blue); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(v.channel_name || 'YouTube')}</strong>
                        <span style="flex-shrink:0;">• ${escapeHtml(v.created_at ? v.created_at.substring(0, 16) : '')}</span>
                        ${v.duration ? `<span class="badge" style="font-size:10px; background:rgba(255,255,255,0.06); flex-shrink:0;">${v.duration}s</span>` : ''}
                    </div>
                    <h5 class="camp-video-title" style="margin:0; font-size:13px; font-weight:600; line-height:1.4; max-width:320px; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;" title="${escapeHtml(v.title || 'Video #' + v.id)}">${escapeHtml(v.title || 'Video #' + v.id)}</h5>
                </div>
                <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-start; min-width:130px;">
                    ${dlBadge}
                    ${rdBadge}
                </div>
                <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; min-width:160px;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:11px; color:var(--text-muted);">Nick nhận:</span>
                        ${gpmBadge}
                    </div>
                    ${upBadge}
                </div>
            </div>
        `;
    }).join('');
}

function resetCampaignVideoFilters() {
    const chSel = document.getElementById('filterCampVideoChannel');
    if (chSel) chSel.value = 'all';
    const accSel = document.getElementById('filterCampVideoAccount');
    if (accSel) accSel.value = 'all';
    renderCampaignVideosList();
}

async function refreshCurrentCampaignLogs() {
    if (!activeLogCampaignId) return;
    const feedEl = document.getElementById('campaignLogsFeed');
    if (feedEl) feedEl.innerHTML = '<div class="text-muted text-center py-4"><i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật dữ liệu mới nhất...</div>';

    try {
        const res = await fetch(`/api/campaigns/${activeLogCampaignId}/logs`);
        const data = await res.json();
        if (data.status !== 'success') {
            if (feedEl) feedEl.innerHTML = `<div class="text-danger text-center py-3">Lỗi tải nhật ký: ${escapeHtml(data.detail || 'Không rõ')}</div>`;
            return;
        }

        const camp = data.campaign || {};
        const stats = data.stats || {};
        const logs = data.logs || [];

        // Update Header info
        const titleEl = document.getElementById('campLogTitle');
        if (titleEl) {
            const cName = camp.name || `Chiến Dịch #${activeLogCampaignId}`;
            titleEl.textContent = cName;
            titleEl.title = cName;
            titleEl.setAttribute('data-tooltip', cName);
        }

        const statusBadge = document.getElementById('campLogStatusBadge');
        if (statusBadge) {
            statusBadge.className = `badge ${camp.is_active ? 'badge-success' : 'badge-secondary'}`;
            statusBadge.innerHTML = `<i class="fa-solid fa-circle-dot"></i> ${camp.is_active ? 'Đang Chạy Auto' : 'Tạm Dừng'}`;
        }

        const cadenceBadge = document.getElementById('campLogCadenceBadge');
        if (cadenceBadge) {
            cadenceBadge.innerHTML = `<i class="fa-solid fa-calendar-days"></i> ${camp.post_frequency === 'every_2_days' ? 'Cách 2 ngày' : (camp.post_frequency === 'every_3_days' ? 'Cách 3 ngày' : 'Mỗi ngày')}`;
        }

        // Update 4 Metrics Stats
        const dlEl = document.getElementById('campStatDownloaded');
        if (dlEl) dlEl.textContent = stats.downloaded_videos || 0;

        const totVideosEl = document.getElementById('campStatTotalVideos');
        if (totVideosEl) totVideosEl.textContent = `trong ${stats.total_videos || 0} video phát hiện`;

        const rdEl = document.getElementById('campStatRendered');
        if (rdEl) rdEl.textContent = stats.rendered_videos || 0;

        const qEl = document.getElementById('campStatQueued');
        if (qEl) qEl.textContent = stats.queued_tasks || 0;

        const upEl = document.getElementById('campStatUploaded');
        if (upEl) upEl.textContent = stats.completed_tasks || 0;

        const failEl = document.getElementById('campStatFailed');
        if (failEl) failEl.textContent = `${stats.failed_tasks || 0} lỗi`;

        const countText = document.getElementById('campLogCountText');
        if (countText) countText.textContent = `${logs.length} sự kiện ghi nhận`;

        const vCountBadge = document.getElementById('campVideosCountBadge');
        if (vCountBadge) vCountBadge.textContent = (data.videos || []).length;
        const lCountBadge = document.getElementById('campLogsCountBadge');
        if (lCountBadge) lCountBadge.textContent = logs.length;

        // 1. Save and Render Video Pipeline Flow with Filters
        cachedActiveCampaignVideos = data.videos || [];
        populateCampaignVideoFilterOptions(cachedActiveCampaignVideos);
        renderCampaignVideosList();

        // 2. Render Activity Logs
        const actionBadges = {
            'scan': '<span class="badge badge-blue" style="font-size:10px;"><i class="fa-solid fa-radar"></i> QUÉT RSS</span>',
            'download': '<span class="badge badge-cyan" style="font-size:10px;"><i class="fa-solid fa-download"></i> TẢI VIDEO</span>',
            'render': '<span class="badge badge-purple" style="font-size:10px;"><i class="fa-solid fa-wand-magic-sparkles"></i> RENDER 9:16</span>',
            'upload': '<span class="badge badge-gold" style="font-size:10px;"><i class="fa-brands fa-tiktok"></i> ĐĂNG BÀI</span>',
            'system': '<span class="badge badge-secondary" style="font-size:10px;"><i class="fa-solid fa-gear"></i> HỆ THỐNG</span>',
            'error': '<span class="badge badge-danger" style="font-size:10px;"><i class="fa-solid fa-circle-exclamation"></i> LỖI</span>'
        };

        const levelColors = {
            'SUCCESS': '#059669',
            'ERROR': '#dc2626',
            'WARNING': '#d97706',
            'INFO': '#0284c7'
        };

        if (feedEl) {
            if (!logs.length) {
                feedEl.innerHTML = `<div class="text-muted text-center py-5" style="font-size:12px;"><i class="fa-solid fa-clock-rotate-left mb-2" style="font-size:24px; display:block; opacity:0.4;"></i>Chưa có sự kiện nào được ghi nhận cho chiến dịch này.<br><span style="font-size:11px; color:var(--text-muted);">Bấm <strong>"Quét & Chạy Thử Ngay"</strong> để kích hoạt quét và kiểm tra tiến trình!</span></div>`;
            } else {
                feedEl.innerHTML = logs.map(l => {
                    const actBadge = actionBadges[l.action] || actionBadges['system'];
                    const lvlColor = levelColors[l.level] || 'var(--text-secondary)';
                    return `
                        <div class="camp-log-row">
                            <span class="camp-log-time">
                                ${escapeHtml(l.created_at || '')}
                            </span>
                            <div style="flex-shrink:0;">${actBadge}</div>
                            <div class="camp-log-msg">
                                <span class="camp-log-level" style="color:${lvlColor}; font-weight:700; margin-right:4px;">[${escapeHtml(l.level || 'INFO')}]</span>
                                <span>${escapeHtml(l.message || '')}</span>
                                ${l.details ? `<div class="camp-log-details">${escapeHtml(l.details)}</div>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        if (feedEl) feedEl.innerHTML = `<div class="text-danger text-center py-3">Lỗi kết nối máy chủ: ${escapeHtml(err.message)}</div>`;
    }
}

function switchCampaignDetailTab(tab) {
    const vContainer = document.getElementById('campaignVideosContainer');
    const lContainer = document.getElementById('campaignLogsContainer');
    const vBtn = document.getElementById('btnCampTabVideos');
    const lBtn = document.getElementById('btnCampTabLogs');
    const filterBar = document.getElementById('campVideosFilterBar');

    if (tab === 'videos') {
        if (vContainer) vContainer.style.display = 'flex';
        if (lContainer) lContainer.style.display = 'none';
        if (filterBar) filterBar.style.display = 'flex';
        if (vBtn) { vBtn.className = 'btn btn-sm btn-primary'; }
        if (lBtn) { lBtn.className = 'btn btn-sm btn-secondary'; }
    } else {
        if (vContainer) vContainer.style.display = 'none';
        if (lContainer) lContainer.style.display = 'flex';
        if (filterBar) filterBar.style.display = 'none';
        if (vBtn) { vBtn.className = 'btn btn-sm btn-secondary'; }
        if (lBtn) { lBtn.className = 'btn btn-sm btn-primary'; }
    }
}

async function triggerCampaignTestRun() {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Chạy Thử Chiến Dịch')) {
        return;
    }
    if (!activeLogCampaignId) return;
    const btn = document.getElementById('btnTestRunCampaign');
    if (btn && btn.getAttribute('data-running') === 'true') {
        await stopCampaignRun(activeLogCampaignId, 'chiến dịch', btn);
        return;
    }

    if (btn) {
        btn.setAttribute('data-running', 'true');
        btn.className = 'btn btn-sm btn-danger';
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Dừng Thực Thi';
    }
    showToast('⚡ Đang gửi yêu cầu quét và kiểm tra chạy thử cho chiến dịch...');
    try {
        const res = await fetch(`/api/campaigns/${activeLogCampaignId}/test-run`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('✅ ' + data.message);
            setTimeout(refreshCurrentCampaignLogs, 1500);
            setTimeout(refreshCurrentCampaignLogs, 4000);
        } else {
            showToast('Lỗi: ' + (data.detail || 'Không thể chạy quét'), true);
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, true);
    } finally {
        setTimeout(() => {
            if (btn && btn.getAttribute('data-running') === 'true') {
                btn.removeAttribute('data-running');
                btn.className = 'btn btn-sm btn-primary';
                btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Quét & Chạy Thử Ngay';
            }
        }, 5000);
    }
}

async function stopCampaignRun(id, name, btn) {
    const targetBtn = btn || document.getElementById(`btnDirectRun_${id}`) || document.getElementById('btnTestRunCampaign');
    if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Dừng...';
    }
    showToast(`🛑 Đang gửi lệnh dừng thực thi cho chiến dịch '${name || id}'...`);
    try {
        const res = await fetch(`/api/campaigns/${id}/stop`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Đã gửi lệnh dừng chiến dịch thành công!', 'info');
        if (typeof refreshCurrentCampaignLogs === 'function') {
            setTimeout(refreshCurrentCampaignLogs, 1000);
        }
    } catch (err) {
        showToast('Lỗi khi dừng chiến dịch: ' + err.message, true);
    } finally {
        if (targetBtn) {
            targetBtn.disabled = false;
            targetBtn.removeAttribute('data-running');
            if (targetBtn.id === 'btnTestRunCampaign') {
                targetBtn.className = 'btn btn-sm btn-primary';
                targetBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Quét & Chạy Thử Ngay';
            } else {
                targetBtn.className = 'btn btn-sm btn-secondary has-tooltip';
                targetBtn.innerHTML = '<i class="fa-solid fa-bolt text-gold"></i> Chạy Thử';
            }
        }
    }
}

async function triggerDirectCampaignRun(id, name, btn) {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Chạy Thử Chiến Dịch')) {
        return;
    }
    const targetBtn = btn || document.getElementById(`btnDirectRun_${id}`);
    if (targetBtn && targetBtn.getAttribute('data-running') === 'true') {
        await stopCampaignRun(id, name, targetBtn);
        return;
    }

    if (targetBtn) {
        targetBtn.setAttribute('data-running', 'true');
        targetBtn.className = 'btn btn-sm btn-danger has-tooltip';
        targetBtn.innerHTML = '<i class="fa-solid fa-stop"></i> Dừng Chạy';
    }

    showToast(`⚡ Đang gửi yêu cầu quét và kiểm tra chạy thử cho chiến dịch '${name}'...`);
    try {
        const res = await fetch(`/api/campaigns/${id}/test-run`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('✅ ' + data.message);
        } else {
            showToast('Lỗi: ' + (data.detail || 'Không thể chạy quét'), true);
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, true);
    } finally {
        setTimeout(() => {
            if (targetBtn && targetBtn.getAttribute('data-running') === 'true') {
                targetBtn.removeAttribute('data-running');
                targetBtn.className = 'btn btn-sm btn-secondary has-tooltip';
                targetBtn.innerHTML = '<i class="fa-solid fa-bolt text-gold"></i> Chạy Thử';
            }
        }, 5000);
    }
}

// Module Window Exposures
window.browseFolderForInput = browseFolderForInput;
window.closeCampaignLogsModal = closeCampaignLogsModal;
window.closeEditCampaignModal = closeEditCampaignModal;
window.closeNewCampaignModal = closeNewCampaignModal;
window.exportPipelineVideosCsv = exportPipelineVideosCsv;
window.filterCampaignChannelList = filterCampaignChannelList;
window.filterCampaignGpmAccounts = filterCampaignGpmAccounts;
window.filterCampaignGpmList = filterCampaignGpmList;
window.filterEditCampaignChannelList = filterEditCampaignChannelList;
window.filterEditCampaignGpmList = filterEditCampaignGpmList;
window.toggleSortCampaignChannels = toggleSortCampaignChannels;
window.toggleSortCampaignGpm = toggleSortCampaignGpm;
window.toggleEditSortCampaignChannels = toggleEditSortCampaignChannels;
window.toggleEditSortCampaignGpm = toggleEditSortCampaignGpm;
window.populateCampaignGroupFilters = populateCampaignGroupFilters;
window.loadCampaigns = loadCampaigns;
window.filterAndRenderCampaigns = filterAndRenderCampaigns;
window.goToCampaignPage = goToCampaignPage;
window.changeCampaignsPageSize = changeCampaignsPageSize;
window.loadPipelineStatus = loadPipelineStatus;
window.onCampaignFrequencyChange = onCampaignFrequencyChange;
window.onEditCampaignFrequencyChange = onEditCampaignFrequencyChange;
window.openNewCampaignModal = openNewCampaignModal;
window.openEditCampaignModal = openEditCampaignModal;
window.handleCreateCampaignSubmit = handleCreateCampaignSubmit;
window.handleEditCampaignSubmit = handleEditCampaignSubmit;
window.toggleCampaign = toggleCampaign;
window.deleteCampaign = deleteCampaign;
window.openCampaignLogs = openCampaignLogs;
window.switchModalTab = switchModalTab;
window.updateCampaignSourceModeUI = updateCampaignSourceModeUI;
window.toggleCampaignTtsEngine = toggleCampaignTtsEngine;
window.toggleCampaignNarration = toggleCampaignNarration;
window.toggleCampaignAutoEngagement = toggleCampaignAutoEngagement;
window.retryUploadTask = retryUploadTask;
window.renderKanbanPipeline = renderKanbanPipeline;
window.refreshCurrentCampaignLogs = refreshCurrentCampaignLogs;
window.scanAllChannelsPipeline = scanAllChannelsPipeline;
window.selectAllCampaignChannels = selectAllCampaignChannels;
window.selectAllCampaignGpm = selectAllCampaignGpm;
window.selectAllEditCampaignChannels = selectAllEditCampaignChannels;
window.setCampaignSchedulePreset = setCampaignSchedulePreset;
window.setEditCampaignSchedulePreset = setEditCampaignSchedulePreset;
window.switchCampaignDetailTab = switchCampaignDetailTab;
window.toggleMasterScheduler = toggleMasterScheduler;
window.triggerCampaignTestRun = triggerCampaignTestRun;
window.triggerDirectCampaignRun = triggerDirectCampaignRun;
window.stopCampaignRun = stopCampaignRun;
window.triggerProcessUploads = triggerProcessUploads;
window.modalAvailableSavedChannels = modalAvailableSavedChannels;
window.modalAvailableGpmProfiles = modalAvailableGpmProfiles;
window.editModalAvailableSavedChannels = editModalAvailableSavedChannels;
window.editModalAvailableGpmProfiles = editModalAvailableGpmProfiles;

function syncCampaignDuplicateCheckboxes(mode = 'new') {
    const isNew = mode === 'new';
    const listId = isNew ? 'campaignGpmList' : 'editCampaignGpmList';
    const checkClass = isNew ? '.campaign-gpm-check' : '.edit-campaign-gpm-check';
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    const allBoxes = Array.from(listEl.querySelectorAll(checkClass));
    const checkedMap = new Map();

    allBoxes.forEach(b => {
        if (b.checked && !b.disabled) {
            const k = b.dataset.accountKey;
            if (k && !checkedMap.has(k)) {
                checkedMap.set(k, {
                    browserLabel: b.dataset.browserLabel || 'GPMLogin',
                    profileName: b.dataset.profileName || '',
                    channelName: b.dataset.channelName || '',
                    box: b
                });
            }
        }
    });

    allBoxes.forEach(b => {
        const k = b.dataset.accountKey;
        const label = b.closest('label');
        if (!label) return;

        let noteBadge = label.querySelector('.dup-disabled-note');

        if (k && checkedMap.has(k)) {
            const source = checkedMap.get(k);
            if (source.box !== b) {
                b.checked = false;
                b.disabled = true;
                label.style.opacity = '0.45';
                label.style.cursor = 'not-allowed';
                label.setAttribute('data-duplicate-disabled', 'true');
                const noteText = `Tài khoản này đã được chọn qua ${source.browserLabel} (${source.profileName})`;
                if (!noteBadge) {
                    noteBadge = document.createElement('span');
                    noteBadge.className = 'badge dup-disabled-note';
                    noteBadge.style.cssText = 'background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-size:9.5px; padding:1px 6px; font-weight:600; white-space:nowrap; margin-left:4px; flex-shrink:0;';
                    const targetContainer = label.querySelector('div') || label;
                    targetContainer.appendChild(noteBadge);
                }
                noteBadge.innerHTML = `<i class="fa-solid fa-lock"></i> Đã chọn qua ${typeof escapeHtml === 'function' ? escapeHtml(source.browserLabel) : source.browserLabel} (${typeof escapeHtml === 'function' ? escapeHtml(source.profileName) : source.profileName})`;
                noteBadge.style.display = 'inline-flex';
                label.title = noteText;
            } else {
                b.disabled = false;
                label.style.opacity = '1';
                label.style.cursor = 'pointer';
                label.removeAttribute('data-duplicate-disabled');
                label.removeAttribute('title');
                if (noteBadge) noteBadge.style.display = 'none';
            }
        } else {
            b.disabled = false;
            label.style.opacity = '1';
            label.style.cursor = 'pointer';
            label.removeAttribute('data-duplicate-disabled');
            label.removeAttribute('title');
            if (noteBadge) noteBadge.style.display = 'none';
        }
    });

    if (isNew) {
        if (typeof updateSelectedGpmCount === 'function') updateSelectedGpmCount();
    } else {
        if (typeof updateEditSelectedGpmCount === 'function') updateEditSelectedGpmCount();
    }
}
window.syncCampaignDuplicateCheckboxes = syncCampaignDuplicateCheckboxes;
window.applyCampaignVideoFilters = applyCampaignVideoFilters;
window.resetCampaignVideoFilters = resetCampaignVideoFilters;
