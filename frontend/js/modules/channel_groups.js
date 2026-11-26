// ==========================================
// CHANNEL GROUPS MANAGER
// ==========================================

let cachedChannelGroups = [];
let activeDetailGroupId = null;
let activeDetailGroupData = null;
let groupSortField = 'channel_count_desc';
let groupFilterState = 'all';
let channelGroupsCurrentPage = 1;
let channelGroupsPageSize = 20;

function changeChannelGroupsPageSize(val) {
    channelGroupsPageSize = parseInt(val, 10) || 20;
    channelGroupsCurrentPage = 1;
    renderChannelGroups();
}

function goToChannelGroupsPage(p) {
    channelGroupsCurrentPage = p;
    renderChannelGroups();
}

// Initialize Palette listeners on document ready
document.addEventListener('DOMContentLoaded', () => {
    initGroupPaletteListeners();
});

function initGroupPaletteListeners() {
    // Color Palette
    const colorContainer = document.getElementById('groupColorPalette');
    if (colorContainer) {
        colorContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.color-preset-btn');
            if (!btn) return;
            const color = btn.getAttribute('data-color');
            const hidden = document.getElementById('groupEditColor');
            if (hidden) hidden.value = color;

            colorContainer.querySelectorAll('.color-preset-btn').forEach(b => {
                b.style.boxShadow = 'none';
                b.style.border = '2px solid transparent';
            });
            btn.style.boxShadow = `0 0 0 2px ${color}`;
            btn.style.border = '2px solid #fff';

            // Update header icon wrap background preview
            const iconWrap = document.getElementById('groupEditHeaderIconWrap');
            if (iconWrap) {
                iconWrap.style.background = `${color}22`;
                iconWrap.style.color = color;
            }
        });
    }

    // Icon Palette
    const iconContainer = document.getElementById('groupIconPalette');
    if (iconContainer) {
        iconContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.icon-preset-btn');
            if (!btn) return;
            const icon = btn.getAttribute('data-icon');
            const hidden = document.getElementById('groupEditIcon');
            if (hidden) hidden.value = icon;

            iconContainer.querySelectorAll('.icon-preset-btn').forEach(b => {
                b.style.border = '1px solid var(--border-color)';
                b.style.background = 'transparent';
                b.style.color = 'var(--text-secondary)';
            });
            btn.style.border = '1px solid var(--accent-purple)';
            btn.style.background = 'rgba(99, 102, 241, 0.15)';
            btn.style.color = 'var(--accent-purple)';

            // Update header icon preview
            const headerIcon = document.getElementById('groupEditHeaderIcon');
            if (headerIcon) {
                headerIcon.className = `fa-solid ${icon}`;
            }
        });
    }
}

// 1. Load Channel Groups from Backend
async function loadChannelGroups(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải...';
    }

    try {
        const res = await fetch('/api/channel-groups');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.error || 'Lỗi không xác định khi tải nhóm');
        }

        cachedChannelGroups = data.groups || [];
        window.cachedChannelGroups = cachedChannelGroups;
        const stats = data.stats || {};

        // Update Stats UI
        const elTotal = document.getElementById('groupStatTotal');
        if (elTotal) elTotal.textContent = stats.total_groups || cachedChannelGroups.length;

        const elGrouped = document.getElementById('groupStatGroupedChannels');
        if (elGrouped) elGrouped.textContent = stats.grouped_channels || 0;

        const elUngrouped = document.getElementById('groupStatUngroupedChannels');
        if (elUngrouped) elUngrouped.textContent = stats.ungrouped_channels || 0;

        const elActive = document.getElementById('groupStatActiveGroups');
        if (elActive) elActive.textContent = stats.active_groups || 0;

        const badgeCount = document.getElementById('badgeGroupsCount');
        if (badgeCount) badgeCount.textContent = `${cachedChannelGroups.length} Nhóm`;

        const subnavBadge = document.getElementById('sourceGroupsCountBadge');
        if (subnavBadge) subnavBadge.textContent = cachedChannelGroups.length;

        // Sync dropdown options across other views (Saved Channels toolbar filter, assign modal)
        syncGroupDropdowns();

        renderChannelGroups();
    } catch (err) {
        console.error('Lỗi tải nhóm kênh:', err);
        showToast('Lỗi khi tải danh sách nhóm kênh: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// 2. Synchronize group options to dropdowns
function syncGroupDropdowns() {
    // Toolbar Filter in Saved Channels
    const filterSelect = document.getElementById('savedFilterGroupSelect');
    if (filterSelect) {
        const currentVal = filterSelect.value;
        let html = `
            <option value="all">Tất cả nhóm</option>
            <option value="ungrouped">Chưa phân nhóm</option>
        `;
        cachedChannelGroups.forEach(g => {
            html += `<option value="${g.id}">${escapeHtml(g.name)} (${g.channel_count || 0})</option>`;
        });
        filterSelect.innerHTML = html;
        if (currentVal) filterSelect.value = currentVal;
    }

    // Modal Assign Group Select
    const assignSelect = document.getElementById('assignChannelGroupSelect');
    if (assignSelect) {
        let html = `<option value="">-- Chưa Phân Nhóm (Gỡ khỏi nhóm) --</option>`;
        cachedChannelGroups.forEach(g => {
            html += `<option value="${g.id}">${escapeHtml(g.name)}</option>`;
        });
        assignSelect.innerHTML = html;
    }
}

// 3. Filter & Sort Groups
function handleGroupSortChange(val) {
    groupSortField = val;
    renderChannelGroups();
}

function resetGroupFilters() {
    groupSortField = 'channel_count_desc';
    groupFilterState = 'all';

    const selSort = document.getElementById('groupSortSelect');
    if (selSort) selSort.value = 'channel_count_desc';

    const selFilter = document.getElementById('groupFilterState');
    if (selFilter) selFilter.value = 'all';

    const inpKw = document.getElementById('searchGroupKeyword');
    if (inpKw) inpKw.value = '';

    renderChannelGroups();
}

function getFilteredChannelGroups() {
    let list = [...cachedChannelGroups];

    // Filter by Keyword
    const kwInput = document.getElementById('searchGroupKeyword');
    const kw = kwInput ? kwInput.value.trim().toLowerCase() : '';
    if (kw) {
        list = list.filter(g => {
            const name = (g.name || '').toLowerCase();
            const desc = (g.description || '').toLowerCase();
            return name.includes(kw) || desc.includes(kw);
        });
    }

    // Filter by State
    const filterSelect = document.getElementById('groupFilterState');
    const state = filterSelect ? filterSelect.value : groupFilterState;
    if (state === 'has_channels') {
        list = list.filter(g => (g.channel_count || 0) > 0);
    } else if (state === 'empty') {
        list = list.filter(g => !g.channel_count || g.channel_count === 0);
    }

    // Sort
    list.sort((a, b) => {
        if (groupSortField === 'name_asc') {
            return (a.name || '').localeCompare(b.name || '', 'vi');
        } else if (groupSortField === 'name_desc') {
            return (b.name || '').localeCompare(a.name || '', 'vi');
        } else if (groupSortField === 'channel_count_desc') {
            return (b.channel_count || 0) - (a.channel_count || 0);
        } else if (groupSortField === 'subs_desc') {
            return (b.total_subscribers || 0) - (a.total_subscribers || 0);
        } else if (groupSortField === 'videos_desc') {
            return (b.total_videos || 0) - (a.total_videos || 0);
        } else if (groupSortField === 'created_desc') {
            return (b.id || 0) - (a.id || 0);
        }
        return 0;
    });

    return list;
}

// 4. Render Group Cards Grid
function renderChannelGroups() {
    const grid = document.getElementById('channelGroupsGrid');
    const emptyState = document.getElementById('channelGroupsEmptyState');
    const paginationEl = document.getElementById('channelGroupsPagination');
    if (!grid) return;

    const list = getFilteredChannelGroups();

    if (!list.length) {
        grid.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        if (paginationEl) paginationEl.style.display = 'none';
        return;
    }

    grid.style.display = 'grid';
    if (emptyState) emptyState.style.display = 'none';
    if (paginationEl) paginationEl.style.display = 'flex';

    // Pagination calculations
    const totalItems = list.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / channelGroupsPageSize));
    if (channelGroupsCurrentPage > totalPages) channelGroupsCurrentPage = totalPages;
    if (channelGroupsCurrentPage < 1) channelGroupsCurrentPage = 1;

    const startIdx = (channelGroupsCurrentPage - 1) * channelGroupsPageSize;
    const endIdx = Math.min(startIdx + channelGroupsPageSize, totalItems);
    const pagedList = list.slice(startIdx, endIdx);

    const infoEl = document.getElementById('channelGroupsPaginationInfo');
    if (infoEl) {
        infoEl.textContent = totalItems > 0
            ? `Hiển thị ${startIdx + 1} - ${endIdx} / ${totalItems} nhóm`
            : `0 nhóm`;
    }
    const navEl = document.getElementById('channelGroupsPaginationNav');
    if (navEl) {
        navEl.innerHTML = `
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToChannelGroupsPage(1)" ${channelGroupsCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang đầu">
                <i class="fa-solid fa-angles-left"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToChannelGroupsPage(${channelGroupsCurrentPage - 1})" ${channelGroupsCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang trước">
                <i class="fa-solid fa-angle-left"></i>
            </button>
            <span style="font-size: 12px; font-weight: 600; padding: 0 8px; color: var(--text-primary); white-space: nowrap;">
                Trang ${channelGroupsCurrentPage} / ${totalPages}
            </span>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToChannelGroupsPage(${channelGroupsCurrentPage + 1})" ${channelGroupsCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang sau">
                <i class="fa-solid fa-angle-right"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToChannelGroupsPage(${totalPages})" ${channelGroupsCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang cuối">
                <i class="fa-solid fa-angles-right"></i>
            </button>
        `;
    }

    grid.innerHTML = pagedList.map(g => {
        const color = g.color || '#6366f1';
        const icon = g.icon || 'fa-layer-group';
        const count = g.channel_count || 0;
        const totalSubs = g.total_subscribers ? formatNumber(g.total_subscribers) : '0';
        const totalVideos = g.total_videos ? g.total_videos.toLocaleString('vi-VN') : '0';
        const avgViews = g.avg_views ? formatNumber(Math.round(g.avg_views)) : '0';

        // Avatar Preview Stack (up to 4 channels)
        const previews = g.preview_channels || [];
        let avatarStackHtml = '';
        if (previews.length > 0) {
            avatarStackHtml = `
                <div style="display: flex; align-items: center; margin-top: 12px; margin-bottom: 6px;">
                    <div style="display: flex; margin-left: 6px;">
                        ${previews.map((ch, idx) => {
                const zIndex = 10 - idx;
                const marginLeft = idx === 0 ? '0' : '-10px';
                if (ch.thumbnail_url) {
                    return `<img src="${ch.thumbnail_url}" alt="" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; border: 2px solid var(--card-bg, #1e293b); margin-left: ${marginLeft}; z-index: ${zIndex};" title="${escapeHtml(ch.display_name || ch.title || '')}">`;
                }
                return `<div style="width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,0.1); border: 2px solid var(--card-bg, #1e293b); display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--text-muted); margin-left: ${marginLeft}; z-index: ${zIndex};"><i class="fa-brands fa-youtube"></i></div>`;
            }).join('')}
                    </div>
                    <span style="font-size: 11.5px; color: var(--text-muted); margin-left: 8px;">
                        ${count > previews.length ? `+${count - previews.length} kênh khác` : `${count} kênh trong nhóm`}
                    </span>
                </div>
            `;
        } else {
            avatarStackHtml = `
                <div style="font-size: 12px; color: var(--text-muted); margin-top: 12px; margin-bottom: 6px; font-style: italic;">
                    <i class="fa-regular fa-folder-open"></i> Chưa có kênh nào trong nhóm
                </div>
            `;
        }

        const descText = g.description ? escapeHtml(g.description) : '<span style="color:var(--text-muted); font-style:italic;">Không có mô tả</span>';

        return `
            <div class="glass-panel group-card" style="position: relative; overflow: visible; padding: 18px 20px; border-radius: 14px; border: 1px solid var(--border-color); display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s ease;">
                <!-- Accent Color Bar at Top -->
                <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: ${color}; border-radius: 14px 14px 0 0;"></div>

                <div>
                    <!-- Header: Icon + Name + Badge -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 42px; height: 42px; border-radius: 12px; background: ${color}20; color: ${color}; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; border: 1px solid ${color}40;">
                                <i class="fa-solid ${escapeHtml(icon)}"></i>
                            </div>
                            <div>
                                <h4 style="margin: 0; font-size: 15.5px; font-weight: 700; color: var(--text-primary);">${escapeHtml(g.name)}</h4>
                                <span class="badge" style="background: ${color}22; color: ${color}; border: 1px solid ${color}44; font-size: 11px; margin-top: 4px; font-weight: 700;">
                                    ${count} Kênh
                                </span>
                            </div>
                        </div>

                        <!-- Dropdown Actions -->
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <button type="button" class="btn btn-secondary btn-sm has-tooltip tooltip-bottom" onclick="openEditGroupModal(${g.id})" data-tooltip="Chỉnh sửa nhóm" style="height: 30px; width: 30px; padding: 0; border-radius: 8px;">
                                <i class="fa-solid fa-pen-to-square" style="font-size: 11px;"></i>
                            </button>
                            <button type="button" class="btn btn-secondary btn-sm has-tooltip tooltip-left" onclick="deleteChannelGroupConfirm(${g.id}, '${escapeHtml(g.name)}')" data-tooltip="Xóa nhóm" style="height: 30px; width: 30px; padding: 0; border-radius: 8px; color: #ef4444;">
                                <i class="fa-solid fa-trash-can" style="font-size: 11px;"></i>
                            </button>
                        </div>
                    </div>

                    <!-- Description -->
                    <div style="margin-top: 10px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); max-height: 38px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                        ${descText}
                    </div>

                    <!-- Avatar Stack -->
                    ${avatarStackHtml}
                </div>

                <!-- Footer Stats & Main Actions -->
                <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; margin-bottom: 14px; font-size: 11.5px;">
                        <div style="background: rgba(255,255,255,0.02); padding: 6px 4px; border-radius: 8px;">
                            <div style="font-weight: 700; color: var(--text-primary);">${totalSubs}</div>
                            <div style="color: var(--text-muted); font-size: 10.5px;">Subs</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.02); padding: 6px 4px; border-radius: 8px;">
                            <div style="font-weight: 700; color: var(--text-primary);">${totalVideos}</div>
                            <div style="color: var(--text-muted); font-size: 10.5px;">Videos</div>
                        </div>
                        <div style="background: rgba(255,255,255,0.02); padding: 6px 4px; border-radius: 8px;">
                            <div style="font-weight: 700; color: var(--accent-cyan);">${avgViews}</div>
                            <div style="color: var(--text-muted); font-size: 10.5px;">View TB</div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn btn-secondary btn-sm" style="flex: 1; font-size: 12px;" onclick="openGroupDetailModal(${g.id})">
                            <i class="fa-solid fa-eye"></i> Xem Kênh (${count})
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" style="font-size: 12px; padding: 0 12px;" onclick="openAddChannelsToGroupModal(${g.id})" title="Thêm kênh vào nhóm">
                            <i class="fa-solid fa-plus"></i> Thêm Kênh
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 5. Create & Edit Group Modal Logic
function openCreateGroupModal() {
    const modal = document.getElementById('modalChannelGroupEdit');
    if (!modal) return;

    document.getElementById('groupEditId').value = '';
    document.getElementById('groupEditName').value = '';
    document.getElementById('groupEditDesc').value = '';
    document.getElementById('groupEditColor').value = '#6366f1';
    document.getElementById('groupEditIcon').value = 'fa-layer-group';

    document.getElementById('groupEditModalTitle').textContent = 'Tạo Nhóm Kênh Mới';
    document.getElementById('groupEditModalSub').textContent = 'Tổ chức dàn kênh theo chủ đề hoặc ngách nội dung';

    // Reset color palette
    const colorContainer = document.getElementById('groupColorPalette');
    if (colorContainer) {
        colorContainer.querySelectorAll('.color-preset-btn').forEach(b => {
            const isMatch = b.getAttribute('data-color') === '#6366f1';
            b.style.boxShadow = isMatch ? '0 0 0 2px #6366f1' : 'none';
            b.style.border = isMatch ? '2px solid #fff' : '2px solid transparent';
        });
    }

    // Reset icon palette
    const iconContainer = document.getElementById('groupIconPalette');
    if (iconContainer) {
        iconContainer.querySelectorAll('.icon-preset-btn').forEach(b => {
            const isMatch = b.getAttribute('data-icon') === 'fa-layer-group';
            b.style.border = isMatch ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)';
            b.style.background = isMatch ? 'rgba(99, 102, 241, 0.15)' : 'transparent';
            b.style.color = isMatch ? 'var(--accent-purple)' : 'var(--text-secondary)';
        });
    }

    modal.style.display = 'flex';
}

function openEditGroupModal(groupId) {
    const group = cachedChannelGroups.find(g => g.id === groupId);
    if (!group) return;

    const modal = document.getElementById('modalChannelGroupEdit');
    if (!modal) return;

    document.getElementById('groupEditId').value = group.id;
    document.getElementById('groupEditName').value = group.name || '';
    document.getElementById('groupEditDesc').value = group.description || '';
    const color = group.color || '#6366f1';
    const icon = group.icon || 'fa-layer-group';
    document.getElementById('groupEditColor').value = color;
    document.getElementById('groupEditIcon').value = icon;

    document.getElementById('groupEditModalTitle').textContent = `Chỉnh Sửa Nhóm: ${group.name}`;
    document.getElementById('groupEditModalSub').textContent = 'Cập nhật tên nhóm, mô tả, màu sắc nhận diện và icon';

    // Select color preset
    const colorContainer = document.getElementById('groupColorPalette');
    if (colorContainer) {
        colorContainer.querySelectorAll('.color-preset-btn').forEach(b => {
            const isMatch = b.getAttribute('data-color') === color;
            b.style.boxShadow = isMatch ? `0 0 0 2px ${color}` : 'none';
            b.style.border = isMatch ? '2px solid #fff' : '2px solid transparent';
        });
    }

    // Select icon preset
    const iconContainer = document.getElementById('groupIconPalette');
    if (iconContainer) {
        iconContainer.querySelectorAll('.icon-preset-btn').forEach(b => {
            const isMatch = b.getAttribute('data-icon') === icon;
            b.style.border = isMatch ? '1px solid var(--accent-purple)' : '1px solid var(--border-color)';
            b.style.background = isMatch ? 'rgba(99, 102, 241, 0.15)' : 'transparent';
            b.style.color = isMatch ? 'var(--accent-purple)' : 'var(--text-secondary)';
        });
    }

    modal.style.display = 'flex';
}

function closeGroupEditModal() {
    const modal = document.getElementById('modalChannelGroupEdit');
    if (modal) modal.style.display = 'none';
}

async function handleSaveChannelGroup(e) {
    e.preventDefault();
    const id = document.getElementById('groupEditId').value;
    const name = document.getElementById('groupEditName').value.trim();
    const description = document.getElementById('groupEditDesc').value.trim();
    const color = document.getElementById('groupEditColor').value;
    const icon = document.getElementById('groupEditIcon').value;

    if (!name) {
        showToast('Vui lòng nhập tên nhóm kênh', true);
        return;
    }

    const saveBtn = document.getElementById('btnSaveChannelGroup');
    const origHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
    }

    try {
        let res;
        if (id) {
            // Update
            res = await fetch(`/api/channel-groups/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, color, icon })
            });
        } else {
            // Create
            res = await fetch('/api/channel-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description, color, icon })
            });
        }

        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.detail || data.error || 'Lỗi khi lưu nhóm');
        }

        showToast(data.message || 'Lưu nhóm kênh thành công!');
        closeGroupEditModal();
        await loadChannelGroups();
        if (typeof loadSavedChannels === 'function') {
            loadSavedChannels();
        }
    } catch (err) {
        console.error('Lỗi lưu nhóm:', err);
        showToast(err.message, true);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = origHtml;
        }
    }
}

// 6. Delete Group Confirmation
async function deleteChannelGroupConfirm(groupId, groupName) {
    const confirmed = confirm(`Bạn có chắc chắn muốn xóa nhóm '${groupName}'?\n\nLưu ý: Các kênh thuộc nhóm này sẽ KHÔNG bị xóa mà được chuyển về trạng thái 'Chưa phân nhóm'.`);
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/channel-groups/${groupId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.detail || data.error || 'Lỗi khi xóa nhóm');
        }

        showToast(data.message || 'Đã xóa nhóm thành công');
        await loadChannelGroups();
        if (typeof loadSavedChannels === 'function') {
            loadSavedChannels();
        }
    } catch (err) {
        console.error('Lỗi xóa nhóm:', err);
        showToast(err.message, true);
    }
}

// 7. Group Detail & Manage Channels Modal
async function openGroupDetailModal(groupId) {
    activeDetailGroupId = groupId;
    const modal = document.getElementById('modalChannelGroupDetail');
    if (!modal) return;

    try {
        const res = await fetch(`/api/channel-groups/${groupId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.status !== 'success' || !data.group) {
            throw new Error(data.detail || 'Không thể tải chi tiết nhóm');
        }

        activeDetailGroupData = data.group;
        const g = data.group;

        // Populate Header
        document.getElementById('groupDetailTitle').textContent = g.name || 'Chi Tiết Nhóm';
        document.getElementById('groupDetailCountBadge').textContent = `${(g.channels || []).length} Kênh`;
        document.getElementById('groupDetailDesc').textContent = g.description || 'Chưa có mô tả';

        const color = g.color || '#6366f1';
        const icon = g.icon || 'fa-layer-group';
        const avatarWrap = document.getElementById('groupDetailAvatarWrap');
        if (avatarWrap) {
            avatarWrap.style.background = `linear-gradient(135deg, ${color}, #1e1b4b)`;
            avatarWrap.style.boxShadow = `0 4px 14px ${color}55`;
        }
        const iconEl = document.getElementById('groupDetailIcon');
        if (iconEl) iconEl.className = `fa-solid ${icon}`;

        // Calculate mini stats
        const channels = g.channels || [];
        const totalSubs = channels.reduce((sum, c) => sum + (c.subscriber_count || 0), 0);
        const totalVids = channels.reduce((sum, c) => sum + (c.video_count || 0), 0);
        const avgViews = channels.length > 0 ? Math.round(channels.reduce((sum, c) => sum + (c.avg_views || 0), 0) / channels.length) : 0;

        document.getElementById('groupDetailTotalSubs').textContent = formatNumber(totalSubs);
        document.getElementById('groupDetailTotalVideos').textContent = totalVids.toLocaleString('vi-VN');
        document.getElementById('groupDetailAvgViews').textContent = formatNumber(avgViews);

        // Reset filter
        const searchInput = document.getElementById('searchChannelsInGroupKeyword');
        if (searchInput) searchInput.value = '';

        renderChannelsInGroupTable(channels);
        modal.style.display = 'flex';
    } catch (err) {
        console.error('Lỗi mở chi tiết nhóm:', err);
        showToast(err.message, true);
    }
}

function closeGroupDetailModal() {
    const modal = document.getElementById('modalChannelGroupDetail');
    if (modal) modal.style.display = 'none';
    activeDetailGroupId = null;
    activeDetailGroupData = null;
}

function filterChannelsInGroupList() {
    if (!activeDetailGroupData || !activeDetailGroupData.channels) return;
    const kw = (document.getElementById('searchChannelsInGroupKeyword')?.value || '').trim().toLowerCase();
    const channels = activeDetailGroupData.channels.filter(c => {
        const title = (c.display_name || c.title || '').toLowerCase();
        const cid = (c.channel_id || '').toLowerCase();
        const handle = (c.handle || '').toLowerCase();
        return title.includes(kw) || cid.includes(kw) || handle.includes(kw);
    });
    renderChannelsInGroupTable(channels);
}

function renderChannelsInGroupTable(channels) {
    const tbody = document.getElementById('groupChannelsTableBody');
    const countEl = document.getElementById('groupChannelsListCount');
    if (!tbody) return;

    if (countEl) {
        countEl.textContent = `Hiển thị ${channels.length} kênh`;
    }

    if (!channels.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fa-solid fa-folder-open" style="font-size:22px; opacity:0.4; display:block; margin-bottom:6px;"></i>Chưa có kênh nào trong nhóm này.<br><button class="btn btn-sm btn-primary mt-2" onclick="openAddChannelsToGroupModal()"><i class="fa-solid fa-plus"></i> Thêm Kênh Vào Nhóm</button></td></tr>`;
        return;
    }

    tbody.innerHTML = channels.map(c => {
        const cid = c.channel_id || '';
        const title = escapeHtml(c.display_name || c.title || cid);
        const handle = c.handle ? `<span style="font-size:11px; color:var(--accent-cyan);">@${escapeHtml(c.handle.replace('@', ''))}</span>` : '';
        const thumb = c.thumbnail_url
            ? `<img src="${c.thumbnail_url}" alt="" style="width:34px; height:34px; border-radius:50%; object-fit:cover; border:1px solid rgba(255,255,255,0.1);">`
            : `<div style="width:34px; height:34px; border-radius:50%; background:rgba(255,255,255,0.06); display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><i class="fa-brands fa-youtube"></i></div>`;

        const subs = c.subscriber_count ? formatNumber(c.subscriber_count) : 'N/A';
        const vids = c.video_count ? c.video_count.toLocaleString() : 'N/A';
        const avgViews = c.avg_views ? formatNumber(c.avg_views) : 'N/A';
        const isActive = c.is_active === 1;

        return `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${thumb}
                        <div style="min-width:0;">
                            <strong style="color:var(--text-primary); font-size:13px; display:block;" title="${title}">${title}</strong>
                            ${handle}
                        </div>
                    </div>
                </td>
                <td>
                    <div style="display:flex; align-items:center; gap:4px;">
                        <span class="channel-id-tag" style="font-size:11px;" title="${escapeHtml(cid)}">${escapeHtml(cid)}</span>
                        <button type="button" class="btn-copy-id" onclick="copyTextToClipboard('${escapeHtml(cid)}', 'Đã sao chép Channel ID!')" title="Sao chép Channel ID">
                            <i class="fa-solid fa-copy"></i>
                        </button>
                    </div>
                </td>
                <td><strong style="color:var(--text-primary);">${subs}</strong></td>
                <td><span style="color:var(--text-secondary);">${vids}</span></td>
                <td><strong style="color:var(--accent-cyan);">${avgViews}</strong></td>
                <td>
                    ${isActive ? '<span class="badge badge-success">Hoạt động</span>' : '<span class="badge badge-secondary">Tạm ngưng</span>'}
                </td>
                <td style="text-align: center;">
                    <button type="button" class="btn btn-outline-danger btn-sm has-tooltip" onclick="removeChannelFromGroup('${escapeHtml(cid)}', '${escapeHtml(title)}')" data-tooltip="Gỡ kênh khỏi nhóm này" style="height:28px; padding:0 8px; font-size:11px;">
                        <i class="fa-solid fa-user-minus"></i> Gỡ
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

async function removeChannelFromGroup(channelId, channelTitle) {
    if (!activeDetailGroupId) return;
    const confirmed = confirm(`Bạn có muốn gỡ kênh '${channelTitle}' khỏi nhóm này?`);
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/channel-groups/${activeDetailGroupId}/channels/${channelId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.detail || data.error || 'Lỗi khi gỡ kênh khỏi nhóm');
        }

        showToast(`Đã gỡ kênh khỏi nhóm`);
        await openGroupDetailModal(activeDetailGroupId);
        await loadChannelGroups();
        if (typeof loadSavedChannels === 'function') {
            loadSavedChannels();
        }
    } catch (err) {
        console.error('Lỗi gỡ kênh:', err);
        showToast(err.message, true);
    }
}

async function confirmDeleteCurrentGroup() {
    if (!activeDetailGroupId || !activeDetailGroupData) return;
    const name = activeDetailGroupData.name || '';
    closeGroupDetailModal();
    await deleteChannelGroupConfirm(activeDetailGroupId, name);
}

// 8. Add Channels To Group Multi-Select Modal
let addCandidateChannels = [];

function openAddChannelsToGroupModal(groupId) {
    const targetGroupId = groupId || activeDetailGroupId;
    if (!targetGroupId) return;
    activeDetailGroupId = targetGroupId;

    const group = cachedChannelGroups.find(g => g.id === targetGroupId) || activeDetailGroupData;
    const groupName = group ? group.name : 'nhóm';

    const subtitleEl = document.getElementById('modalAddChannelsSubtitle');
    if (subtitleEl) subtitleEl.textContent = `Chọn các kênh đang theo dõi để thêm vào nhóm: ${groupName}`;

    // Filter candidate channels: All saved channels NOT in this group
    const allChannels = window.cachedSavedChannels || [];
    addCandidateChannels = allChannels.filter(c => c.group_id !== targetGroupId);

    const searchInput = document.getElementById('searchAddCandidateKeyword');
    if (searchInput) searchInput.value = '';
    const groupStatusFilter = document.getElementById('filterAddCandidateGroupStatus');
    if (groupStatusFilter) groupStatusFilter.value = 'all';

    renderAddCandidatesList();

    const modal = document.getElementById('modalAddChannelsToGroup');
    if (modal) modal.style.display = 'flex';
}

function closeAddChannelsToGroupModal() {
    const modal = document.getElementById('modalAddChannelsToGroup');
    if (modal) modal.style.display = 'none';
}

function filterAddCandidatesList() {
    renderAddCandidatesList();
}

function renderAddCandidatesList() {
    const container = document.getElementById('addCandidatesListContainer');
    if (!container) return;

    const kw = (document.getElementById('searchAddCandidateKeyword')?.value || '').trim().toLowerCase();
    const groupStatus = document.getElementById('filterAddCandidateGroupStatus')?.value || 'all';

    const filtered = addCandidateChannels.filter(c => {
        // Group status filter
        const isGrouped = Boolean(c.group_id && c.group_id !== 0);
        if (groupStatus === 'ungrouped' && isGrouped) return false;
        if (groupStatus === 'grouped' && !isGrouped) return false;

        // Keyword filter
        if (!kw) return true;
        const title = (c.display_name || c.title || '').toLowerCase();
        const cid = (c.channel_id || '').toLowerCase();
        const handle = (c.handle || '').toLowerCase();
        return title.includes(kw) || cid.includes(kw) || handle.includes(kw);
    });

    if (!filtered.length) {
        container.innerHTML = `
            <div style="text-align: center; padding: 24px 10px; color: var(--text-muted); font-size: 13px;">
                <i class="fa-solid fa-circle-check" style="font-size: 24px; color: #10b981; display: block; margin-bottom: 8px;"></i>
                Tất cả các kênh đang giám sát đã thuộc nhóm này hoặc không tìm thấy kênh phù hợp!
            </div>
        `;
        updateAddCandidateSelectedCount();
        return;
    }

    container.innerHTML = filtered.map(c => {
        const cid = escapeHtml(c.channel_id || '');
        const title = escapeHtml(c.display_name || c.title || cid);
        const handle = c.handle ? `<span style="font-size:11px; color:var(--accent-cyan);">@${escapeHtml(c.handle.replace('@', ''))}</span>` : '';
        const currentGroupTag = c.group_name
            ? `<span class="badge" style="font-size:10.5px; background:${c.group_color || '#6366f1'}22; color:${c.group_color || '#6366f1'}; border:1px solid ${c.group_color || '#6366f1'}44;"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(c.group_name)}</span>`
            : `<span class="badge badge-muted" style="font-size:10.5px;">Chưa có nhóm</span>`;

        const thumb = c.thumbnail_url
            ? `<img src="${c.thumbnail_url}" alt="" style="width:30px; height:30px; border-radius:50%; object-fit:cover;">`
            : `<div style="width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,0.08); display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--text-muted);"><i class="fa-brands fa-youtube"></i></div>`;

        return `
            <label style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 6px; cursor: pointer; background: rgba(255,255,255,0.02); transition: background 0.15s ease;">
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                    <input type="checkbox" class="add-candidate-checkbox" value="${cid}" onchange="updateAddCandidateSelectedCount()" style="width: 16px; height: 16px; cursor: pointer;">
                    ${thumb}
                    <div style="min-width: 0;">
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px;">${title}</div>
                        ${handle}
                    </div>
                </div>
                <div style="flex-shrink: 0;">
                    ${currentGroupTag}
                </div>
            </label>
        `;
    }).join('');

    updateAddCandidateSelectedCount();
}

function toggleSelectAllCandidates(selectAll) {
    const checkboxes = document.querySelectorAll('.add-candidate-checkbox');
    checkboxes.forEach(cb => cb.checked = selectAll);
    updateAddCandidateSelectedCount();
}

function updateAddCandidateSelectedCount() {
    const checked = document.querySelectorAll('.add-candidate-checkbox:checked');
    const countEl = document.getElementById('addCandidateSelectedCount');
    if (countEl) {
        countEl.textContent = `Đã chọn ${checked.length} kênh`;
    }
}

async function submitAddChannelsToGroup() {
    if (!activeDetailGroupId) return;

    const checkedBoxes = document.querySelectorAll('.add-candidate-checkbox:checked');
    const channelIds = Array.from(checkedBoxes).map(cb => cb.value);

    if (!channelIds.length) {
        showToast('Vui lòng tích chọn ít nhất 1 kênh để thêm', true);
        return;
    }

    const btn = document.getElementById('btnSubmitAddChannelsToGroup');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang thêm...';
    }

    try {
        const res = await fetch(`/api/channel-groups/${activeDetailGroupId}/channels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_ids: channelIds })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.detail || data.error || 'Lỗi khi thêm kênh vào nhóm');
        }

        showToast(data.message || `Đã thêm ${channelIds.length} kênh vào nhóm`);
        closeAddChannelsToGroupModal();

        // Refresh detail view if open
        const detailModal = document.getElementById('modalChannelGroupDetail');
        if (detailModal && detailModal.style.display !== 'none') {
            await openGroupDetailModal(activeDetailGroupId);
        }

        await loadChannelGroups();
        if (typeof loadSavedChannels === 'function') {
            loadSavedChannels();
        }
    } catch (err) {
        console.error('Lỗi thêm kênh vào nhóm:', err);
        showToast(err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// 9. Quick Assign Channel Group Modal (from Saved Channels table)
function openAssignChannelGroupModal(channelId) {
    const allChannels = window.cachedSavedChannels || [];
    const ch = allChannels.find(c => c.channel_id === channelId);
    if (!ch) return;

    const modal = document.getElementById('modalAssignChannelGroup');
    if (!modal) return;

    document.getElementById('assignChannelId').value = channelId;
    document.getElementById('assignChannelTitle').textContent = ch.display_name || ch.title || channelId;
    document.getElementById('assignChannelHandle').textContent = ch.handle ? `@${ch.handle.replace('@', '')}` : '';

    const thumb = document.getElementById('assignChannelThumb');
    const fallback = document.getElementById('assignChannelFallback');
    if (ch.thumbnail_url) {
        if (thumb) {
            thumb.src = ch.thumbnail_url;
            thumb.style.display = 'block';
        }
        if (fallback) fallback.style.display = 'none';
    } else {
        if (thumb) thumb.style.display = 'none';
        if (fallback) fallback.style.display = 'flex';
    }

    syncGroupDropdowns();

    const select = document.getElementById('assignChannelGroupSelect');
    if (select) {
        select.value = ch.group_id ? String(ch.group_id) : '';
    }

    modal.style.display = 'flex';
}

function closeAssignChannelGroupModal() {
    const modal = document.getElementById('modalAssignChannelGroup');
    if (modal) modal.style.display = 'none';
}

async function submitAssignChannelGroup() {
    const channelId = document.getElementById('assignChannelId').value;
    const select = document.getElementById('assignChannelGroupSelect');
    const groupIdVal = select ? select.value : '';
    const groupId = groupIdVal ? parseInt(groupIdVal, 10) : null;

    try {
        const res = await fetch('/api/channels/assign-group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel_id: channelId, group_id: groupId })
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
            throw new Error(data.detail || data.error || 'Lỗi khi gán nhóm cho kênh');
        }

        showToast('Cập nhật nhóm cho kênh thành công!');
        closeAssignChannelGroupModal();
        await loadChannelGroups();
        if (typeof loadSavedChannels === 'function') {
            loadSavedChannels();
        }
    } catch (err) {
        console.error('Lỗi gán nhóm:', err);
        showToast(err.message, true);
    }
}

// Export functions to window
window.loadChannelGroups = loadChannelGroups;
window.renderChannelGroups = renderChannelGroups;
window.openCreateGroupModal = openCreateGroupModal;
window.openEditGroupModal = openEditGroupModal;
window.closeGroupEditModal = closeGroupEditModal;
window.handleSaveChannelGroup = handleSaveChannelGroup;
window.deleteChannelGroupConfirm = deleteChannelGroupConfirm;
window.openGroupDetailModal = openGroupDetailModal;
window.closeGroupDetailModal = closeGroupDetailModal;
window.filterChannelsInGroupList = filterChannelsInGroupList;
window.removeChannelFromGroup = removeChannelFromGroup;
window.confirmDeleteCurrentGroup = confirmDeleteCurrentGroup;
window.openAddChannelsToGroupModal = openAddChannelsToGroupModal;
window.closeAddChannelsToGroupModal = closeAddChannelsToGroupModal;
window.filterAddCandidatesList = filterAddCandidatesList;
window.toggleSelectAllCandidates = toggleSelectAllCandidates;
window.updateAddCandidateSelectedCount = updateAddCandidateSelectedCount;
window.submitAddChannelsToGroup = submitAddChannelsToGroup;
window.openAssignChannelGroupModal = openAssignChannelGroupModal;
window.closeAssignChannelGroupModal = closeAssignChannelGroupModal;
window.submitAssignChannelGroup = submitAssignChannelGroup;
window.handleGroupSortChange = handleGroupSortChange;
window.resetGroupFilters = resetGroupFilters;
window.changeChannelGroupsPageSize = changeChannelGroupsPageSize;
window.goToChannelGroupsPage = goToChannelGroupsPage;
