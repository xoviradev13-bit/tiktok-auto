// ==========================================
// 4. GPMLOGIN PROFILES & TIKTOK TRACKER
// ==========================================
let gpmSortField = 'followers_count';
let gpmSortDirection = 'desc';
let gpmCurrentPage = 1;
let gpmPageSize = 20;

// Trạng thái Proxy Pool & Đa chọn tài khoản (Checkbox across pages)
let cachedProxyPool = [];
let cachedProxyCountries = [];
let cachedProxySummary = null;
const selectedProfileIds = new Set();

function getProfileIpKey(rawProxy) {
    if (!rawProxy) return '';
    const m = rawProxy.match(/(?:@|^|\/\/)([0-9a-zA-Z\.\-]+:\d+)/);
    return m ? m[1] : rawProxy;
}

async function loadProxyPool() {
    try {
        const res = await fetch('/api/proxy/summary?_t=' + Date.now());
        const data = await res.json();
        cachedProxySummary = data;
        cachedProxyPool = data.proxies || [];
        cachedProxyCountries = data.countries || [];
        populateDynamicCountryFilters();
    } catch (err) {
        console.error('Lỗi nạp danh sách proxy:', err);
    }
}

function populateDynamicCountryFilters() {
    const filterSelect = document.getElementById('filterGpmCountry');
    if (!filterSelect) return;
    const currentVal = filterSelect.value || 'ALL';

    let html = `<option value="ALL">Tất cả quốc gia</option>`;
    html += `<option value="NONE">🌐 Không dùng Proxy (Direct)</option>`;

    if (cachedProxyCountries && cachedProxyCountries.length > 0) {
        cachedProxyCountries.forEach(c => {
            const flag = c.flag || '🌐';
            const name = c.name || c.code;
            const count = c.total || c.count || 0;
            html += `<option value="${c.code}">${flag} ${name} (${c.code}) - ${count} IP</option>`;
        });
    }

    filterSelect.innerHTML = html;
    if (currentVal && filterSelect.querySelector(`option[value="${currentVal}"]`)) {
        filterSelect.value = currentVal;
    } else {
        filterSelect.value = 'ALL';
    }
    populateDynamicIpFilters();
}

function populateDynamicIpFilters() {
    const ipSelect = document.getElementById('filterGpmIp');
    if (!ipSelect) return;
    const currentVal = ipSelect.value || 'ALL';
    const cTarget = (document.getElementById('filterGpmCountry')?.value || 'ALL').toUpperCase();

    let html = `<option value="ALL">Tất cả IP</option>`;
    html += `<option value="NONE">🌐 Direct (Không Proxy)</option>`;

    let pool = cachedProxyPool || [];
    if (cTarget !== 'ALL' && cTarget !== 'NONE') {
        pool = pool.filter(p => (p.country || '').toUpperCase() === cTarget);
    } else if (cTarget === 'NONE') {
        pool = [];
    }

    pool.forEach(p => {
        const countryName = p.country_name || p.country;
        const city = p.city ? ` - ${p.city}` : '';
        const blocked = p.status === 'blocked' ? ' [Bị Chặn]' : '';
        html += `<option value="${p.key}">[${p.country}] ${p.key} (${countryName}${city})${blocked}</option>`;
    });

    ipSelect.innerHTML = html;
    if (currentVal && ipSelect.querySelector(`option[value="${currentVal}"]`)) {
        ipSelect.value = currentVal;
    } else {
        ipSelect.value = 'ALL';
    }
}

function onFilterCountryChange() {
    populateDynamicIpFilters();
    renderGpmProfilesTable();
}

function getProfileGroupName(p) {
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

async function loadGpmProfiles() {
    try {
        await loadProxyPool();
        const res = await fetch('/api/gpm/profiles');
        const profiles = await res.json();
        cachedGpmProfiles = profiles;
        populateGpmGroupAndCampaignFilters();
        renderGpmProfilesTable();
    } catch (err) {
        console.error('Lỗi nạp profiles:', err);
    }
}

function populateGpmGroupAndCampaignFilters() {
    const groupSelect = document.getElementById('filterGpmGroup');
    const campaignSelect = document.getElementById('filterGpmCampaign');
    if (!cachedGpmProfiles || !Array.isArray(cachedGpmProfiles)) return;

    // 1. Nhóm (Groups)
    if (groupSelect) {
        const currentGroupVal = groupSelect.value || 'ALL';
        const groupsSet = new Set();
        let hasUngrouped = false;

        cachedGpmProfiles.forEach(p => {
            const g = getProfileGroupName(p);
            if (g) {
                groupsSet.add(g);
            } else {
                hasUngrouped = true;
            }
        });

        const sortedGroups = Array.from(groupsSet).sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
        let groupHtml = `<option value="ALL">Tất cả nhóm</option>`;
        if (hasUngrouped) {
            groupHtml += `<option value="UNGROUPED">Chưa phân nhóm</option>`;
        }
        sortedGroups.forEach(g => {
            groupHtml += `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`;
        });
        groupSelect.innerHTML = groupHtml;
        if (currentGroupVal && (currentGroupVal === 'ALL' || currentGroupVal === 'UNGROUPED' || groupsSet.has(currentGroupVal))) {
            groupSelect.value = currentGroupVal;
        } else {
            groupSelect.value = 'ALL';
        }
    }

    // 2. Chiến Dịch (Campaigns)
    if (campaignSelect) {
        const currentCampVal = campaignSelect.value || 'ALL';
        const campaignsSet = new Set();
        let hasUnassigned = false;

        cachedGpmProfiles.forEach(p => {
            const cList = p.campaign_names && p.campaign_names.length > 0 ? p.campaign_names : (p.campaign_name ? [p.campaign_name] : []);
            if (cList.length > 0) {
                cList.forEach(c => {
                    const cleanC = (c || '').trim();
                    if (cleanC) campaignsSet.add(cleanC);
                });
            } else {
                hasUnassigned = true;
            }
        });

        const sortedCampaigns = Array.from(campaignsSet).sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
        let campHtml = `<option value="ALL">Tất cả chiến dịch</option>`;
        if (hasUnassigned) {
            campHtml += `<option value="UNASSIGNED">Chưa gán chiến dịch</option>`;
        }
        sortedCampaigns.forEach(c => {
            campHtml += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
        });
        campaignSelect.innerHTML = campHtml;
        if (currentCampVal && (currentCampVal === 'ALL' || currentCampVal === 'UNASSIGNED' || campaignsSet.has(currentCampVal))) {
            campaignSelect.value = currentCampVal;
        } else {
            campaignSelect.value = 'ALL';
        }
    }
}

function handleGpmSortChange(val) {
    gpmSortField = val;
    renderGpmProfilesTable();
}

function toggleGpmSortDirection() {
    gpmSortDirection = gpmSortDirection === 'asc' ? 'desc' : 'asc';
    const icon = document.getElementById('gpmSortDirIcon');
    const text = document.getElementById('gpmSortDirText');
    if (icon) icon.className = gpmSortDirection === 'asc' ? 'fa-solid fa-arrow-up-wide-short' : 'fa-solid fa-arrow-down-wide-short';
    if (text) text.textContent = gpmSortDirection === 'asc' ? 'Tăng dần' : 'Giảm dần';
    renderGpmProfilesTable();
}

function handleGpmHeaderSort(field) {
    const effField = field === 'campaign' ? 'campaign_name' : field;
    if (gpmSortField === effField) {
        gpmSortDirection = gpmSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        gpmSortField = effField;
        gpmSortDirection = (effField === 'followers_count' || effField === 'total_views' || effField === 'eligible_10k') ? 'desc' : 'asc';
    }
    const select = document.getElementById('sortGpmField');
    if (select) select.value = gpmSortField;
    const icon = document.getElementById('gpmSortDirIcon');
    const text = document.getElementById('gpmSortDirText');
    if (icon) icon.className = gpmSortDirection === 'asc' ? 'fa-solid fa-arrow-up-wide-short' : 'fa-solid fa-arrow-down-wide-short';
    if (text) text.textContent = gpmSortDirection === 'asc' ? 'Tăng dần' : 'Giảm dần';
    renderGpmProfilesTable();
}

function resetGpmFilters() {
    gpmSortField = 'followers_count';
    gpmSortDirection = 'desc';
    gpmCurrentPage = 1;
    const sortSel = document.getElementById('sortGpmField');
    if (sortSel) sortSel.value = 'followers_count';
    const filterGroup = document.getElementById('filterGpmGroup');
    if (filterGroup) filterGroup.value = 'ALL';
    const filterCampaign = document.getElementById('filterGpmCampaign');
    if (filterCampaign) filterCampaign.value = 'ALL';
    const filterCountry = document.getElementById('filterGpmCountry');
    if (filterCountry) filterCountry.value = 'ALL';
    const filterBeta = document.getElementById('filterGpmBeta');
    if (filterBeta) filterBeta.value = 'ALL';
    const filterCp = document.getElementById('filterGpmCreatorProgram');
    if (filterCp) filterCp.value = 'ALL';
    const filterFlop = document.getElementById('filterGpmFlop');
    if (filterFlop) filterFlop.value = 'ALL';
    const filter10k = document.getElementById('filterGpm10k');
    if (filter10k) filter10k.value = 'all';
    const filterNotify = document.getElementById('filterGpmNotify');
    if (filterNotify) filterNotify.value = 'all';
    const filterNick = document.getElementById('filterGpmNick');
    if (filterNick) filterNick.value = 'all';
    const searchKw = document.getElementById('searchGpmKeyword');
    if (searchKw) searchKw.value = '';
    const icon = document.getElementById('gpmSortDirIcon');
    const text = document.getElementById('gpmSortDirText');
    if (icon) icon.className = 'fa-solid fa-arrow-down-wide-short';
    if (text) text.textContent = 'Giảm dần';
    renderGpmProfilesTable();
}

async function exportGpmProfilesCsv() {
    if (!cachedGpmProfiles || !cachedGpmProfiles.length) {
        try {
            const res = await fetch('/api/gpm/profiles');
            const data = await res.json();
            if (Array.isArray(data)) cachedGpmProfiles = data;
        } catch (e) {
            console.warn('Lỗi tải profiles trước khi xuất CSV:', e);
        }
    }
    const filterGroup = document.getElementById('filterGpmGroup')?.value || 'ALL';
    const filterCampaign = document.getElementById('filterGpmCampaign')?.value || 'ALL';
    const filterCountry = (document.getElementById('filterGpmCountry')?.value || 'ALL').toUpperCase();
    const filterIp = document.getElementById('filterGpmIp')?.value || 'ALL';
    const filterBeta = document.getElementById('filterGpmBeta')?.value || 'ALL';
    const filterCreatorProgram = document.getElementById('filterGpmCreatorProgram')?.value || 'ALL';
    const filterFlop = document.getElementById('filterGpmFlop')?.value || 'ALL';
    const filter10k = document.getElementById('filterGpm10k')?.value || 'all';
    const filterNotify = document.getElementById('filterGpmNotify')?.value || 'all';
    const filterNick = document.getElementById('filterGpmNick')?.value || 'all';
    const keyword = (document.getElementById('searchGpmKeyword')?.value || '').trim().toLowerCase();

    let list = (cachedGpmProfiles || []).slice();

    // Filter Group
    if (filterGroup !== 'ALL') {
        if (filterGroup === 'UNGROUPED') {
            list = list.filter(p => !getProfileGroupName(p));
        } else {
            list = list.filter(p => getProfileGroupName(p).toLowerCase() === filterGroup.toLowerCase());
        }
    }

    // Filter Campaign
    if (filterCampaign !== 'ALL') {
        if (filterCampaign === 'UNASSIGNED') {
            list = list.filter(p => (!p.campaign_names || p.campaign_names.length === 0) && !p.campaign_name);
        } else {
            list = list.filter(p => {
                const cList = (p.campaign_names || []).concat(p.campaign_name ? [p.campaign_name] : []);
                return cList.some(cn => (cn || '').toLowerCase() === filterCampaign.toLowerCase());
            });
        }
    }

    // Filter Country
    if (filterCountry !== 'ALL') {
        if (filterCountry === 'NONE') {
            list = list.filter(p => !p.country || p.country.toUpperCase() === 'NONE');
        } else {
            list = list.filter(p => (p.country || '').toUpperCase() === filterCountry);
        }
    }

    // Filter IP Proxy
    if (filterIp && filterIp !== 'ALL') {
        if (filterIp === 'NONE') {
            list = list.filter(p => !p.raw_proxy || p.raw_proxy.trim() === '' || !p.country || p.country.toUpperCase() === 'NONE');
        } else {
            list = list.filter(p => {
                const pKey = getProfileIpKey(p.raw_proxy);
                return pKey === filterIp || (p.raw_proxy && p.raw_proxy.includes(filterIp));
            });
        }
    }

    // Filter Beta
    if (filterBeta === 'ELIGIBLE') {
        list = list.filter(p => isProfileEligible(p));
    } else if (filterBeta === 'INELIGIBLE') {
        list = list.filter(p => !isProfileEligible(p));
    }

    // Filter Creator Program (Yes / No / Specific)
    if (filterCreatorProgram !== 'ALL') {
        list = list.filter(p => {
            const cpStatus = (p.creator_program || (isProfileEligible(p) ? 'active' : 'ineligible')).toLowerCase();
            if (filterCreatorProgram === 'YES') return cpStatus === 'active';
            if (filterCreatorProgram === 'NO') return cpStatus !== 'active';
            if (filterCreatorProgram === 'ACTIVE') return cpStatus === 'active';
            if (filterCreatorProgram === 'NOT_ENROLLED') return cpStatus === 'not_enrolled';
            if (filterCreatorProgram === 'INELIGIBLE') return cpStatus === 'ineligible';
            if (filterCreatorProgram === 'BANNED') return cpStatus === 'banned';
            return true;
        });
    }

    // Filter Flop / Performance
    if (filterFlop !== 'ALL') {
        list = list.filter(p => {
            const fStatus = (p.flop_status || 'new').toLowerCase();
            if (filterFlop === 'GOOD') return fStatus === 'good';
            if (filterFlop === 'FLOP') return fStatus === '0_view' || fStatus === '200_view' || fStatus === 'unstable';
            if (filterFlop === '200_VIEW') return fStatus === '200_view';
            if (filterFlop === '0_VIEW') return fStatus === '0_view';
            if (filterFlop === 'UNSTABLE') return fStatus === 'unstable';
            if (filterFlop === 'NEW') return fStatus === 'new';
            if (filterFlop === 'BREAKOUT') return Boolean(p.is_breakout);
            if (filterFlop === 'RECOVERING') return Boolean(p.flop_recovering);
            return true;
        });
    }

    if (filter10k === '10k') {
        list = list.filter(p => isProfileEligible(p));
    } else if (filter10k === 'growing') {
        list = list.filter(p => !isProfileEligible(p));
    }

    if (filterNotify === 'tracking') {
        list = list.filter(p => (p.notify_status || 'tracking').toLowerCase() === 'tracking');
    } else if (filterNotify === 'sent') {
        list = list.filter(p => (p.notify_status || '').toLowerCase() === 'sent');
    } else if (filterNotify === 'muted') {
        list = list.filter(p => (p.notify_status || '').toLowerCase() === 'muted');
    }

    if (filterNick === 'attached') {
        list = list.filter(p => Boolean(p.tiktok_username && p.tiktok_username.trim()));
    } else if (filterNick === 'unattached') {
        list = list.filter(p => !Boolean(p.tiktok_username && p.tiktok_username.trim()));
    }

    if (keyword) {
        list = list.filter(p => {
            const name = (p.name || '').toLowerCase();
            const u = (p.tiktok_username || '').toLowerCase();
            const nick = (p.tiktok_nickname || '').toLowerCase();
            const uid = (p.tiktok_uid || '').toLowerCase();
            const proxy = (p.raw_proxy || '').toLowerCase();
            const gid = (p.gpm_id || '').toLowerCase();
            const nstat = (p.notify_status || 'tracking').toLowerCase();
            return name.includes(keyword) || u.includes(keyword) || nick.includes(keyword) || uid.includes(keyword) || proxy.includes(keyword) || gid.includes(keyword) || nstat.includes(keyword);
        });
    }

    list.sort((a, b) => {
        let res = 0;
        if (gpmSortField === 'followers_count') {
            res = (a.followers_count || 0) - (b.followers_count || 0);
        } else if (gpmSortField === 'name') {
            res = (a.name || '').localeCompare(b.name || '', 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'group_name') {
            res = getProfileGroupName(a).localeCompare(getProfileGroupName(b), 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'total_views') {
            res = (a.total_views || 0) - (b.total_views || 0);
        } else if (gpmSortField === 'campaign_name' || gpmSortField === 'campaign') {
            res = (a.campaign_name || '').localeCompare(b.campaign_name || '', 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'tiktok_username') {
            res = (a.tiktok_username || '').localeCompare(b.tiktok_username || '', 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'eligible_10k') {
            const ea = isProfileEligible(a) ? 1 : 0;
            const eb = isProfileEligible(b) ? 1 : 0;
            res = ea - eb;
        } else if (gpmSortField === 'creator_program') {
            const cpWeight = (p) => {
                const s = (p.creator_program || (isProfileEligible(p) ? 'active' : 'ineligible')).toLowerCase();
                if (s === 'active') return 4;
                if (s === 'not_enrolled') return 3;
                if (s === 'banned') return 2;
                if (s === 'ineligible') return 1;
                return 0;
            };
            res = cpWeight(a) - cpWeight(b);
        } else if (gpmSortField === 'flop_status') {
            const flopWeight = (p) => {
                const s = (p.flop_status || 'new').toLowerCase();
                if (s === 'good') return 5;
                if (s === 'unstable') return 4;
                if (s === 'new') return 3;
                if (s === '200_view') return 2;
                if (s === '0_view') return 1;
                return 0;
            };
            res = flopWeight(a) - flopWeight(b);
        } else if (gpmSortField === 'notify_status') {
            res = (a.notify_status || 'tracking').localeCompare(b.notify_status || 'tracking');
        } else if (gpmSortField === 'country') {
            res = (a.country || '').localeCompare(b.country || '');
        } else if (gpmSortField === 'last_checked') {
            res = (a.last_checked || '').localeCompare(b.last_checked || '');
        }
        return gpmSortDirection === 'asc' ? res : -res;
    });

    const header = ['Tên Profile', 'GPM ID', 'Nhóm / Group', 'Account Username', 'Tổng Lượt Xem', 'Chiến Dịch', 'Nền Tảng', 'Quốc Gia VPN', 'Proxy', 'Số Follower / Subs', 'Đạt Chỉ Tiêu / Beta', 'Creator Program', 'Hiệu Suất / Flop', 'Trạng Thái Theo Dõi', 'Lần Quét Cuối'];
    const rows = [header, ...list.map(p => {
        const ns = (p.notify_status || 'tracking').toLowerCase();
        const nsLabel = ns === 'sent' ? 'Đã gửi' : (ns === 'muted' ? 'Bỏ theo dõi' : 'Đang theo dõi');
        const cNames = p.campaign_names && p.campaign_names.length > 0 ? p.campaign_names.join(', ') : (p.campaign_name || '');
        return [
            p.name || '',
            p.gpm_id || '',
            getProfileGroupName(p),
            p.tiktok_username || '',
            p.total_views || 0,
            cNames,
            (p.platform || 'tiktok').toUpperCase(),
            p.country || 'NONE',
            p.raw_proxy || '',
            p.followers_count || 0,
            isProfileEligible(p) ? 'Đạt' : 'Chưa Đạt',
            p.creator_program || '',
            p.flop_status || '',
            nsLabel,
            p.last_checked || ''
        ];
    })];

    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`dan_tai_khoan_gpm_${dateStr}.csv`, rows);
}

let _gpmSearchDebounceTimer = null;
function debouncedRenderGpmProfilesTable() {
    if (_gpmSearchDebounceTimer) clearTimeout(_gpmSearchDebounceTimer);
    _gpmSearchDebounceTimer = setTimeout(() => {
        renderGpmProfilesTable();
    }, 150);
}

function renderGpmProfilesTable() {
    const tbody = document.getElementById('gpmTableBody');
    const eligibleGrid = document.getElementById('eligibleCardsGrid');
    if (!tbody) return;

    const filterGroup = document.getElementById('filterGpmGroup')?.value || 'ALL';
    const filterCampaign = document.getElementById('filterGpmCampaign')?.value || 'ALL';
    const filterCountry = (document.getElementById('filterGpmCountry')?.value || 'ALL').toUpperCase();
    const filterIp = document.getElementById('filterGpmIp')?.value || 'ALL';
    const filterBeta = document.getElementById('filterGpmBeta')?.value || 'ALL';
    const filterCreatorProgram = document.getElementById('filterGpmCreatorProgram')?.value || 'ALL';
    const filterFlop = document.getElementById('filterGpmFlop')?.value || 'ALL';
    const filter10k = document.getElementById('filterGpm10k') ? document.getElementById('filterGpm10k').value : 'all';
    const filterNotify = document.getElementById('filterGpmNotify') ? document.getElementById('filterGpmNotify').value : 'all';
    const filterNick = document.getElementById('filterGpmNick') ? document.getElementById('filterGpmNick').value : 'all';
    const filterPlatform = 'tiktok';
    const filterBrowser = 'gpm';
    const keyword = (document.getElementById('searchGpmKeyword') ? document.getElementById('searchGpmKeyword').value : '').trim().toLowerCase();

    // Single-pass combined filter (eliminates 4 intermediate array allocations)
    let list = (cachedGpmProfiles || []).filter(p => {
        // Only support TikTok platform
        if ((p.platform || 'tiktok').toLowerCase() !== 'tiktok') return false;

        // Group Filter
        if (filterGroup !== 'ALL') {
            const grp = getProfileGroupName(p).trim().toLowerCase();
            if (filterGroup === 'UNGROUPED') {
                if (grp) return false;
            } else {
                if (grp !== filterGroup.toLowerCase()) return false;
            }
        }

        // Campaign Filter
        if (filterCampaign !== 'ALL') {
            const cList = (p.campaign_names || []).concat(p.campaign_name ? [p.campaign_name] : []);
            if (filterCampaign === 'UNASSIGNED') {
                if (cList.length > 0) return false;
            } else {
                if (!cList.some(cn => (cn || '').trim().toLowerCase() === filterCampaign.toLowerCase())) return false;
            }
        }

        // Country Filter
        if (filterCountry !== 'ALL') {
            const pCountry = (p.country || '').toUpperCase();
            if (filterCountry === 'NONE') {
                if (pCountry && pCountry !== 'NONE') return false;
            } else {
                if (pCountry !== filterCountry) return false;
            }
        }

        // IP Proxy Filter
        if (filterIp && filterIp !== 'ALL') {
            const pKey = getProfileIpKey(p.raw_proxy);
            if (filterIp === 'NONE') {
                if (pKey || (p.raw_proxy && p.raw_proxy.trim() !== '') || (p.country && p.country.toUpperCase() !== 'NONE')) return false;
            } else {
                if (!pKey || (pKey !== filterIp && !(p.raw_proxy && p.raw_proxy.includes(filterIp)))) return false;
            }
        }

        // Beta Eligibility Filter
        if (filterBeta === 'ELIGIBLE' && !isProfileEligible(p)) return false;
        if (filterBeta === 'INELIGIBLE' && isProfileEligible(p)) return false;

        // Creator Program Filter (Yes / No / Specific)
        if (filterCreatorProgram !== 'ALL') {
            const cpStatus = (p.creator_program || (isProfileEligible(p) ? 'active' : 'ineligible')).toLowerCase();
            if (filterCreatorProgram === 'YES' && cpStatus !== 'active') return false;
            if (filterCreatorProgram === 'NO' && cpStatus === 'active') return false;
            if (filterCreatorProgram === 'ACTIVE' && cpStatus !== 'active') return false;
            if (filterCreatorProgram === 'NOT_ENROLLED' && cpStatus !== 'not_enrolled') return false;
            if (filterCreatorProgram === 'INELIGIBLE' && cpStatus !== 'ineligible') return false;
            if (filterCreatorProgram === 'BANNED' && cpStatus !== 'banned') return false;
        }

        // Flop / Performance Filter
        if (filterFlop !== 'ALL') {
            const fStatus = (p.flop_status || 'new').toLowerCase();
            if (filterFlop === 'GOOD' && fStatus !== 'good') return false;
            if (filterFlop === 'FLOP' && fStatus !== '0_view' && fStatus !== '200_view' && fStatus !== 'unstable') return false;
            if (filterFlop === '200_VIEW' && fStatus !== '200_view') return false;
            if (filterFlop === '0_VIEW' && fStatus !== '0_view') return false;
            if (filterFlop === 'UNSTABLE' && fStatus !== 'unstable') return false;
            if (filterFlop === 'NEW' && fStatus !== 'new') return false;
            if (filterFlop === 'BREAKOUT' && !p.is_breakout) return false;
            if (filterFlop === 'RECOVERING' && !p.flop_recovering) return false;
        }

        // 1. 10K Filter
        if (filter10k === '10k' && !isProfileEligible(p)) return false;
        if (filter10k === 'growing' && isProfileEligible(p)) return false;

        // 2. Notify Filter
        if (filterNotify === 'tracking' && (p.notify_status || 'tracking').toLowerCase() !== 'tracking') return false;
        if (filterNotify === 'sent' && (p.notify_status || '').toLowerCase() !== 'sent') return false;
        if (filterNotify === 'muted' && (p.notify_status || '').toLowerCase() !== 'muted') return false;

        // 3. Nick Attached Filter
        const hasNick = Boolean(p.tiktok_username && p.tiktok_username.trim());
        if (filterNick === 'attached' && !hasNick) return false;
        if (filterNick === 'unattached' && hasNick) return false;

        // Platform & Browser Filter
        if (filterPlatform && filterPlatform !== 'all' && (p.platform || 'tiktok').toLowerCase() !== filterPlatform.toLowerCase()) return false;
        if (filterBrowser && filterBrowser !== 'all' && (p.browser_type || 'gpm').toLowerCase() !== filterBrowser.toLowerCase()) return false;

        // 4. Keyword Filter
        if (keyword) {
            const name = (p.name || '').toLowerCase();
            const u = (p.tiktok_username || '').toLowerCase();
            const nick = (p.tiktok_nickname || '').toLowerCase();
            const proxy = (p.raw_proxy || '').toLowerCase();
            const gid = (p.gpm_id || '').toLowerCase();
            const nstat = (p.notify_status || 'tracking').toLowerCase();
            const grp = getProfileGroupName(p).toLowerCase();
            const camp = (p.campaign_name || (p.campaign_names || []).join(' ')).toLowerCase();
            if (!name.includes(keyword) && !u.includes(keyword) && !nick.includes(keyword) && !proxy.includes(keyword) && !gid.includes(keyword) && !nstat.includes(keyword) && !grp.includes(keyword) && !camp.includes(keyword)) {
                return false;
            }
        }
        return true;
    });

    // 5. Sắp xếp với cached Collator
    list.sort((a, b) => {
        let res = 0;
        if (gpmSortField === 'followers_count') {
            res = (a.followers_count || 0) - (b.followers_count || 0);
        } else if (gpmSortField === 'name') {
            res = (a.name || '').localeCompare(b.name || '', 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'group_name') {
            res = getProfileGroupName(a).localeCompare(getProfileGroupName(b), 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'total_views') {
            res = (a.total_views || 0) - (b.total_views || 0);
        } else if (gpmSortField === 'campaign_name' || gpmSortField === 'campaign') {
            res = (a.campaign_name || '').localeCompare(b.campaign_name || '', 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'tiktok_username') {
            res = (a.tiktok_username || '').localeCompare(b.tiktok_username || '', 'vi', { sensitivity: 'base' });
        } else if (gpmSortField === 'eligible_10k') {
            const ea = isProfileEligible(a) ? 1 : 0;
            const eb = isProfileEligible(b) ? 1 : 0;
            res = ea - eb;
        } else if (gpmSortField === 'creator_program') {
            const cpWeight = (p) => {
                const s = (p.creator_program || (isProfileEligible(p) ? 'active' : 'ineligible')).toLowerCase();
                if (s === 'active') return 4;
                if (s === 'not_enrolled') return 3;
                if (s === 'banned') return 2;
                if (s === 'ineligible') return 1;
                return 0;
            };
            res = cpWeight(a) - cpWeight(b);
        } else if (gpmSortField === 'flop_status') {
            const flopWeight = (p) => {
                const s = (p.flop_status || 'new').toLowerCase();
                if (s === 'good') return 5;
                if (s === 'unstable') return 4;
                if (s === 'new') return 3;
                if (s === '200_view') return 2;
                if (s === '0_view') return 1;
                return 0;
            };
            res = flopWeight(a) - flopWeight(b);
        } else if (gpmSortField === 'notify_status') {
            res = (a.notify_status || 'tracking').localeCompare(b.notify_status || 'tracking');
        } else if (gpmSortField === 'country') {
            res = (a.country || '').localeCompare(b.country || '');
        } else if (gpmSortField === 'raw_proxy' || gpmSortField === 'proxy_ip') {
            res = (a.raw_proxy || '').localeCompare(b.raw_proxy || '');
        } else if (gpmSortField === 'last_checked') {
            res = (a.last_checked || '').localeCompare(b.last_checked || '');
        }
        return gpmSortDirection === 'asc' ? res : -res;
    });

    // Cập nhật badge số lượng (Hiển thị tổng số tài khoản không giới hạn)
    const badgeCount = document.getElementById('badgeGpmCount');
    if (badgeCount) {
        if (!cachedGpmProfiles || cachedGpmProfiles.length === 0) {
            badgeCount.textContent = '0 Profile';
        } else if (list.length === cachedGpmProfiles.length) {
            badgeCount.textContent = `${cachedGpmProfiles.length.toLocaleString('vi-VN')} Profile`;
        } else {
            badgeCount.textContent = `${list.length.toLocaleString('vi-VN')} / ${cachedGpmProfiles.length.toLocaleString('vi-VN')} Profile`;
        }
    }

    // Cập nhật icon sort trên header
    ['name', 'group_name', 'tiktok_username', 'raw_proxy', 'country', 'followers_count', 'total_views', 'campaign', 'eligible_10k', 'creator_program', 'flop_status', 'last_checked'].forEach(f => {
        const th = document.getElementById(`th-gpm-${f}`);
        if (!th) return;
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        const isMatch = (f === 'campaign' && (gpmSortField === 'campaign_name' || gpmSortField === 'campaign')) || (gpmSortField === f);
        if (isMatch) {
            th.classList.add('sorted');
            icon.className = gpmSortDirection === 'asc' ? 'fa-solid fa-sort-up sort-icon active' : 'fa-solid fa-sort-down sort-icon active';
        } else {
            th.classList.remove('sorted');
            icon.className = 'fa-solid fa-sort sort-icon';
        }
    });

    // Pagination calculations
    const totalItems = list.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / gpmPageSize));
    if (gpmCurrentPage > totalPages) gpmCurrentPage = totalPages;
    if (gpmCurrentPage < 1) gpmCurrentPage = 1;

    const startIdx = (gpmCurrentPage - 1) * gpmPageSize;
    const endIdx = Math.min(startIdx + gpmPageSize, totalItems);
    const pagedList = list.slice(startIdx, endIdx);

    // Cập nhật trạng thái Multi-page selection & Bulk Action Bar
    updateBulkActionBar(list, pagedList);

    const infoEl = document.getElementById('gpmProfilesPaginationInfo');
    if (infoEl) {
        infoEl.textContent = totalItems > 0
            ? `Hiển thị ${startIdx + 1} - ${endIdx} / ${totalItems} tài khoản`
            : `0 tài khoản`;
    }
    const navEl = document.getElementById('gpmProfilesPaginationNav');
    if (navEl) {
        navEl.innerHTML = `
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToGpmProfilesPage(1)" ${gpmCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang đầu">
                <i class="fa-solid fa-angles-left"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToGpmProfilesPage(${gpmCurrentPage - 1})" ${gpmCurrentPage === 1 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang trước">
                <i class="fa-solid fa-angle-left"></i>
            </button>
            <span style="font-size: 12px; font-weight: 600; padding: 0 8px; color: var(--text-primary); white-space: nowrap;">
                Trang ${gpmCurrentPage} / ${totalPages}
            </span>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToGpmProfilesPage(${gpmCurrentPage + 1})" ${gpmCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang sau">
                <i class="fa-solid fa-angle-right"></i>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 11px;" 
                onclick="goToGpmProfilesPage(${totalPages})" ${gpmCurrentPage === totalPages ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''} title="Trang cuối">
                <i class="fa-solid fa-angles-right"></i>
            </button>
        `;
    }

    if (pagedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="14" class="text-center py-4 text-muted"><i class="fa-solid fa-folder-open" style="font-size: 24px; opacity: 0.3; display: block; margin-bottom: 8px;"></i>Không tìm thấy profile nào phù hợp với bộ lọc.</td></tr>`;
    } else {
        tbody.innerHTML = pagedList.map(p => {
            const plat = (p.platform || 'tiktok').toLowerCase();
            const channelsList = p.channels && p.channels.length > 0 ? p.channels : null;
            const hasMultiChannels = Boolean(channelsList && channelsList.length > 1);
            const isExpanded = window.expandedProfileIds && window.expandedProfileIds.has(p.gpm_id);

            // Kênh mặc định / kênh chính
            const defCh = channelsList ? (channelsList.find(c => c.is_default) || channelsList[0]) : null;

            const linkedOther = findLinkedCrossBrowserProfile(p, cachedGpmProfiles);
            let crossBrowserBadge = '';
            if (linkedOther) {
                const otherBType = (linkedOther.browser_type || 'gpm').toLowerCase();
                const otherBName = otherBType === 'genlogin' ? 'GEN' : (otherBType === 'adspower' ? 'AdsPower' : (otherBType === 'dolphin' ? 'Dolphin' : 'GPM'));
                const otherIdOrName = linkedOther.name ? linkedOther.name : (linkedOther.gpm_id ? `#${linkedOther.gpm_id}` : '');
                crossBrowserBadge = `
                    <div style="margin-top:2px;">
                        <span class="badge" style="background:rgba(234,179,8,0.14); color:#fbbf24; border:1px solid rgba(234,179,8,0.35); font-size:9px; padding:1px 5px; font-weight:600; display:inline-flex; align-items:center; gap:3px; max-width:160px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="Trùng tài khoản với ${otherBName} (${escapeHtml(otherIdOrName)})">
                            <i class="fa-solid fa-link" style="font-size:8.5px;"></i> Trùng với ${escapeHtml(otherIdOrName)}
                        </span>
                    </div>`;
            }

            let usernameDisplay = '';

            if (plat === 'youtube') {
                if (channelsList) {
                    const chToShow = defCh || channelsList[0];
                    const rawUrl = (chToShow.channel_url || '').trim();
                    let ytLink = '';
                    let ytHandle = '';

                    if (rawUrl.startsWith('http')) {
                        ytLink = rawUrl;
                        ytHandle = rawUrl.split('/').pop();
                    } else if (rawUrl.startsWith('@') && !rawUrl.includes(' ')) {
                        ytLink = `https://www.youtube.com/${rawUrl}`;
                        ytHandle = rawUrl;
                    } else if (chToShow.channel_id) {
                        ytLink = `https://www.youtube.com/channel/${chToShow.channel_id}`;
                        ytHandle = chToShow.channel_id.startsWith('UC') ? `ID: ${chToShow.channel_id}` : (rawUrl ? (rawUrl.startsWith('@') ? rawUrl : `@${rawUrl}`) : `@${chToShow.channel_name}`);
                    } else {
                        const cleanHandle = rawUrl.startsWith('@') ? rawUrl : `@${rawUrl || chToShow.channel_name}`;
                        ytLink = `https://www.youtube.com/${encodeURIComponent(cleanHandle)}`;
                        ytHandle = cleanHandle;
                    }

                    usernameDisplay = `
                        <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                <a href="${escapeHtml(ytLink)}" target="_blank" class="table-text-truncate" style="max-width:130px; color:#ef4444; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="${escapeHtml(chToShow.channel_name)} (${escapeHtml(chToShow.channel_id)})">
                                    <i class="fa-brands fa-youtube" style="color:#ef4444; flex-shrink:0;"></i>
                                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(chToShow.channel_name)}</span>
                                </a>
                                <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(chToShow.channel_url || chToShow.channel_name || '')}', ${chToShow.followers_count || p.followers_count || 0}, '${escapeHtml(p.tiktok_nickname || '')}', '${escapeHtml(p.browser_type || 'gpm')}', 'youtube', '${escapeHtml(chToShow.channel_id || '')}')" data-tooltip="Sửa nick &amp; chỉ số">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </div>
                            <div class="table-text-truncate text-muted" style="max-width:135px; font-size:11px; font-weight:500;" title="ID: ${escapeHtml(chToShow.channel_id)}">
                                <i class="fa-solid fa-id-badge" style="font-size:10px; opacity:0.7;"></i> ${escapeHtml(ytHandle)}
                            </div>
                            ${crossBrowserBadge}
                        </div>`;
                } else {
                    const rawHandle = (p.channel_handle || p.tiktok_username || '').trim();
                    let ytLink = '';
                    let cleanHandle = '';

                    if (rawHandle.startsWith('http')) {
                        ytLink = rawHandle;
                        cleanHandle = rawHandle.split('/').pop();
                    } else if (rawHandle.startsWith('@') && !rawHandle.includes(' ')) {
                        ytLink = `https://www.youtube.com/${rawHandle}`;
                        cleanHandle = rawHandle;
                    } else if (rawHandle.startsWith('UC')) {
                        ytLink = `https://www.youtube.com/channel/${rawHandle}`;
                        cleanHandle = `ID: ${rawHandle}`;
                    } else if (rawHandle) {
                        cleanHandle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
                        ytLink = `https://www.youtube.com/${encodeURIComponent(cleanHandle)}`;
                    }

                    usernameDisplay = cleanHandle ? `
                        <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                <a href="${escapeHtml(ytLink)}" target="_blank" class="table-text-truncate" style="max-width:150px; color:#ef4444; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="${escapeHtml(cleanHandle)}">
                                    <i class="fa-brands fa-youtube" style="color:#ef4444; flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(cleanHandle)}</span>
                                </a>
                                <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(cleanHandle)}', ${p.followers_count || 0}, '${escapeHtml(p.tiktok_nickname || '')}', '${escapeHtml(p.browser_type || 'gpm')}', 'youtube')" data-tooltip="Sửa nick &amp; chỉ số">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </div>
                            ${p.tiktok_nickname ? `<div class="table-text-truncate text-muted" style="max-width:165px; font-size:11.5px; font-weight:500;" title="${escapeHtml(p.tiktok_nickname)}"><i class="fa-solid fa-id-badge" style="font-size:10px; opacity:0.7;"></i> ${escapeHtml(p.tiktok_nickname)}</div>` : ''}
                            ${crossBrowserBadge}
                        </div>` : `
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="text-muted" style="font-size:12px;"><i class="fa-brands fa-youtube" style="color:#ef4444;"></i> Chưa gắn</span>
                            <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '', ${p.followers_count || 0}, '', '${escapeHtml(p.browser_type || 'gpm')}', 'youtube')" data-tooltip="Gán Kênh YouTube Cho Profile" style="width:auto; padding:0 8px; font-size:10.5px; gap:4px;">
                                <i class="fa-solid fa-plus"></i> Gán
                            </button>
                        </div>`;
                }
            } else if (plat === 'facebook') {
                if (channelsList) {
                    const pgToShow = defCh || channelsList[0];
                    const isPersonal = pgToShow.channel_id === p.tiktok_username || (pgToShow.channel_url && pgToShow.channel_url.startsWith('/profile/'));
                    const isPage = !isPersonal;
                    const fbLink = pgToShow.channel_url && pgToShow.channel_url.startsWith('http') ? pgToShow.channel_url : `https://www.facebook.com/${escapeHtml(pgToShow.channel_id)}`;
                    usernameDisplay = `
                        <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                <a href="${escapeHtml(fbLink)}" target="_blank" class="table-text-truncate" style="max-width:130px; color:#60a5fa; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="${escapeHtml(pgToShow.channel_name)} (UID: ${escapeHtml(pgToShow.channel_id)})">
                                    <i class="fa-brands fa-facebook" style="color:#1877f2; flex-shrink:0;"></i>
                                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(pgToShow.channel_name)}</span>
                                </a>
                                <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(pgToShow.channel_id || p.fb_page_id || '')}', ${pgToShow.followers_count || p.followers_count || 0}, '${escapeHtml(p.tiktok_nickname || '')}', '${escapeHtml(p.browser_type || 'gpm')}', 'facebook', '${escapeHtml(pgToShow.channel_id || '')}')" data-tooltip="Sửa nick &amp; chỉ số">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </div>
                            <div style="display:flex; align-items:center; gap:6px; font-size:11px;">
                                <span class="badge" style="background:${isPage ? 'rgba(168,85,247,0.15)' : 'rgba(148,163,184,0.15)'}; color:${isPage ? '#c084fc' : '#94a3b8'}; font-size:9px; padding:0 4px;">
                                    <i class="${isPage ? 'fa-solid fa-flag' : 'fa-solid fa-user'}"></i> ${isPage ? 'Fanpage' : 'Cá nhân'}
                                </span>
                                <span class="table-text-truncate text-muted" style="max-width:95px; font-weight:500;" title="UID: ${escapeHtml(pgToShow.channel_id)}">
                                    UID: ${escapeHtml(pgToShow.channel_id)}
                                </span>
                            </div>
                            ${crossBrowserBadge}
                        </div>`;
                } else {
                    const fbId = p.fb_page_id || p.tiktok_username || '';
                    const fbDisplay = p.tiktok_nickname || (fbId ? `FB: ${fbId}` : '');
                    usernameDisplay = fbId ? `
                        <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                            <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                <a href="https://www.facebook.com/${escapeHtml(fbId)}" target="_blank" class="table-text-truncate" style="max-width:150px; color:#60a5fa; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="FB: ${escapeHtml(fbId)}">
                                    <i class="fa-brands fa-facebook" style="color:#1877f2; flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(fbDisplay)}</span>
                                </a>
                                <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(fbId)}', ${p.followers_count || 0}, '${escapeHtml(p.tiktok_nickname || '')}', '${escapeHtml(p.browser_type || 'gpm')}', 'facebook')" data-tooltip="Sửa nick &amp; chỉ số">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </div>
                            ${p.tiktok_nickname && fbId !== p.tiktok_nickname ? `<div class="table-text-truncate text-muted" style="max-width:165px; font-size:11.5px; font-weight:500;" title="UID: ${escapeHtml(fbId)}"><i class="fa-solid fa-id-badge" style="font-size:10px; opacity:0.7;"></i> UID: ${escapeHtml(fbId)}</div>` : ''}
                            ${crossBrowserBadge}
                        </div>` : `
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="text-muted" style="font-size:12px;"><i class="fa-brands fa-facebook" style="color:#1877f2;"></i> Chưa gắn</span>
                            <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '', ${p.followers_count || 0}, '', '${escapeHtml(p.browser_type || 'gpm')}', 'facebook')" data-tooltip="Gán Page/Nick Facebook Cho Profile" style="width:auto; padding:0 8px; font-size:10.5px; gap:4px;">
                                <i class="fa-solid fa-plus"></i> Gán
                            </button>
                        </div>`;
                }
            } else {
                const hasUsername = Boolean(p.tiktok_username && p.tiktok_username.trim());
                const hasNickname = Boolean(p.tiktok_nickname && p.tiktok_nickname.trim());
                usernameDisplay = hasUsername
                    ? `<div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                        <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                            <a href="https://www.tiktok.com/@${escapeHtml(p.tiktok_username)}" target="_blank" class="table-text-truncate" style="max-width:150px; color:var(--accent-cyan); font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="@${escapeHtml(p.tiktok_username)}${p.tiktok_uid ? ' (UID: ' + escapeHtml(p.tiktok_uid) + ')' : ''}">
                                <i class="fa-brands fa-tiktok" style="flex-shrink:0;"></i> <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">@${escapeHtml(p.tiktok_username)}</span>
                            </a>
                            <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(p.tiktok_username || '')}', ${p.followers_count || 0}, '${escapeHtml(p.tiktok_nickname || '')}', '${escapeHtml(p.browser_type || 'gpm')}', 'tiktok', null, '${escapeHtml(p.country || 'US')}')" data-tooltip="Sửa nick &amp; chỉ số">
                                <i class="fa-solid fa-pen"></i>
                            </button>
                        </div>
                        ${hasNickname ? `<div class="table-text-truncate text-muted" style="max-width:165px; font-size:11.5px; font-weight:500;" title="${escapeHtml(p.tiktok_nickname)}"><i class="fa-solid fa-id-badge" style="font-size:10px; opacity:0.7;"></i> ${escapeHtml(p.tiktok_nickname)}</div>` : ''}
                       </div>`
                    : `<div style="display:flex; align-items:center; gap:6px;">
                        <span class="text-muted" style="font-size:12px;"><i class="fa-brands fa-tiktok"></i> Chưa gắn</span>
                        <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '', ${p.followers_count || 0}, '', '${escapeHtml(p.browser_type || 'gpm')}', 'tiktok')" data-tooltip="Gán Nick TikTok Cho Profile" style="width:auto; padding:0 8px; font-size:10.5px; gap:4px;">
                            <i class="fa-solid fa-plus"></i> Gán
                        </button>
                       </div>`;
            }

            let followersCount = p.followers_count || 0;
            if (defCh) {
                followersCount = defCh.followers_count || 0;
            } else if (!followersCount && channelsList) {
                followersCount = channelsList.reduce((sum, ch) => sum + (ch.followers_count || 0), 0);
            }
            const isEligible = isProfileEligible(p);
            const targetTh = getPlatformThreshold(plat);
            const subLabel = plat === 'youtube' ? 'subs' : 'followers';
            const followersDisplay = `
                <div style="white-space:nowrap;">
                    <strong style="font-size:14px; color:${isEligible ? 'var(--accent-gold)' : 'var(--accent-cyan)'};">
                        ${followersCount.toLocaleString()}
                    </strong>
                    <span style="font-size:11px; color:var(--text-muted); margin-left:2px;">${subLabel}</span>
                </div>
            `;

            const lastCheckedDisplay = p.last_checked
                ? `<div style="font-size:11.5px; color:var(--text-secondary); white-space:nowrap; display:inline-flex; align-items:center; gap:4px;" title="Lần quét gần nhất: ${escapeHtml(p.last_checked)}">
                    <i class="fa-regular fa-clock" style="font-size:10px; color:var(--accent-cyan); opacity:0.8;"></i> ${escapeHtml(p.last_checked.slice(5, 16))}
                   </div>`
                : `<span class="text-muted" style="font-size:11px; opacity:0.5;">Chưa quét</span>`;

            const thSummary = `TikTok ${formatThresholdDisplay(followerThresholds.tiktok)}, YT ${formatThresholdDisplay(followerThresholds.youtube)}, FB ${formatThresholdDisplay(followerThresholds.facebook)}`;
            const nStatus = (p.notify_status || 'tracking').toLowerCase();
            let notifyBadge = '';
            if (nStatus === 'sent') {
                notifyBadge = `<span class="badge badge-sent badge-interactive has-tooltip tooltip-top" onclick="cycleProfileNotifyStatus('${escapeHtml(p.gpm_id)}', '${nStatus}')" data-tooltip="Đã gửi Telegram khi đạt chỉ tiêu (Bấm để đổi trạng thái)"><i class="fa-solid fa-circle-check"></i> Đã gửi</span>`;
            } else if (nStatus === 'muted') {
                notifyBadge = `<span class="badge badge-muted badge-interactive has-tooltip tooltip-top" onclick="cycleProfileNotifyStatus('${escapeHtml(p.gpm_id)}', '${nStatus}')" data-tooltip="Bỏ theo dõi (không gửi Telegram). Bấm để theo dõi"><i class="fa-solid fa-bell-slash"></i> Bỏ theo dõi</span>`;
            } else {
                notifyBadge = `<span class="badge badge-tracking badge-interactive has-tooltip tooltip-top" onclick="cycleProfileNotifyStatus('${escapeHtml(p.gpm_id)}', '${nStatus}')" data-tooltip="Đang theo dõi (gửi Telegram khi đạt chỉ tiêu: ${thSummary}). Bấm để bỏ theo dõi"><i class="fa-solid fa-bell"></i> Đang theo dõi</span>`;
            }

            // Creator Program Status (TikTok Beta / Creator Rewards Program)
            const cpStatus = (p.creator_program || (isEligible ? 'active' : 'ineligible')).toLowerCase();
            let creatorProgramBadge = '';
            if (cpStatus === 'active') {
                creatorProgramBadge = `<span class="badge badge-success badge-interactive has-tooltip tooltip-top" onclick="cycleCreatorProgramStatus('${escapeHtml(p.gpm_id)}', '${cpStatus}')" data-tooltip="Đã bật chương trình Creator Rewards (Bấm để đổi trạng thái)"><i class="fa-solid fa-circle-check"></i> Đã Bật</span>`;
            } else if (cpStatus === 'banned') {
                creatorProgramBadge = `<span class="badge badge-banned badge-interactive has-tooltip tooltip-top" onclick="cycleCreatorProgramStatus('${escapeHtml(p.gpm_id)}', '${cpStatus}')" data-tooltip="Bị ngừng chương trình TikTok Beta (Bấm để đổi trạng thái)"><i class="fa-solid fa-triangle-exclamation"></i> Bị Ngừng</span>`;
            } else if (cpStatus === 'not_enrolled') {
                creatorProgramBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleCreatorProgramStatus('${escapeHtml(p.gpm_id)}', '${cpStatus}')" style="background:rgba(234,179,8,0.15); color:#facc15; border:1px solid rgba(234,179,8,0.3); font-weight:700;" data-tooltip="Đủ 10K followers nhưng chưa tham gia Creator Rewards (Bấm để đổi)"><i class="fa-solid fa-circle-pause"></i> Chưa Bật</span>`;
            } else if (cpStatus === 'ineligible') {
                creatorProgramBadge = `<span class="badge has-tooltip tooltip-top" onclick="cycleCreatorProgramStatus('${escapeHtml(p.gpm_id)}', '${cpStatus}')" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25); cursor:pointer;" data-tooltip="Chưa đủ điều kiện tham gia (&lt; 10,000 followers)"><i class="fa-solid fa-minus"></i> Chưa Đủ ĐK</span>`;
            } else {
                creatorProgramBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleCreatorProgramStatus('${escapeHtml(p.gpm_id)}', '${cpStatus}')" style="background:rgba(100,116,139,0.12); color:#64748b; border:1px solid rgba(100,116,139,0.2);" data-tooltip="Chưa quét trạng thái Creator Program (Bấm để đổi)"><i class="fa-regular fa-circle-question"></i> Chưa Quét</span>`;
            }

            // Tình Trạng Kênh (Hiệu Suất / Flop Status)
            const fStatus = (p.flop_status || 'new').toLowerCase();
            const totPosts = p.total_posts || 0;
            const avgViews = p.avg_views || 0;
            const maxViews = p.max_views || 0;
            const medViews = p.flop_median_views || 0;
            const windowViews = Array.isArray(p.flop_window_views) ? p.flop_window_views : [];
            const windowViewsStr = windowViews.length > 0
                ? `Cửa sổ 72h (${windowViews.length} clip): [${windowViews.map(v => Number(v).toLocaleString() + 'v').join(', ')}] | Trung vị: ${medViews.toLocaleString()}v`
                : 'Chưa có đủ clip đã qua 24h';
            const postStatsHint = `${windowViewsStr} | Trọn đời: ${totPosts} clip (Max: ${maxViews.toLocaleString()}v, TB: ${avgViews.toLocaleString()}v)${p.flop_since ? ` | Từ: ${p.flop_since}` : ''}`;

            let flopBadge = '';
            if (fStatus === '0_view') {
                flopBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleFlopStatus('${escapeHtml(p.gpm_id)}', '${fStatus}')" style="background:rgba(239,68,68,0.18); color:#ef4444; border:1px solid rgba(239,68,68,0.35); font-weight:700;" data-tooltip="🚨 0-View Flop (${escapeHtml(postStatsHint)}). Nghi ngờ Shadowban/IP bẩn. Bấm để đổi"><i class="fa-solid fa-triangle-exclamation"></i> 0-View Flop</span>`;
            } else if (fStatus === '200_view') {
                flopBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleFlopStatus('${escapeHtml(p.gpm_id)}', '${fStatus}')" style="background:rgba(245,158,11,0.18); color:#f59e0b; border:1px solid rgba(245,158,11,0.35); font-weight:700;" data-tooltip="⚠️ Kẹt 200 View (${escapeHtml(postStatsHint)}). Cần đổi công thức Hook/Split-screen. Bấm để đổi"><i class="fa-solid fa-circle-exclamation"></i> Kẹt 200v</span>`;
            } else if (fStatus === 'unstable') {
                flopBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleFlopStatus('${escapeHtml(p.gpm_id)}', '${fStatus}')" style="background:rgba(234,179,8,0.18); color:#eab308; border:1px solid rgba(234,179,8,0.35); font-weight:700;" data-tooltip="⚡ Không Ổn Định (${escapeHtml(postStatsHint)}). Lượt view chênh lệch cao hoặc tỷ lệ 0-view cao. Bấm để đổi"><i class="fa-solid fa-chart-line"></i> Không Ổn Định</span>`;
            } else if (fStatus === 'good') {
                flopBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleFlopStatus('${escapeHtml(p.gpm_id)}', '${fStatus}')" style="background:rgba(34,197,94,0.18); color:#22c55e; border:1px solid rgba(34,197,94,0.35); font-weight:700;" data-tooltip="🚀 Phát Triển Tốt (${escapeHtml(postStatsHint)}). View/Follower tăng trưởng tốt. Bấm để đổi"><i class="fa-solid fa-rocket"></i> Khỏe / Lên</span>`;
            } else {
                flopBadge = `<span class="badge badge-interactive has-tooltip tooltip-top" onclick="cycleFlopStatus('${escapeHtml(p.gpm_id)}', '${fStatus}')" style="background:rgba(148,163,184,0.12); color:#94a3b8; border:1px solid rgba(148,163,184,0.25);" data-tooltip="🌱 Đang Nuôi (${escapeHtml(postStatsHint)}). Chưa đủ dữ liệu clip. Bấm để đổi"><i class="fa-solid fa-seedling"></i> Đang Nuôi</span>`;
            }

            if (p.is_breakout) {
                flopBadge += ` <span class="badge has-tooltip tooltip-top" style="background:rgba(236,72,153,0.18); color:#f472b6; border:1px solid rgba(236,72,153,0.35); font-size:10px; padding:2px 5px;" data-tooltip="⚡ Breakout: Có video mới đăng bứt phá đạt ≥ 1,000 views!"><i class="fa-solid fa-bolt"></i> Breakout</span>`;
            }
            if (p.flop_recovering) {
                flopBadge += ` <span class="badge has-tooltip tooltip-top" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid rgba(245,158,11,0.3); font-size:10px; padding:2px 5px;" data-tooltip="🔄 Đang Hồi Phục: Cần 2 clip liên tiếp > 300v để thoát trạng thái Flop"><i class="fa-solid fa-arrows-rotate"></i> Hồi Phục</span>`;
            }

            const grpName = getProfileGroupName(p);
            const groupDisplay = grpName
                ? `<span class="badge" style="background:rgba(99,102,241,0.14); color:#818cf8; border:1px solid rgba(99,102,241,0.28); font-size:11px; font-weight:600; padding:2px 7px; border-radius:6px; max-width:130px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${escapeHtml(grpName)}"><i class="fa-solid fa-users-rectangle" style="font-size:9.5px; margin-right:3px;"></i>${escapeHtml(grpName)}</span>`
                : `<span class="text-muted" style="font-size:11px; opacity:0.6;">—</span>`;

            const totViews = Number(p.total_views) || 0;
            const viewsDisplay = `
                <div>
                    <strong style="font-size:13.5px; color:#38bdf8;">
                        <i class="fa-solid fa-eye" style="font-size:10.5px; opacity:0.8; margin-right:3px;"></i>${totViews.toLocaleString('vi-VN')}
                    </strong>
                    <span style="font-size:10.5px; color:var(--text-muted); margin-left:1px;">views</span>
                </div>`;

            const cNames = p.campaign_names && p.campaign_names.length > 0 ? p.campaign_names : (p.campaign_name ? [p.campaign_name] : []);
            const campaignDisplay = cNames.length > 0
                ? `<div style="display:flex; flex-direction:column; gap:2px; max-width:140px;">
                    ${cNames.map(cn => `
                        <span class="badge" style="background:rgba(236,72,153,0.14); color:#f472b6; border:1px solid rgba(236,72,153,0.28); font-size:11px; font-weight:600; padding:2px 7px; border-radius:6px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block;" title="${escapeHtml(cn)}">
                            <i class="fa-solid fa-bullhorn" style="font-size:9.5px; margin-right:3px;"></i>${escapeHtml(cn)}
                        </span>
                    `).join('')}
                  </div>`
                : `<span class="text-muted" style="font-size:11px; opacity:0.6;">Chưa gán</span>`;

            const mainRowHtml = `
            <tr>
                <td style="width: 44px; min-width: 44px; max-width: 44px; text-align: center; vertical-align: middle; padding: 10px 4px;">
                    <input type="checkbox" class="gpm-profile-checkbox" data-gpm-id="${escapeHtml(p.gpm_id)}"
                        ${selectedProfileIds.has(p.gpm_id) ? 'checked' : ''}
                        onchange="toggleSelectProfile('${escapeHtml(p.gpm_id)}', this.checked)"
                        style="cursor:pointer; width:16px; height:16px; accent-color: var(--accent-cyan, #38bdf8); vertical-align: middle;">
                </td>
                <td>
                    <div class="table-text-truncate" style="max-width: 220px; display:flex; align-items:center; gap:6px;" title="${escapeHtml(p.name)}">
                        ${hasMultiChannels ? `
                        <button type="button" class="btn-subchannel-toggle ${isExpanded ? 'expanded' : ''}" id="btn-toggle-${escapeHtml(p.gpm_id)}" data-gpm-id="${escapeHtml(p.gpm_id)}" onclick="toggleSubChannels('${escapeHtml(p.gpm_id)}', event)" title="Bấm để ẩn/hiện ${channelsList.length} kênh/trang con">
                            <i class="fa-solid fa-chevron-right" id="chevron-${escapeHtml(p.gpm_id)}"></i>
                        </button>` : `<span style="display:inline-block; width:20px;"></span>`}
                        ${(() => {
                    const b = (p.browser_type || 'gpm').toLowerCase();
                    if (b === 'adspower') return '<span class="badge" style="background:rgba(249,115,22,0.15); color:#fb923c; font-size:10px;"><i class="fa-solid fa-bolt"></i> AdsPower</span>';
                    if (b === 'dolphin') return '<span class="badge" style="background:rgba(6,182,212,0.15); color:#22d3ee; font-size:10px;"><i class="fa-solid fa-water"></i> Dolphin</span>';
                    if (b === 'genlogin') return '<span class="badge" style="background:rgba(34,197,94,0.15); color:#4ade80; font-size:10px;"><i class="fa-solid fa-shield"></i> GEN</span>';
                    return '<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; font-size:10px;"><i class="fa-solid fa-cube"></i> GPM</span>';
                })()}
                        <strong class="profile-name-link has-tooltip tooltip-top" onclick="openProfileDetailModal('${escapeHtml(p.gpm_id)}')" data-tooltip="Bấm để xem chi tiết profile" style="cursor:pointer; color:var(--text-primary); transition:color 0.15s ease;">${escapeHtml(p.name)}</strong>
                        ${hasMultiChannels ? `
                        <span class="badge" style="background:rgba(99,102,241,0.18); color:#a5b4fc; font-size:9.5px; padding:1px 6px; font-weight:600; cursor:pointer;" onclick="toggleSubChannels('${escapeHtml(p.gpm_id)}', event)" title="Có ${channelsList.length} kênh/trang con (Bấm để xem)">
                            <i class="fa-solid fa-layer-group"></i> ${channelsList.length}
                        </span>` : ''}
                    </div>
                </td>
                <td>${groupDisplay}</td>
                <td>${usernameDisplay}</td>
                <td>
                    ${(() => {
                    const curIpKey = getProfileIpKey(p.raw_proxy);
                    const hasProxy = Boolean(curIpKey);
                    const selBg = hasProxy ? 'rgba(56, 189, 248, 0.12)' : 'rgba(100, 116, 139, 0.15)';
                    const selBorder = hasProxy ? 'rgba(56, 189, 248, 0.4)' : 'rgba(148, 163, 184, 0.35)';
                    const selColor = hasProxy ? '#38bdf8' : '#94a3b8';

                    let poolOpts = '';
                    let matched = false;
                    (cachedProxyPool || []).forEach(item => {
                        const isSel = curIpKey && (curIpKey === item.key || (p.raw_proxy && p.raw_proxy.includes(item.key)));
                        if (isSel) matched = true;
                        const blockedBadge = item.status === 'blocked' ? ' [Bị Chặn]' : '';
                        poolOpts += `<option value="${escapeHtml(item.key)}" ${isSel ? 'selected' : ''} style="background:#1e293b; color:${item.status === 'blocked' ? '#f87171' : '#fff'};">
                            [${item.country}] ${escapeHtml(item.key)}${blockedBadge}
                        </option>`;
                    });

                    let customOpt = '';
                    if (curIpKey && !matched) {
                        customOpt = `<option value="${escapeHtml(curIpKey)}" selected style="background:#1e293b; color:#fbbf24;">⚡ ${escapeHtml(curIpKey)} (Tùy Chỉnh)</option>`;
                    }

                    return `
                    <div style="display:flex; flex-direction:column; width:100%; max-width:180px; min-width:155px;">
                        <select class="custom-select proxy-cell-select"
                            id="cellProxyIp_${escapeHtml(p.gpm_id)}"
                            onchange="onTableIpChange('${escapeHtml(p.gpm_id)}', this.value)"
                            title="Chọn IP Proxy gán cho profile này"
                            style="height:28px; font-size:11.5px; font-weight:700; padding:2px 6px; border-radius:6px; background:${selBg}; border:1px solid ${selBorder}; color:${selColor}; cursor:pointer; width:100%; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
                            <option value="" ${!hasProxy ? 'selected' : ''} style="background:#1e293b; color:#94a3b8;">🌐 Direct (Không Proxy)</option>
                            ${customOpt}
                            ${poolOpts}
                        </select>
                    </div>`;
                })()}
                </td>
                <td>
                    ${(() => {
                    const cCode = (p.country && p.country.toUpperCase() !== 'NONE') ? p.country.toUpperCase() : 'NONE';
                    const isNone = cCode === 'NONE';
                    let cName = 'Direct IP';
                    if (!isNone) {
                        const foundC = (cachedProxyCountries || []).find(c => c.code === cCode);
                        if (foundC) {
                            cName = foundC.name || cCode;
                        } else {
                            cName = cCode === 'ID' ? 'Indonesia' : (cCode === 'MX' ? 'Mexico' : cCode);
                        }
                    }
                    const badgeBg = isNone ? 'rgba(100, 116, 139, 0.12)' : 'rgba(56, 189, 248, 0.12)';
                    const badgeBorder = isNone ? 'rgba(148, 163, 184, 0.25)' : 'rgba(56, 189, 248, 0.35)';
                    const badgeColor = isNone ? '#94a3b8' : '#38bdf8';
                    const badgeText = isNone ? '🌐 Direct' : `[${cCode}] ${cName}`;

                    return `
                    <div style="display:flex; align-items:center; min-width:125px;">
                        <span class="badge country-cell-badge" id="cellCountry_${escapeHtml(p.gpm_id)}"
                            title="Quốc gia của profile (Tự động cập nhật theo IP đã chọn)"
                            style="font-size:11.5px; font-weight:700; padding:4px 8px; border-radius:6px; background:${badgeBg}; border:1px solid ${badgeBorder}; color:${badgeColor}; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;">
                            ${badgeText}
                        </span>
                    </div>`;
                })()}
                </td>
                <td>${followersDisplay}</td>
                <td>${viewsDisplay}</td>
                <td>${campaignDisplay}</td>
                <td>
                    ${(() => {
                    const pStatus = (p.status || 'active').toLowerCase();
                    const pReason = p.status_reason ? escapeHtml(p.status_reason) : '';
                    if (pStatus === 'banned') {
                        return `<span class="badge badge-banned has-tooltip tooltip-top" data-tooltip="${pReason || 'Tài khoản bị cấm vĩnh viễn'}"><i class="fa-solid fa-ban"></i> BANNED</span>`;
                    } else if (pStatus === 'restricted') {
                        return `<span class="badge badge-restricted has-tooltip tooltip-top" data-tooltip="${pReason || 'Tài khoản bị hạn chế đăng bài'}"><i class="fa-solid fa-triangle-exclamation"></i> HẠN CHẾ</span>`;
                    } else if (pStatus === 'checkpoint') {
                        return `<span class="badge badge-checkpoint has-tooltip tooltip-top" data-tooltip="${pReason || 'Yêu cầu giải Captcha'}"><i class="fa-solid fa-puzzle-piece"></i> CAPTCHA</span>`;
                    } else if (pStatus === 'unlogged') {
                        return `<span class="badge badge-unlogged has-tooltip tooltip-top" data-tooltip="${pReason || 'Chưa đăng nhập / hết phiên'}"><i class="fa-solid fa-right-to-bracket"></i> HẾT PHIÊN</span>`;
                    } else if (pStatus === 'proxy_dead') {
                        return `<span class="badge badge-proxy-dead has-tooltip tooltip-top" data-tooltip="${pReason || 'Proxy chết / lỗi kết nối'}"><i class="fa-solid fa-network-wired"></i> PROXY LỖI</span>`;
                    } else if (isEligible) {
                        if (plat === 'youtube') {
                            return `<span class="badge badge-success" style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-trophy"></i> ĐỦ ${formatThresholdDisplay(targetTh)} SUBS!</span>`;
                        } else if (plat === 'facebook') {
                            return `<span class="badge badge-success" style="background:rgba(24,119,242,0.18); color:#60a5fa; border:1px solid rgba(24,119,242,0.3);"><i class="fa-solid fa-trophy"></i> ĐỦ ${formatThresholdDisplay(targetTh)} FLW!</span>`;
                        } else {
                            return `<span class="badge badge-success"><i class="fa-solid fa-trophy"></i> ĐỦ ${formatThresholdDisplay(targetTh)} BETA!</span>`;
                        }
                    } else {
                        return '<span class="badge badge-info"><i class="fa-solid fa-seedling"></i> Đang Nuôi</span>';
                    }
                })()}
                </td>
                <td>${creatorProgramBadge}</td>
                <td>${flopBadge}</td>
                <td>${lastCheckedDisplay}</td>
                <td style="text-align: center;">
                    <div class="action-dropdown-wrap">
                        <button type="button" class="btn-more-actions" id="btn-more-gpm-${escapeHtml(p.gpm_id)}" 
                            onclick="toggleActionMenu(event, 'gpm-${escapeHtml(p.gpm_id)}')" 
                            title="Tùy chọn thao tác">
                            <i class="fa-solid fa-ellipsis"></i>
                        </button>
                        <div class="action-dropdown-menu" id="action-menu-gpm-${escapeHtml(p.gpm_id)}">
                            <button type="button" class="action-dropdown-item" onclick="openProfileDetailModal('${escapeHtml(p.gpm_id)}'); closeAllActionMenus();">
                                <i class="fa-solid fa-id-card" style="color:#38bdf8;"></i> Xem chi tiết Profile
                            </button>
                            <button type="button" class="action-dropdown-item" onclick="scanSingleProfileFollowers('${escapeHtml(p.gpm_id)}', this); closeAllActionMenus();">
                                <i class="fa-solid fa-magnifying-glass-chart" style="color:var(--accent-pink);"></i> Quét Follower ngay
                            </button>
                            <button type="button" class="action-dropdown-item" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(p.tiktok_username || '')}', ${followersCount}, '${escapeHtml(p.tiktok_nickname || '')}', '${escapeHtml(p.browser_type || 'gpm')}', '${escapeHtml(plat)}', null, '${escapeHtml((p.country && p.country.toUpperCase() !== 'NONE') ? p.country.toUpperCase() : 'NONE')}'); closeAllActionMenus();">
                                <i class="fa-solid fa-pen-to-square" style="color:var(--accent-cyan);"></i> Sửa Nick & Chỉ số
                            </button>
                            <button type="button" class="action-dropdown-item" id="btnActionVpn_${escapeHtml(p.gpm_id)}" onclick="onTableIpChange('${escapeHtml(p.gpm_id)}', document.getElementById('cellProxyIp_${escapeHtml(p.gpm_id)}') ? document.getElementById('cellProxyIp_${escapeHtml(p.gpm_id)}').value : ''); closeAllActionMenus();">
                                <i class="fa-solid fa-shield-halved" style="color:#38bdf8;"></i> Đồng bộ Proxy
                            </button>
                            ${plat === 'youtube' ? (() => {
                    const ytTarget = defCh || p;
                    const rawYt = (ytTarget.channel_url || p.channel_handle || '').trim();
                    let mainYtLink = 'https://www.youtube.com';
                    if (rawYt.startsWith('http')) mainYtLink = rawYt;
                    else if (rawYt.startsWith('@') && !rawYt.includes(' ')) mainYtLink = `https://www.youtube.com/${rawYt}`;
                    else if (ytTarget.channel_id) mainYtLink = `https://www.youtube.com/channel/${ytTarget.channel_id}`;
                    else if (p.tiktok_username && p.tiktok_username.startsWith('UC')) mainYtLink = `https://www.youtube.com/channel/${p.tiktok_username}`;
                    return `
                                <a href="${escapeHtml(mainYtLink)}" target="_blank" rel="noopener" class="action-dropdown-item" onclick="closeAllActionMenus()">
                                    <i class="fa-brands fa-youtube" style="color:#ef4444;"></i> Mở kênh chính YouTube
                                </a>`;
                })() : plat === 'facebook' ? `
                            <a href="https://www.facebook.com/${escapeHtml(p.fb_page_id || (defCh && defCh.channel_id) || p.tiktok_username || '')}" target="_blank" rel="noopener" class="action-dropdown-item" onclick="closeAllActionMenus()">
                                <i class="fa-brands fa-facebook" style="color:#1877f2;"></i> Mở trang Facebook
                            </a>` : (p.tiktok_username ? `
                            <a href="https://www.tiktok.com/@${escapeHtml(p.tiktok_username)}" target="_blank" rel="noopener" class="action-dropdown-item" onclick="closeAllActionMenus()">
                                <i class="fa-brands fa-tiktok" style="color:#00f2fe;"></i> Mở kênh TikTok
                            </a>` : '')}
                            ${plat === 'youtube' || plat === 'facebook' ? `
                            <button type="button" class="action-dropdown-item" onclick="syncProfileChannels('${escapeHtml(p.gpm_id)}'); closeAllActionMenus();">
                                <i class="fa-solid fa-layer-group" style="color:#a78bfa;"></i> Quét Kênh / Trang Con
                            </button>` : ''}
                            <button type="button" class="action-dropdown-item" onclick="copyTextToClipboard('${escapeHtml(p.tiktok_username || p.gpm_id)}', 'Đã sao chép!'); closeAllActionMenus();">
                                <i class="fa-solid fa-copy" style="color:#94a3b8;"></i> Sao chép ${p.tiktok_username ? 'Username' : 'GPM ID'}
                            </button>
                            <div class="dropdown-divider"></div>
                            <button type="button" class="action-dropdown-item text-danger" onclick="deleteGpmProfileFromList('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}'); closeAllActionMenus();">
                                <i class="fa-solid fa-trash text-danger"></i> Xóa Profile
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
            `;

            let subRowsHtml = '';
            if (hasMultiChannels) {
                subRowsHtml = channelsList.map(ch => {
                    const chEligible = isChannelEligible(ch, plat);
                    const chTh = getPlatformThreshold(plat);
                    let chNameHtml = '';
                    let chTypeBadge = '';
                    let chLink = '';

                    if (plat === 'youtube') {
                        const rawChUrl = (ch.channel_url || '').trim();
                        let subChLink = '';
                        let subChHandle = '';
                        if (rawChUrl.startsWith('http')) {
                            subChLink = rawChUrl;
                            subChHandle = rawChUrl.split('/').pop();
                        } else if (rawChUrl.startsWith('@') && !rawChUrl.includes(' ')) {
                            subChLink = `https://www.youtube.com/${rawChUrl}`;
                            subChHandle = rawChUrl;
                        } else if (ch.channel_id) {
                            subChLink = `https://www.youtube.com/channel/${ch.channel_id}`;
                            subChHandle = ch.channel_id.startsWith('UC') ? `ID: ${ch.channel_id}` : (rawChUrl ? (rawChUrl.startsWith('@') ? rawChUrl : `@${rawChUrl}`) : `@${ch.channel_name}`);
                        } else {
                            const cleanHandle = rawChUrl.startsWith('@') ? rawChUrl : `@${rawChUrl || ch.channel_name}`;
                            subChLink = `https://www.youtube.com/${encodeURIComponent(cleanHandle)}`;
                            subChHandle = cleanHandle;
                        }
                        chLink = subChLink;
                        chTypeBadge = `<span class="badge" style="background:rgba(239,68,68,0.1); color:#f87171; font-size:9.5px; padding:2px 6px;"><i class="fa-brands fa-youtube"></i> Channel</span>`;
                        chNameHtml = `
                            <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                                <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                    <a href="${escapeHtml(chLink)}" target="_blank" class="table-text-truncate" style="max-width:130px; color:#ef4444; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="${escapeHtml(ch.channel_name)} (${escapeHtml(ch.channel_id)})">
                                        <i class="fa-brands fa-youtube" style="color:#ef4444; flex-shrink:0;"></i>
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ch.channel_name)}</span>
                                    </a>
                                    <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(ch.channel_url || ch.channel_name || '')}', ${ch.followers_count || 0}, '', '${escapeHtml(p.browser_type || 'gpm')}', 'youtube', '${escapeHtml(ch.channel_id)}')" data-tooltip="Sửa nick &amp; chỉ số">
                                        <i class="fa-solid fa-pen"></i>
                                    </button>
                                </div>
                                <span class="table-text-truncate text-muted" style="max-width:135px; font-size:10.5px;" title="ID: ${escapeHtml(ch.channel_id)}">
                                    <i class="fa-solid fa-id-badge" style="font-size:9.5px; opacity:0.7;"></i> ${escapeHtml(subChHandle)}
                                </span>
                                ${(() => {
                                const subKey = getCanonicalAccountKey(p, ch);
                                const subOther = cachedGpmProfiles.find(o => o.id !== p.id && (o.platform || 'tiktok').toLowerCase() === plat && getCanonicalAccountKey(o, ch) === subKey);
                                if (!subOther) return '';
                                return `<span class="badge" style="background:rgba(234,179,8,0.14); color:#fbbf24; border:1px solid rgba(234,179,8,0.35); font-size:8.5px; padding:1px 5px; font-weight:600; margin-top:2px; display:inline-flex; align-items:center; gap:3px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="Trùng với ${escapeHtml(subOther.name || subOther.gpm_id)}"><i class="fa-solid fa-link" style="font-size:8px;"></i> Trùng với ${escapeHtml(subOther.name || subOther.gpm_id)}</span>`;
                            })()}
                            </div>
                        `;
                    } else {
                        const isPersonal = ch.channel_id === p.tiktok_username || (ch.channel_url && ch.channel_url.startsWith('/profile/'));
                        const isPage = !isPersonal;
                        chLink = ch.channel_url && ch.channel_url.startsWith('http') ? ch.channel_url : `https://www.facebook.com/${escapeHtml(ch.channel_id)}`;
                        chTypeBadge = `<span class="badge" style="background:${isPage ? 'rgba(168,85,247,0.15)' : 'rgba(148,163,184,0.15)'}; color:${isPage ? '#c084fc' : '#94a3b8'}; font-size:9.5px; padding:2px 6px;"><i class="${isPage ? 'fa-solid fa-flag' : 'fa-solid fa-user'}"></i> ${isPage ? 'Fanpage' : 'Cá nhân'}</span>`;
                        chNameHtml = `
                            <div style="display:flex; flex-direction:column; gap:2px; min-width:0;">
                                <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                                    <a href="${chLink}" target="_blank" class="table-text-truncate" style="max-width:130px; color:#60a5fa; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:4px;" title="${escapeHtml(ch.channel_name)} (UID: ${escapeHtml(ch.channel_id)})">
                                        <i class="fa-brands fa-facebook" style="color:#1877f2; flex-shrink:0;"></i>
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(ch.channel_name)}</span>
                                    </a>
                                    <button type="button" class="btn-inline-edit has-tooltip tooltip-top" onclick="openEditUsernameModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(ch.channel_id || '')}', ${ch.followers_count || 0}, '', '${escapeHtml(p.browser_type || 'gpm')}', 'facebook', '${escapeHtml(ch.channel_id)}')" data-tooltip="Sửa nick &amp; chỉ số">
                                        <i class="fa-solid fa-pen"></i>
                                    </button>
                                </div>
                                <span class="table-text-truncate text-muted" style="max-width:135px; font-size:10.5px;" title="UID: ${escapeHtml(ch.channel_id)}">
                                    UID: ${escapeHtml(ch.channel_id)}
                                </span>
                                ${(() => {
                                const subKey = getCanonicalAccountKey(p, ch);
                                const subOther = cachedGpmProfiles.find(o => o.id !== p.id && (o.platform || 'tiktok').toLowerCase() === plat && getCanonicalAccountKey(o, ch) === subKey);
                                if (!subOther) return '';
                                return `<span class="badge" style="background:rgba(234,179,8,0.14); color:#fbbf24; border:1px solid rgba(234,179,8,0.35); font-size:8.5px; padding:1px 5px; font-weight:600; margin-top:2px; display:inline-flex; align-items:center; gap:3px; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="Trùng với ${escapeHtml(subOther.name || subOther.gpm_id)}"><i class="fa-solid fa-link" style="font-size:8px;"></i> Trùng với ${escapeHtml(subOther.name || subOther.gpm_id)}</span>`;
                            })()}
                            </div>
                        `;
                    }

                    const chNotifyStatus = (ch.notify_status || (ch.is_default ? p.notify_status : 'tracking') || 'tracking').toLowerCase();
                    let chNotifyBadge = '';
                    if (chNotifyStatus === 'sent') {
                        chNotifyBadge = `<span class="badge badge-success has-tooltip tooltip-top" onclick="cycleChannelNotifyStatus('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}', '${chNotifyStatus}')" data-tooltip="Đã đạt chỉ tiêu. Bấm để theo dõi lại." style="cursor:pointer;"><i class="fa-solid fa-circle-check"></i> Đạt chỉ tiêu</span>`;
                    } else if (chNotifyStatus === 'muted') {
                        chNotifyBadge = `<span class="badge badge-secondary has-tooltip tooltip-top" onclick="cycleChannelNotifyStatus('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}', '${chNotifyStatus}')" data-tooltip="Đang tắt thông báo. Bấm để bật theo dõi." style="cursor:pointer; opacity:0.6;"><i class="fa-solid fa-bell-slash"></i> Đã tắt</span>`;
                    } else {
                        chNotifyBadge = `<span class="badge badge-warning has-tooltip tooltip-top" onclick="cycleChannelNotifyStatus('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}', '${chNotifyStatus}')" data-tooltip="Đang theo dõi tăng trưởng. Bấm để tắt." style="cursor:pointer;"><i class="fa-solid fa-bell"></i> Đang theo dõi</span>`;
                    }

                    const safeChId = escapeHtml(ch.channel_id).replace(/[^a-zA-Z0-9_-]/g, '_');
                    const chMenuKey = `ch-${escapeHtml(p.gpm_id)}-${safeChId}`;

                    return `
                    <tr class="sub-channel-row sub-row-${escapeHtml(p.gpm_id)} ${plat === 'youtube' ? 'youtube-channel' : 'facebook-page'}" style="${isExpanded ? '' : 'display:none;'}">
                        <td></td>
                        <td style="padding-left: 26px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <i class="fa-solid fa-turn-up fa-rotate-90" style="color:var(--text-muted); opacity:0.6; font-size:11px;"></i>
                                <span style="font-size:11.5px; font-weight:600; color:${ch.is_default ? 'var(--accent-gold)' : 'var(--text-secondary)'};">
                                    ${ch.is_default ? '<i class="fa-solid fa-star" style="font-size:10px; margin-right:3px;"></i> Kênh chính' : '<i class="fa-solid fa-code-branch" style="font-size:10px; margin-right:3px; opacity:0.7;"></i> Kênh con'}
                                </span>
                            </div>
                        </td>
                        <td style="color:var(--text-muted); font-size:11px; opacity:0.6;">—</td>
                        <td>
                            <div style="display:flex; align-items:center; gap:6px;">
                                ${chTypeBadge}
                                ${chNameHtml}
                            </div>
                        </td>
                        <td style="color:var(--text-muted); font-size:11.5px; opacity:0.7;"><i class="fa-solid fa-arrow-turn-up fa-rotate-90"></i> Cùng nick</td>
                        <td style="color:var(--text-muted); font-size:11.5px; opacity:0.7;">Cùng nick</td>
                        <td>
                            <div>
                                <strong style="font-size:13.5px; color:${chEligible ? 'var(--accent-gold)' : 'var(--accent-cyan)'};">
                                    ${(ch.followers_count || 0).toLocaleString()}
                                </strong>
                                <span style="font-size:10.5px; color:var(--text-muted); margin-left:2px;">${subLabel}</span>
                            </div>
                        </td>
                        <td style="text-align: center; color: var(--text-muted); font-size: 11px; opacity: 0.6;">—</td>
                        <td style="text-align: center; color: var(--text-muted); font-size: 11px; opacity: 0.6;">—</td>
                        <td>
                            ${chEligible ? (
                            plat === 'youtube'
                                ? `<span class="badge badge-success" style="font-size:10px; background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.3);"><i class="fa-solid fa-trophy"></i> ĐỦ ${formatThresholdDisplay(chTh)} SUBS!</span>`
                                : `<span class="badge badge-success" style="font-size:10px; background:rgba(24,119,242,0.18); color:#60a5fa; border:1px solid rgba(24,119,242,0.3);"><i class="fa-solid fa-trophy"></i> ĐỦ ${formatThresholdDisplay(chTh)} FLW!</span>`
                        ) : '<span class="badge badge-info" style="font-size:10px;"><i class="fa-solid fa-seedling"></i> Đang Nuôi</span>'}
                        </td>
                        <td style="text-align: center; color: var(--text-muted); font-size: 11px; opacity: 0.6;">—</td>
                        <td style="text-align: center; color: var(--text-muted); font-size: 11px; opacity: 0.6;">—</td>
                        <td style="text-align: center; color: var(--text-muted); font-size: 11px; opacity: 0.6;">—</td>
                        <td style="text-align: center;">
                            <div class="action-dropdown-wrap">
                                <button type="button" class="btn-more-actions" id="btn-more-${chMenuKey}" 
                                    onclick="toggleActionMenu(event, '${chMenuKey}')" 
                                    title="Tùy chọn thao tác">
                                    <i class="fa-solid fa-ellipsis"></i>
                                </button>
                                <div class="action-dropdown-menu" id="action-menu-${chMenuKey}">
                                    ${!ch.is_default ? `
                                    <button type="button" class="action-dropdown-item" onclick="setDefaultChannel('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}'); closeAllActionMenus();">
                                        <i class="fa-solid fa-star" style="color:var(--accent-gold);"></i> ${plat === 'youtube' ? 'Đặt làm Kênh YouTube chính' : 'Đặt làm Fanpage chính'}
                                    </button>` : `
                                    <button type="button" class="action-dropdown-item" style="opacity:0.65; cursor:default;" disabled>
                                        <i class="fa-solid fa-star" style="color:var(--accent-gold);"></i> ${plat === 'youtube' ? 'Kênh chính (Mặc định)' : 'Trang chính (Mặc định)'}
                                    </button>`}
                                    <button type="button" class="action-dropdown-item" onclick="scanSingleChannelFollowers('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}', '${plat}', this); closeAllActionMenus();">
                                        <i class="fa-solid fa-magnifying-glass-chart" style="color:var(--accent-pink);"></i> ${plat === 'youtube' ? 'Quét Subscribers ngay' : 'Quét Followers ngay'}
                                    </button>
                                    <button type="button" class="action-dropdown-item" onclick="openEditChannelModal('${escapeHtml(p.gpm_id)}', '${escapeHtml(p.name)}', '${escapeHtml(ch.channel_id)}', '${escapeHtml(ch.channel_name || '')}', ${ch.followers_count || 0}, '${escapeHtml(ch.channel_url || ch.channel_id)}', '${plat}'); closeAllActionMenus();">
                                        <i class="fa-solid fa-pen-to-square" style="color:var(--accent-cyan);"></i> ${plat === 'youtube' ? 'Sửa Kênh & Subscribers' : 'Sửa Trang & Followers'}
                                    </button>
                                    <a href="${chLink}" target="_blank" rel="noopener" class="action-dropdown-item" onclick="closeAllActionMenus()">
                                        <i class="${plat === 'youtube' ? 'fa-brands fa-youtube' : 'fa-brands fa-facebook'}" style="color:${plat === 'youtube' ? '#ef4444' : '#1877f2'};"></i> ${plat === 'youtube' ? 'Mở kênh YouTube' : 'Mở trang Facebook'}
                                    </a>
                                    <button type="button" class="action-dropdown-item" onclick="copyTextToClipboard('${escapeHtml(ch.channel_id)}', 'Đã sao chép ID!'); closeAllActionMenus();">
                                        <i class="fa-solid fa-copy" style="color:#94a3b8;"></i> Sao chép ${plat === 'youtube' ? 'Channel ID' : 'Page UID'}
                                    </button>
                                    <button type="button" class="action-dropdown-item" onclick="copyTextToClipboard('${escapeHtml(chLink)}', 'Đã sao chép liên kết!'); closeAllActionMenus();">
                                        <i class="fa-solid fa-link" style="color:#94a3b8;"></i> Sao chép liên kết
                                    </button>
                                    ${!ch.is_default ? `
                                    <div class="dropdown-divider"></div>
                                    <button type="button" class="action-dropdown-item text-danger" onclick="deleteChannelFromList('${escapeHtml(p.gpm_id)}', '${escapeHtml(ch.channel_id)}', '${escapeHtml(ch.channel_name || ch.channel_id)}'); closeAllActionMenus();">
                                        <i class="fa-solid fa-trash text-danger"></i> Xóa khỏi danh sách
                                    </button>` : ''}
                                </div>
                            </div>
                        </td>
                    </tr>
                    `;
                }).join('');
            }

            return mainRowHtml + subRowsHtml;
        }).join('');
    }

    // Cập nhật tab Nick Đạt Chỉ Tiêu
    if (eligibleGrid) {
        const eligibleList = (cachedGpmProfiles || []).filter(p => isProfileEligible(p));
        if (eligibleList.length > 0) {
            eligibleGrid.innerHTML = eligibleList.map(e => {
                const plat = (e.platform || 'tiktok').toLowerCase();
                const th = getPlatformThreshold(plat);
                const subLabel = plat === 'youtube' ? 'subs' : 'followers';
                const platName = plat === 'youtube' ? 'YouTube' : (plat === 'facebook' ? 'Facebook' : 'TikTok');
                const platIcon = plat === 'youtube' ? '<i class="fa-brands fa-youtube" style="color:#ef4444;"></i>' : (plat === 'facebook' ? '<i class="fa-brands fa-facebook" style="color:#1877f2;"></i>' : '<i class="fa-brands fa-tiktok" style="color:#ff0050;"></i>');
                return `
                <div class="glass-panel" style="border-color: rgba(245, 158, 11, 0.4); background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(20, 26, 40, 0.9));">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h4 style="color:var(--accent-gold); font-size:16px; margin:0; display:flex; align-items:center; gap:6px;">
                            ${platIcon} @${escapeHtml(e.tiktok_username || e.name)}
                        </h4>
                        <span class="badge badge-success">Đạt Mốc ${formatThresholdDisplay(th)}</span>
                    </div>
                    <div style="margin-top:12px; font-size:13px; color:var(--text-secondary);">
                        <p style="margin:4px 0;"><strong>${plat === 'youtube' ? 'Subscribers:' : 'Followers:'}</strong> <span style="color:white; font-size:16px; font-weight:700;">${(e.followers_count || 0).toLocaleString()}</span> <span style="font-size:11px; color:var(--text-muted);">${subLabel}</span></p>
                        <p style="margin:4px 0;"><strong>Nền tảng:</strong> ${platName} | <strong>Profile:</strong> ${escapeHtml(e.name)}</p>
                        <p style="margin:4px 0;"><strong>Proxy:</strong> ${escapeHtml(e.raw_proxy || 'Direct')}</p>
                        ${e.last_checked ? `<p style="margin:4px 0;"><strong>Lần quét gần nhất:</strong> ${escapeHtml(e.last_checked)}</p>` : ''}
                    </div>
                </div>
                `;
            }).join('');
        } else {
            eligibleGrid.innerHTML = `
                <div class="card-empty-state">
                    <i class="fa-solid fa-chart-line"></i>
                    <p>Hệ thống đang theo dõi tăng trưởng các tài khoản. Khi có tài khoản/kênh đạt ngưỡng chỉ tiêu đã đặt (TikTok, YouTube, Facebook), thông tin sẽ hiển thị tại đây và hệ thống sẽ tự động gửi thông báo qua Telegram.</p>
                </div>
            `;
        }
    }
}

async function setProfileNotifyStatus(gpmId, newStatus) {
    try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(gpmId)}/notify-status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            if (cachedGpmProfiles) {
                const target = cachedGpmProfiles.find(p => p.gpm_id === gpmId);
                if (target) {
                    target.notify_status = newStatus;
                }
            }
            showToast(`✅ Đã chuyển trạng thái theo dõi: ${data.label || newStatus}`);
            renderGpmProfilesTable();
        } else {
            showToast(data.detail || data.message || 'Lỗi cập nhật trạng thái theo dõi', true);
        }
    } catch (err) {
        console.error('Lỗi setProfileNotifyStatus:', err);
        showToast('Lỗi kết nối khi cập nhật trạng thái theo dõi: ' + err.message, true);
    }
}

function cycleProfileNotifyStatus(gpmId, currentStatus) {
    const cur = (currentStatus || 'tracking').toLowerCase();
    let nextStatus = 'tracking';
    if (cur === 'tracking') {
        nextStatus = 'muted';
    } else if (cur === 'muted') {
        nextStatus = 'tracking';
    } else if (cur === 'sent') {
        nextStatus = 'tracking';
    }
    setProfileNotifyStatus(gpmId, nextStatus);
}

async function cycleCreatorProgramStatus(gpmId, currentStatus) {
    const cur = (currentStatus || 'ineligible').toLowerCase();
    if (cur === 'ineligible') {
        showToast('ℹ️ Tài khoản này chưa đạt 10,000 followers nên chưa đủ điều kiện Creator Rewards.');
        return;
    }
    let nextStatus = 'active';
    if (cur === 'active') {
        nextStatus = 'not_enrolled';
    } else if (cur === 'not_enrolled') {
        nextStatus = 'banned';
    } else if (cur === 'banned') {
        nextStatus = 'active';
    } else {
        nextStatus = 'active';
    }
    try {
        const res = await fetch(`/api/profiles/${gpmId}/creator-program`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus })
        });
        const data = await res.json();
        if (data.status === 'success') {
            const p = cachedGpmProfiles.find(x => x.gpm_id === gpmId);
            if (p) p.creator_program = nextStatus;
            renderGpmProfilesTable();
            const labelMap = {
                'active': 'ĐÃ BẬT (CREATOR REWARDS)',
                'not_enrolled': 'CHƯA BẬT',
                'banned': 'BỊ NGỪNG'
            };
            showToast(`✅ Đã chuyển Creator Program thành: ${labelMap[nextStatus] || nextStatus.toUpperCase()}`);
        }
    } catch (e) {
        showToast(`❌ Lỗi cập nhật Creator Program: ${e.message}`, 'error');
    }
}
window.cycleCreatorProgramStatus = cycleCreatorProgramStatus;

async function cycleFlopStatus(gpmId, currentStatus) {
    const cur = (currentStatus || 'new').toLowerCase();
    let nextStatus = 'good';
    if (cur === 'new') {
        nextStatus = 'good';
    } else if (cur === 'good') {
        nextStatus = 'unstable';
    } else if (cur === 'unstable') {
        nextStatus = '200_view';
    } else if (cur === '200_view') {
        nextStatus = '0_view';
    } else if (cur === '0_view') {
        nextStatus = 'new';
    } else {
        nextStatus = 'good';
    }
    try {
        const res = await fetch(`/api/profiles/${gpmId}/flop-status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus })
        });
        const data = await res.json();
        if (data.status === 'success') {
            const p = cachedGpmProfiles.find(x => x.gpm_id === gpmId);
            if (p) {
                p.flop_status = nextStatus;
                if (data.flop_since) p.flop_since = data.flop_since;
                p.flop_recovering = false;
            }
            renderGpmProfilesTable();
            const labelMap = {
                '0_view': '🚨 0-VIEW (FLOP / SHADOWBAN)',
                '200_view': '⚠️ KẸT 200 VIEW',
                'unstable': '⚡ KHÔNG ỔN ĐỊNH',
                'good': '🚀 KHỎE / TĂNG TRƯỞNG TỐT',
                'new': '🌱 ĐANG NUÔI (CHƯA ĐỦ SỐ LIỆU)'
            };
            showToast(`✅ Đã chuyển tình trạng kênh thành: ${labelMap[nextStatus] || nextStatus.toUpperCase()}`);
        }
    } catch (e) {
        showToast(`❌ Lỗi cập nhật Tình trạng kênh: ${e.message}`, 'error');
    }
}
window.cycleFlopStatus = cycleFlopStatus;

async function deleteGpmProfileFromList(gpmId, profileName) {
    closeAllActionMenus();
    const ok = await showConfirmDialog({
        title: 'Xóa Profile',
        message: `Bạn có chắc chắn muốn XÓA profile "${profileName}" khỏi hệ thống Quản lý Farm?`,
        details: 'Hệ thống sẽ ngừng theo dõi và quản lý profile này.',
        confirmText: 'Xóa Profile',
        confirmClass: 'btn-danger'
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/gpm/profiles/${gpmId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(`✅ ${data.message || 'Đã xóa profile thành công!'}`);
            loadGpmProfiles();
            loadDashboardStats();
        } else {
            showToast(data.message || 'Không thể xóa profile', true);
        }
    } catch (err) {
        showToast('Lỗi khi xóa profile: ' + err.message, true);
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// QUẢN LÝ KÊNH/TRANG CON PROFILE (OPTION A - ACCORDION SUB-ROWS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
window.expandedProfileIds = window.expandedProfileIds || new Set();

function toggleSubChannels(gpmId, event) {
    if (event) {
        event.stopPropagation();
    }
    const subRows = document.querySelectorAll(`.sub-row-${gpmId}`);
    const toggleBtn = document.getElementById(`btn-toggle-${gpmId}`);
    const isCurrentlyExpanded = window.expandedProfileIds.has(gpmId);

    if (isCurrentlyExpanded) {
        window.expandedProfileIds.delete(gpmId);
        subRows.forEach(row => { row.style.display = 'none'; });
        if (toggleBtn) toggleBtn.classList.remove('expanded');
    } else {
        window.expandedProfileIds.add(gpmId);
        subRows.forEach(row => { row.style.display = ''; });
        if (toggleBtn) toggleBtn.classList.add('expanded');
    }
}
window.toggleSubChannels = toggleSubChannels;

async function setDefaultChannel(gpmId, channelId) {
    showToast('Đang cập nhật kênh mặc định...');
    try {
        const res = await fetch(`/api/gpm/profiles/${gpmId}/channels/${channelId}/set-default`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('✅ Đã đặt làm kênh mặc định!');
            await loadGpmProfiles();
        } else {
            showToast(data.message || 'Lỗi đặt kênh mặc định', true);
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, true);
    }
}
window.setDefaultChannel = setDefaultChannel;

async function deleteSubChannel(gpmId, channelId, channelName) {
    if (!confirm(`Bạn có chắc muốn xóa kênh/trang "${channelName || channelId}" khỏi danh sách?`)) {
        return;
    }
    try {
        const res = await fetch(`/api/gpm/profiles/${gpmId}/channels/${channelId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(`✅ Đã xóa kênh/trang "${channelName || channelId}"`);
            await loadGpmProfiles();
        } else {
            showToast(data.message || 'Lỗi khi xóa kênh', true);
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, true);
    }
}
window.deleteSubChannel = deleteSubChannel;

// Quét và đồng bộ tất cả kênh/trang con (YouTube channels, Facebook pages) cho 1 profile
async function syncProfileChannels(gpmId) {
    showToast('Đang quét kênh / trang con...');
    try {
        const res = await fetch(`/api/gpm/profiles/${gpmId}/channels/sync`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            const ytCount = (data.youtube || []).length;
            const fbCount = (data.facebook || []).length;
            showToast(`✅ Đã tìm thấy ${ytCount} kênh YouTube + ${fbCount} trang Facebook!`);
            loadGpmProfiles();
        } else {
            showToast(data.message || 'Lỗi quét kênh', true);
        }
    } catch (err) {
        showToast('Lỗi quét kênh: ' + err.message, true);
    }
}

// Quét follower 1 profile cụ thể
async function scanSingleProfileFollowers(gpmId, btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Quét...';
    }
    showToast('Đang kết nối và trích xuất số follower...');
    try {
        const res = await fetch(`/api/profiles/${gpmId}/scan`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            const fStr = (data.followers || 0).toLocaleString();
            showToast(`✅ Quét thành công: @${data.username || 'N/A'} đạt ${fStr} followers!`);
            loadGpmProfiles();
            loadDashboardStats();
            return data;
        } else {
            showToast(data.message || 'Lỗi quét profile', true);
            return data;
        }
    } catch (err) {
        showToast('Không thể quét follower: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// Quét follower toàn bộ nick tuần tự với Live Progress & Nút Dừng
let _scanProgressPoller = null;
let _lastScanProgressIndex = 0;

async function checkScanProgress() {
    try {
        const res = await fetch('/api/profiles/scan-progress');
        const data = await res.json();
        const container = document.getElementById('scanProgressBarContainer');
        const titleEl = document.getElementById('scanProgressTitle');
        const subEl = document.getElementById('scanProgressSubtitle');
        const pctEl = document.getElementById('scanProgressPercent');
        const fillEl = document.getElementById('scanProgressBarFill');
        const scanBtn = document.getElementById('btnScanAllFollowersTab');

        if (!container) return;

        if (data.is_scanning) {
            container.style.display = 'block';
            if (scanBtn) {
                scanBtn.disabled = true;
                scanBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Quét...';
            }

            const total = data.total || 0;
            const current = data.current !== undefined ? data.current : (data.current_index !== undefined ? data.current_index : 0);
            const pct = data.percent !== undefined ? data.percent : (total > 0 ? Math.round((current / total) * 100) : 0);

            if (titleEl) {
                if (data.current_profile_name) {
                    titleEl.innerHTML = `Đang quét: <span style="color:var(--accent-cyan); font-weight:700;">${escapeHtml(data.current_profile_name)}</span> [${current}/${total}]`;
                } else {
                    titleEl.textContent = `Đang quét Follower [${current}/${total}]...`;
                }
            }
            if (subEl) {
                subEl.textContent = data.status_message || data.message || 'Chế độ ZeroRAM siêu nhẹ, tự động giải phóng bộ nhớ sau mỗi nick';
            }
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (fillEl) fillEl.style.width = `${pct}%`;

            // Cập nhật bảng dữ liệu khi nick vừa quét xong
            if (current > _lastScanProgressIndex) {
                _lastScanProgressIndex = current;
                loadGpmProfiles();
                loadDashboardStats();
            }
        } else {
            // Không quét hoặc đã kết thúc
            if (_scanProgressPoller) {
                clearInterval(_scanProgressPoller);
                _scanProgressPoller = null;
            }
            _lastScanProgressIndex = 0;

            if (container.style.display !== 'none') {
                if (fillEl) fillEl.style.width = '100%';
                if (pctEl) pctEl.textContent = '100%';
                if (titleEl) titleEl.textContent = data.status_message || data.message || 'Đã hoàn thành quét Follower!';
                setTimeout(() => {
                    container.style.display = 'none';
                    if (fillEl) fillEl.style.width = '0%';
                }, 2500);
            }

            if (scanBtn) {
                scanBtn.disabled = false;
                scanBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass-chart"></i> Quét Follower';
            }

            loadGpmProfiles();
            loadDashboardStats();
        }
    } catch (err) {
        console.error('Lỗi kiểm tra tiến độ quét:', err);
    }
}

function startScanProgressPolling() {
    if (_scanProgressPoller) clearInterval(_scanProgressPoller);
    _lastScanProgressIndex = 0;
    checkScanProgress();
    _scanProgressPoller = setInterval(checkScanProgress, 800);
}

async function stopAllProfilesScan(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Dừng...';
    }
    showToast('🛑 Đang yêu cầu dừng quét... Nick hiện tại sẽ được đóng ngay lập tức.');
    try {
        const res = await fetch('/api/profiles/scan-stop', { method: 'POST' });
        const data = await res.json();
        showToast(data.message || 'Đã gửi lệnh dừng tiến trình quét thành công!');
        setTimeout(checkScanProgress, 500);
    } catch (err) {
        showToast('Lỗi khi dừng quét: ' + err.message, true);
    } finally {
        setTimeout(() => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }, 1500);
    }
}

async function scanAllProfilesFollowers(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Khởi Động...';
    }
    showToast('🚀 Bắt đầu quét Follower cho toàn bộ nick (Chế độ Low-RAM)...');
    try {
        const res = await fetch('/api/profiles/scan-all', { method: 'POST' });
        const data = await res.json();
        if (data.status === 'warning') {
            showToast(data.message, true);
        } else {
            showToast('Tiến trình quét đang chạy ngầm, bạn có thể theo dõi tiến độ hoặc bấm Dừng Quét bất kỳ lúc nào!');
        }
        startScanProgressPolling();
    } catch (err) {
        showToast('Lỗi khi kích hoạt quét tất cả: ' + err.message, true);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}
window.scanAllProfilesFollowers = scanAllProfilesFollowers;

// Quản lý Modal sửa Nick & Followers / Account & Channel Metrics
function updateEditProfileModalLabels(platform, channelId) {
    const plat = (platform || 'tiktok').toLowerCase();
    const isSub = Boolean(channelId);

    const iconEl = document.getElementById('editProfileModalIcon');
    const titleEl = document.getElementById('editProfileModalTitle');
    const subEl = document.getElementById('editProfileModalSub');
    const userIcon = document.getElementById('editProfileUserIcon');
    const userLabel = document.getElementById('editProfileUserLabel');
    const userPrefix = document.getElementById('editProfileUserPrefix');
    const userInput = document.getElementById('editProfileUsername');
    const userHint = document.getElementById('editProfileUserHint');
    const nickIcon = document.getElementById('editProfileNickIcon');
    const nickLabel = document.getElementById('editProfileNickLabel');
    const nickInput = document.getElementById('editProfileNickname');
    const flwIcon = document.getElementById('editProfileFollowersIcon');
    const flwLabel = document.getElementById('editProfileFollowersLabel');

    if (plat === 'youtube') {
        if (iconEl) { iconEl.className = 'fa-brands fa-youtube'; iconEl.style.color = '#ef4444'; }
        if (titleEl) titleEl.textContent = isSub ? 'Sửa Kênh YouTube & Số Subscribers' : 'Sửa Tài Khoản YouTube & Chỉ Số';
        if (subEl) subEl.textContent = isSub ? 'Cập nhật tên kênh, handle và số người đăng ký cho kênh con' : 'Gán thủ công hoặc đồng bộ thông số kênh YouTube cho profile';
        if (userIcon) { userIcon.className = 'fa-brands fa-youtube'; userIcon.style.color = '#ef4444'; }
        if (userLabel) userLabel.textContent = 'YouTube Handle / Channel ID:';
        if (userPrefix) userPrefix.style.display = 'block';
        if (userInput) { userInput.placeholder = 'ten_kenh_youtube'; userInput.style.paddingLeft = '28px'; }
        if (userHint) userHint.innerHTML = 'Handle YouTube (ví dụ: <code>tenkenh</code>) hoặc Channel ID (ví dụ: <code>UC...</code>)';
        if (nickIcon) nickIcon.className = 'fa-solid fa-id-badge';
        if (nickLabel) nickLabel.textContent = 'Tên Kênh YouTube:';
        if (nickInput) nickInput.placeholder = 'Ví dụ: Shorts Stack Channel, Tech Tips...';
        if (flwIcon) flwIcon.className = 'fa-solid fa-users';
        if (flwLabel) flwLabel.textContent = 'Số Người Đăng Ký (Subscribers):';
    } else if (plat === 'facebook') {
        if (iconEl) { iconEl.className = 'fa-brands fa-facebook'; iconEl.style.color = '#1877f2'; }
        if (titleEl) titleEl.textContent = isSub ? 'Sửa Fanpage & Số Followers' : 'Sửa Tài Khoản Facebook & Chỉ Số';
        if (subEl) subEl.textContent = isSub ? 'Cập nhật tên fanpage, UID và số người theo dõi cho trang con' : 'Gán thủ công hoặc đồng bộ thông số Facebook cho profile';
        if (userIcon) { userIcon.className = 'fa-brands fa-facebook'; userIcon.style.color = '#1877f2'; }
        if (userLabel) userLabel.textContent = 'Page UID / Username:';
        if (userPrefix) userPrefix.style.display = 'none';
        if (userInput) { userInput.placeholder = 'Ví dụ: 6159616419 hoặc page_username'; userInput.style.paddingLeft = '12px'; }
        if (userHint) userHint.innerHTML = 'Nhập UID Fanpage hoặc Username / URL trang Facebook';
        if (nickIcon) nickIcon.className = 'fa-solid fa-flag';
        if (nickLabel) nickLabel.textContent = 'Tên Fanpage / Trang Facebook:';
        if (nickInput) nickInput.placeholder = 'Ví dụ: Cộng Đồng MMO, Tin Tức 24h...';
        if (flwIcon) flwIcon.className = 'fa-solid fa-users';
        if (flwLabel) flwLabel.textContent = 'Số Followers / Likes Hiện Tại:';
    } else {
        if (iconEl) { iconEl.className = 'fa-brands fa-tiktok text-accent'; iconEl.style.color = ''; }
        if (titleEl) titleEl.textContent = 'Sửa Tài Khoản & Chỉ Số TikTok';
        if (subEl) subEl.textContent = 'Gán thủ công hoặc đồng bộ thông số cho profile';
        if (userIcon) { userIcon.className = 'fa-brands fa-tiktok'; userIcon.style.color = ''; }
        if (userLabel) userLabel.textContent = 'TikTok Username:';
        if (userPrefix) userPrefix.style.display = 'block';
        if (userInput) { userInput.placeholder = 'username_cua_ban'; userInput.style.paddingLeft = '28px'; }
        if (userHint) userHint.innerHTML = 'Không cần nhập dấu @. Ví dụ: <code>dat.nguyen261096</code>';
        if (nickIcon) nickIcon.className = 'fa-solid fa-id-badge';
        if (nickLabel) nickLabel.textContent = 'Tên Kênh / Hiển Thị TikTok:';
        if (nickInput) nickInput.placeholder = 'Ví dụ: Hoàng Minh, Iamcooked...';
        if (flwIcon) flwIcon.className = 'fa-solid fa-users';
        if (flwLabel) flwLabel.textContent = 'Số Follower Hiện Tại:';
    }
}
window.updateEditProfileModalLabels = updateEditProfileModalLabels;

function onEditProfilePlatformChange(val) {
    const chId = document.getElementById('editProfileChannelId')?.value;
    updateEditProfileModalLabels(val, chId);
}
window.onEditProfilePlatformChange = onEditProfilePlatformChange;

function openEditChannelModal(gpmId, profileName, channelId, channelName, followers, handle, platform) {
    openEditUsernameModal(gpmId, profileName, handle || channelId, followers, channelName, 'gpm', platform, channelId);
}
window.openEditChannelModal = openEditChannelModal;

function openEditUsernameModal(gpmId, profileName, currentUsername, followers, currentNickname, browserType, platform, channelId, country) {
    console.log('[DEBUG MODAL] openEditUsernameModal CALLED with:', { gpmId, profileName, currentUsername, followers, currentNickname, browserType, platform, channelId, country });
    const gpmIdEl = document.getElementById('editProfileGpmId');
    if (gpmIdEl) gpmIdEl.value = gpmId;
    const channelIdEl = document.getElementById('editProfileChannelId');
    if (channelIdEl) channelIdEl.value = channelId || '';
    const nameEl = document.getElementById('editProfileName');
    if (nameEl) nameEl.value = profileName || gpmId;
    const userEl = document.getElementById('editProfileUsername');
    if (userEl) userEl.value = (currentUsername || '').replace(/^@/, '');
    const nickInput = document.getElementById('editProfileNickname');
    if (nickInput) nickInput.value = currentNickname || '';
    const flwEl = document.getElementById('editProfileFollowers');
    if (flwEl) flwEl.value = followers || 0;
    const bTypeSelect = document.getElementById('editProfileBrowserType');
    if (bTypeSelect && browserType) bTypeSelect.value = browserType.toLowerCase();
    const platSelect = document.getElementById('editProfilePlatform');
    const effPlat = (platform || 'tiktok').toLowerCase();
    if (platSelect) platSelect.value = effPlat;

    const countrySelect = document.getElementById('editProfileCountry');
    if (countrySelect) {
        countrySelect.value = (country && country.toUpperCase() !== 'NONE') ? country.toUpperCase() : 'NONE';
    }

    // Gán thông tin Nhóm, Chiến Dịch và Tổng Lượt Xem từ profile hiện tại
    const matchedP = (cachedGpmProfiles || []).find(p => String(p.gpm_id) === String(gpmId));
    const groupInput = document.getElementById('editProfileGroupName');
    if (groupInput) groupInput.value = matchedP ? getProfileGroupName(matchedP) : '';
    const campInput = document.getElementById('editProfileCampaign');
    if (campInput) campInput.value = matchedP ? (matchedP.campaign || matchedP.campaign_name || '') : '';
    const viewsInput = document.getElementById('editProfileTotalViews');
    if (viewsInput) viewsInput.value = matchedP ? (matchedP.total_views || 0) : 0;

    updateEditProfileModalLabels(effPlat, channelId);

    const modal = document.getElementById('editProfileUsernameModal');
    console.log('[DEBUG MODAL] #editProfileUsernameModal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.classList.add('show');
        modal.style.display = 'flex';
        const computed = window.getComputedStyle(modal);
        console.log('[DEBUG MODAL] #editProfileUsernameModal after open -> style.display:', modal.style.display, 'computed display:', computed.display, 'z-index:', computed.zIndex, 'visibility:', computed.visibility, 'opacity:', computed.opacity);
    } else {
        console.error('[DEBUG MODAL] #editProfileUsernameModal NOT FOUND in DOM!');
    }
}
window.openEditUsernameModal = openEditUsernameModal;

function closeEditUsernameModal() {
    console.log('[DEBUG MODAL] closeEditUsernameModal CALLED');
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    const channelIdEl = document.getElementById('editProfileChannelId');
    if (channelIdEl) channelIdEl.value = '';
    const modal = document.getElementById('editProfileUsernameModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
        modal.style.display = 'none';
        console.log('[DEBUG MODAL] #editProfileUsernameModal closed');
    }
}
window.closeEditUsernameModal = closeEditUsernameModal;

async function saveProfileUsernameFromModal(btn) {
    const gpmId = document.getElementById('editProfileGpmId').value;
    const channelId = document.getElementById('editProfileChannelId')?.value;
    const usernameInput = document.getElementById('editProfileUsername');
    const nicknameInput = document.getElementById('editProfileNickname');
    const followersInput = document.getElementById('editProfileFollowers');
    const platform = (document.getElementById('editProfilePlatform')?.value || 'tiktok').toLowerCase();
    const username = usernameInput ? usernameInput.value.trim().replace(/^@/, '') : '';
    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const rawFollowers = followersInput ? followersInput.value.trim() : '0';
    const followers = parseInt(rawFollowers, 10);

    const userLabel = platform === 'youtube' ? 'YouTube Handle / ID' : (platform === 'facebook' ? 'Page UID / Username' : 'TikTok Username');
    if (!username) {
        markInputError('editProfileUsername', `Vui lòng nhập ${userLabel} (không được để trống)!`);
        return;
    }
    if (isNaN(followers) || followers < 0) {
        markInputError('editProfileFollowers', 'Số lượng Followers / Subscribers phải là số nguyên không âm (>= 0)!');
        return;
    }

    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Lưu...';
    }

    try {
        if (channelId) {
            // Lưu thông tin kênh / trang con
            const resCh = await fetch(`/api/gpm/profiles/${encodeURIComponent(gpmId)}/channels/${encodeURIComponent(channelId)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    channel_name: nickname,
                    channel_url: platform === 'youtube' ? (username.startsWith('@') ? username : '@' + username) : username,
                    new_channel_id: (platform === 'youtube' && channelId.startsWith('UC') && !username.startsWith('UC')) ? channelId : username,
                    followers_count: followers
                })
            });
            const dataCh = await resCh.json();
            if (!resCh.ok) {
                showToast('Lỗi cập nhật kênh: ' + (dataCh.detail || dataCh.message || 'Thất bại'), 'error');
                return;
            }
            showToast(`✅ Đã lưu thông tin kênh "${nickname || username}" thành công!`, 'success');
            closeEditUsernameModal();
            loadGpmProfiles();
            loadDashboardStats();
            return;
        }

        const countryVal = (document.getElementById('editProfileCountry')?.value || 'NONE').toUpperCase();
        const groupName = (document.getElementById('editProfileGroupName')?.value || '').trim();
        const campaignVal = (document.getElementById('editProfileCampaign')?.value || '').trim();
        const totalViews = Math.max(0, parseInt(document.getElementById('editProfileTotalViews')?.value || '0', 10) || 0);

        const resU = await fetch(`/api/profiles/${gpmId}/username`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: username,
                nickname: nickname,
                browser_type: document.getElementById('editProfileBrowserType')?.value || 'gpm',
                platform: platform,
                country: countryVal,
                group_name: groupName,
                campaign: campaignVal,
                total_views: totalViews
            })
        });
        const dataU = await resU.json();
        if (!resU.ok) {
            showToast('Lỗi cập nhật username: ' + (dataU.detail || dataU.message || 'Thất bại'), 'error');
            return;
        }
        if (countryVal === 'NONE') {
            showToast('🌐 Đã cập nhật profile & gỡ bỏ Proxy (Dùng IP mạng trực tiếp)!', 'info');
        } else if (dataU.wireproxy_assigned) {
            showToast(`⚡ Đã gán WireGuard SOCKS5 [${countryVal}] (${dataU.proxy_url}) vào GPMLogin!`, 'success');
        } else {
            showToast('✅ Đã lưu thay đổi thông tin profile thành công!', 'success');
        }

        const resS = await fetch('/api/profiles/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gpm_id: gpmId,
                followers: followers,
                views: totalViews,
                username: username,
                nickname: nickname
            })
        });
        const dataS = await resS.json();
        if (!resS.ok) {
            showToast('Lỗi cập nhật chỉ số: ' + (dataS.detail || dataS.message || 'Thất bại'), 'error');
            return;
        }

        showToast(`✅ Đã lưu thông tin ${nickname || username} thành công!`, 'success');
        closeEditUsernameModal();
        loadGpmProfiles();
        loadDashboardStats();
    } catch (err) {
        showToast('Lỗi khi lưu thông tin: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

async function setChannelNotifyStatus(gpmId, channelId, newStatus) {
    try {
        const res = await fetch(`/api/gpm/profiles/${encodeURIComponent(gpmId)}/channels/${encodeURIComponent(channelId)}/notify-status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            if (cachedGpmProfiles) {
                const targetP = cachedGpmProfiles.find(p => p.gpm_id === gpmId);
                if (targetP && targetP.channels) {
                    const targetCh = targetP.channels.find(c => c.channel_id === channelId);
                    if (targetCh) targetCh.notify_status = newStatus;
                }
            }
            showToast(`✅ Đã chuyển trạng thái theo dõi kênh: ${data.label || newStatus}`);
            renderGpmProfilesTable();
        } else {
            showToast(data.detail || data.message || 'Lỗi cập nhật trạng thái theo dõi kênh', true);
        }
    } catch (err) {
        console.error('Lỗi setChannelNotifyStatus:', err);
        showToast('Lỗi kết nối khi cập nhật trạng thái theo dõi kênh: ' + err.message, true);
    }
}
window.setChannelNotifyStatus = setChannelNotifyStatus;

function cycleChannelNotifyStatus(gpmId, channelId, currentStatus) {
    const cur = (currentStatus || 'tracking').toLowerCase();
    let nextStatus = 'tracking';
    if (cur === 'tracking') {
        nextStatus = 'muted';
    } else if (cur === 'muted') {
        nextStatus = 'tracking';
    } else if (cur === 'sent') {
        nextStatus = 'tracking';
    }
    setChannelNotifyStatus(gpmId, channelId, nextStatus);
}
window.cycleChannelNotifyStatus = cycleChannelNotifyStatus;

async function scanSingleChannelFollowers(gpmId, channelId, plat, btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Quét...';
    }
    showToast('Đang kết nối và đồng bộ số liệu kênh / trang...');
    try {
        const res = await fetch(`/api/gpm/profiles/${encodeURIComponent(gpmId)}/channels/sync`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(`✅ Đã đồng bộ và cập nhật chỉ số kênh thành công!`);
            loadGpmProfiles();
            loadDashboardStats();
        } else {
            showToast(data.message || 'Lỗi khi đồng bộ chỉ số kênh', true);
        }
    } catch (err) {
        showToast('Lỗi khi quét kênh: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}
window.scanSingleChannelFollowers = scanSingleChannelFollowers;

async function deleteChannelFromList(gpmId, channelId, channelName) {
    closeAllActionMenus();
    const ok = await showConfirmDialog({
        title: 'Xóa Kênh / Trang Con',
        message: `Bạn có chắc chắn muốn xóa kênh/trang "${channelName || channelId}" khỏi danh sách theo dõi?`,
        details: 'Kênh này sẽ không còn hiển thị trong danh sách kênh con của profile.',
        confirmText: 'Xóa Kênh',
        confirmClass: 'btn-danger'
    });
    if (!ok) return;
    try {
        const res = await fetch(`/api/gpm/profiles/${encodeURIComponent(gpmId)}/channels/${encodeURIComponent(channelId)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.status === 'success') {
            showToast(`✅ ${data.message || 'Đã xóa kênh thành công!'}`);
            loadGpmProfiles();
        } else {
            showToast(data.message || 'Không thể xóa kênh', true);
        }
    } catch (err) {
        showToast('Lỗi khi xóa kênh: ' + err.message, true);
    }
}
window.deleteChannelFromList = deleteChannelFromList;

async function scanCurrentEditProfile(btn) {
    const gpmId = document.getElementById('editProfileGpmId').value;
    if (!gpmId) return;
    const res = await scanSingleProfileFollowers(gpmId, btn);
    if (res && res.success) {
        if (res.username) document.getElementById('editProfileUsername').value = res.username;
        if (res.nickname !== undefined) {
            const nickInput = document.getElementById('editProfileNickname');
            if (nickInput) nickInput.value = res.nickname || '';
        }
        if (res.followers !== undefined) document.getElementById('editProfileFollowers').value = res.followers;
    }
}

async function deleteCurrentEditProfile(btn) {
    const gpmId = document.getElementById('editProfileGpmId').value;
    const name = document.getElementById('editProfileName').value;
    if (!gpmId) return;
    closeEditUsernameModal();
    await deleteGpmProfileFromList(gpmId, name || gpmId);
}

// Quản lý Modal Cài Đặt Lịch Quét Follower Tự Động
async function loadFollowerSchedulerBadge() {
    try {
        const res = await fetch('/api/settings/follower-scheduler');
        const data = await res.json();
        const btn = document.getElementById('btnFollowerSchedulerModal');
        const badge = document.getElementById('badgeFollowerSchedulerState');

        // Nếu thẻ badge cũ còn trong DOM thì loại bỏ để nút hiển thị gọn gàng
        if (badge) {
            badge.remove();
        }

        if (btn) {
            if (data.enabled) {
                if (data.mode === 'daily_times') {
                    const timesStr = (data.times || '').trim();
                    btn.title = `Lịch quét tự động: Bật (${timesStr || '08:00, 20:00'}) - Nhấn để cấu hình`;
                } else {
                    btn.title = `Lịch quét tự động: Bật (Mỗi ${data.interval_hours || 6}h) - Nhấn để cấu hình`;
                }
            } else {
                btn.title = 'Lịch quét định kỳ đang tắt - Nhấn để cấu hình';
            }
        }
    } catch (err) {
        console.error('Lỗi nạp follower scheduler info:', err);
    }
}

function toggleFollowerScanModeUI() {
    const isDaily = document.getElementById('scanModeDaily').checked;
    const wrapDaily = document.getElementById('wrapDailyTimes');
    const wrapInterval = document.getElementById('wrapIntervalHours');
    if (wrapDaily) wrapDaily.style.display = isDaily ? 'block' : 'none';
    if (wrapInterval) wrapInterval.style.display = isDaily ? 'none' : 'block';
}

async function openFollowerSchedulerModal() {
    console.log('[DEBUG MODAL] openFollowerSchedulerModal CALLED');
    const modal = document.getElementById('followerSchedulerModal');
    console.log('[DEBUG MODAL] #followerSchedulerModal element:', modal);
    if (modal) {
        modal.classList.add('active');
        modal.classList.add('show');
        modal.style.display = 'flex';
        const computed = window.getComputedStyle(modal);
        console.log('[DEBUG MODAL] #followerSchedulerModal after open -> style.display:', modal.style.display, 'computed display:', computed.display, 'z-index:', computed.zIndex, 'visibility:', computed.visibility, 'opacity:', computed.opacity);
    } else {
        console.error('[DEBUG MODAL] #followerSchedulerModal NOT FOUND in DOM!');
    }

    try {
        console.log('[DEBUG MODAL] Fetching /api/settings/follower-scheduler...');
        const res = await fetch('/api/settings/follower-scheduler');
        const data = await res.json();
        console.log('[DEBUG MODAL] follower-scheduler settings received:', data);
        const chk = document.getElementById('chkFollowerSchedulerEnable');
        if (chk) chk.checked = Boolean(data.enabled);
        if (data.mode === 'interval') {
            const rInt = document.getElementById('scanModeInterval');
            if (rInt) rInt.checked = true;
        } else {
            const rDay = document.getElementById('scanModeDaily');
            if (rDay) rDay.checked = true;
        }
        const tInput = document.getElementById('inputFollowerScanTimes');
        if (tInput && data.times) tInput.value = data.times;
        const iSelect = document.getElementById('selectFollowerIntervalHours');
        if (iSelect && data.interval_hours) iSelect.value = String(data.interval_hours);
        if (data.follower_threshold_tiktok !== undefined) {
            const el = document.getElementById('schedThresholdTiktok');
            if (el) el.value = data.follower_threshold_tiktok;
        }
        if (data.follower_threshold_youtube !== undefined) {
            const el = document.getElementById('schedThresholdYoutube');
            if (el) el.value = data.follower_threshold_youtube;
        }
        if (data.follower_threshold_facebook !== undefined) {
            const el = document.getElementById('schedThresholdFacebook');
            if (el) el.value = data.follower_threshold_facebook;
        }
        if (data.profile_sync_concurrent_workers !== undefined) {
            const elWorkers = document.getElementById('schedProfileSyncConcurrentWorkers');
            if (elWorkers) elWorkers.value = data.profile_sync_concurrent_workers;
        }
        if (typeof toggleFollowerScanModeUI === 'function') toggleFollowerScanModeUI();
    } catch (err) {
        console.error('[DEBUG MODAL] Lỗi đọc follower scheduler settings:', err);
    }
}
window.openFollowerSchedulerModal = openFollowerSchedulerModal;

function closeFollowerSchedulerModal() {
    console.log('[DEBUG MODAL] closeFollowerSchedulerModal CALLED');
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    const modal = document.getElementById('followerSchedulerModal');
    if (modal) {
        modal.classList.remove('active');
        modal.classList.remove('show');
        modal.style.display = 'none';
        console.log('[DEBUG MODAL] #followerSchedulerModal closed');
    }
}
window.closeFollowerSchedulerModal = closeFollowerSchedulerModal;

function openThresholdSettingsModal() {
    const modal = document.getElementById('thresholdSettingsModal');
    if (!modal) return;
    const inputTiktok = document.getElementById('modalThTiktok');
    const inputYoutube = document.getElementById('modalThYoutube');
    const inputFacebook = document.getElementById('modalThFacebook');

    if (inputTiktok) inputTiktok.value = followerThresholds.tiktok || 10000;
    if (inputYoutube) inputYoutube.value = followerThresholds.youtube || 1000;
    if (inputFacebook) inputFacebook.value = followerThresholds.facebook || 1000;

    console.log('[DEBUG MODAL] #thresholdSettingsModal element:', modal);
    modal.classList.add('active');
    modal.classList.add('show');
    modal.style.display = 'flex';

    // Nạp lại giá trị mới nhất từ backend
    fetch('/api/settings/thresholds')
        .then(r => r.json())
        .then(data => {
            console.log('[DEBUG MODAL] thresholds settings received:', data);
            if (data.status === 'success' && data.thresholds) {
                followerThresholds.tiktok = Number(data.thresholds.tiktok) || 10000;
                followerThresholds.youtube = Number(data.thresholds.youtube) || 1000;
                followerThresholds.facebook = Number(data.thresholds.facebook) || 1000;
                if (inputTiktok) inputTiktok.value = followerThresholds.tiktok;
                if (inputYoutube) inputYoutube.value = followerThresholds.youtube;
                if (inputFacebook) inputFacebook.value = followerThresholds.facebook;
            }
        })
        .catch(e => console.warn('[DEBUG MODAL] Lỗi đọc thresholds:', e));
}
window.openThresholdSettingsModal = openThresholdSettingsModal;

function closeThresholdSettingsModal() {
    const modal = document.getElementById('thresholdSettingsModal');
    if (!modal) return;
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
    modal.classList.remove('active');
    modal.classList.remove('show');
    modal.style.display = 'none';
    console.log('[DEBUG MODAL] #thresholdSettingsModal closed');
}
window.closeThresholdSettingsModal = closeThresholdSettingsModal;

async function saveThresholdFromDedicatedModal(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    const inputTiktok = document.getElementById('modalThTiktok');
    const inputYoutube = document.getElementById('modalThYoutube');
    const inputFacebook = document.getElementById('modalThFacebook');

    const thTiktok = Math.max(1, parseInt(inputTiktok ? inputTiktok.value : '10000', 10) || 10000);
    const thYoutube = Math.max(1, parseInt(inputYoutube ? inputYoutube.value : '1000', 10) || 1000);
    const thFacebook = Math.max(1, parseInt(inputFacebook ? inputFacebook.value : '1000', 10) || 1000);

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Lưu...';
    }

    try {
        const res = await fetch('/api/settings/thresholds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                follower_threshold_tiktok: thTiktok,
                follower_threshold_youtube: thYoutube,
                follower_threshold_facebook: thFacebook
            })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            followerThresholds.tiktok = thTiktok;
            followerThresholds.youtube = thYoutube;
            followerThresholds.facebook = thFacebook;

            // Đồng bộ sang các input khác nếu đang hiển thị
            const sT = document.getElementById('settingThresholdTiktok');
            const sY = document.getElementById('settingThresholdYoutube');
            const sF = document.getElementById('settingThresholdFacebook');
            if (sT) sT.value = thTiktok;
            if (sY) sY.value = thYoutube;
            if (sF) sF.value = thFacebook;

            const scT = document.getElementById('schedThresholdTiktok');
            const scY = document.getElementById('schedThresholdYoutube');
            const scF = document.getElementById('schedThresholdFacebook');
            if (scT) scT.value = thTiktok;
            if (scY) scY.value = thYoutube;
            if (scF) scF.value = thFacebook;

            showToast('✅ Đã lưu cấu hình ngưỡng thông báo thành công!', 'success');
            closeThresholdSettingsModal();
            loadGpmProfiles();
        } else {
            showToast('Lỗi lưu ngưỡng: ' + (data.message || 'Thất bại'), 'error');
        }
    } catch (e) {
        showToast('Lỗi kết nối lưu ngưỡng: ' + e.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}
window.saveThresholdFromDedicatedModal = saveThresholdFromDedicatedModal;

async function saveFollowerSchedulerSettings(btn) {
    const enabled = document.getElementById('chkFollowerSchedulerEnable').checked;
    const isDaily = document.getElementById('scanModeDaily').checked;
    const mode = isDaily ? 'daily_times' : 'interval';
    const timesInput = document.getElementById('inputFollowerScanTimes');
    const intervalSelect = document.getElementById('selectFollowerIntervalHours');
    const times = timesInput ? timesInput.value.trim() : '';
    const interval_hours = intervalSelect ? (parseInt(intervalSelect.value, 10) || 6) : 6;

    if (mode === 'daily_times') {
        if (!times) {
            markInputError('inputFollowerScanTimes', 'Vui lòng nhập khung giờ quét (Ví dụ: 08:00, 20:00)!');
            return;
        }
        const timeSlots = times.split(',').map(s => s.trim()).filter(Boolean);
        const badSlot = timeSlots.find(s => !isValidTimeHHMM(s));
        if (badSlot || timeSlots.length === 0) {
            markInputError('inputFollowerScanTimes', `Khung giờ "${badSlot || 'trống'}" không hợp lệ! Định dạng chuẩn: HH:MM (00:00 - 23:59)`);
            return;
        }
    } else {
        if (isNaN(interval_hours) || interval_hours < 1 || interval_hours > 48) {
            markInputError('selectFollowerIntervalHours', 'Chu kỳ quét lặp lại phải từ 1 đến 48 giờ!');
            return;
        }
    }

    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Lưu...';
    }

    const thTiktok = parseInt(document.getElementById('schedThresholdTiktok')?.value, 10) || followerThresholds.tiktok;
    const thYoutube = parseInt(document.getElementById('schedThresholdYoutube')?.value, 10) || followerThresholds.youtube;
    const thFacebook = parseInt(document.getElementById('schedThresholdFacebook')?.value, 10) || followerThresholds.facebook;
    const profileWorkers = Math.max(1, Math.min(10, parseInt(document.getElementById('schedProfileSyncConcurrentWorkers')?.value || '3', 10) || 3));

    try {
        const res = await fetch('/api/settings/follower-scheduler', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: enabled,
                mode: mode,
                times: times,
                interval_hours: interval_hours,
                follower_threshold_tiktok: thTiktok,
                follower_threshold_youtube: thYoutube,
                follower_threshold_facebook: thFacebook,
                profile_sync_concurrent_workers: profileWorkers
            })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            followerThresholds.tiktok = thTiktok;
            followerThresholds.youtube = thYoutube;
            followerThresholds.facebook = thFacebook;
            showToast('✅ Đã lưu cấu hình lịch quét định kỳ thành công!', 'success');
            closeFollowerSchedulerModal();
            loadFollowerSchedulerBadge();
            loadGpmProfiles();
        } else {
            showToast('Lỗi lưu cấu hình: ' + (data.detail || data.message || 'Thất bại'), 'error');
        }
    } catch (err) {
        showToast('Lỗi gửi cài đặt: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}
window.saveFollowerSchedulerSettings = saveFollowerSchedulerSettings;

// 5. Upload Modal
function openUploadModal(videoId, specificPath = null) {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Đăng Video Lên Nick')) {
        return;
    }
    const video = cachedVideos.find(v => v.id == videoId || v.yt_video_id === videoId);
    if (!video) {
        showToast('Không tìm thấy thông tin video!', 'warning');
        return;
    }

    // Xác định đường dẫn file đã render:
    // 1. Đường dẫn cụ thể truyền vào (ví dụ part đang phát trong Studio)
    // 2. Hoặc từ activeStudioVideo nếu trùng khớp
    // 3. Hoặc video.rendered_path
    // 4. Hoặc part đầu tiên trong video.rendered_parts
    let targetPath = specificPath;
    if (!targetPath && typeof activeStudioVideo !== 'undefined' && activeStudioVideo && (activeStudioVideo.id == video.id || activeStudioVideo.yt_video_id == video.yt_video_id)) {
        if (activeStudioVideo.rendered_parts && activeStudioVideo.rendered_parts.length > 0) {
            const currentPart = activeStudioVideo.rendered_parts.find(p => p.part === activePlaybackPart) || activeStudioVideo.rendered_parts[0];
            if (currentPart && currentPart.path) targetPath = currentPart.path;
        }
    }
    if (!targetPath && video.rendered_path) {
        targetPath = video.rendered_path;
    }
    if (!targetPath && video.rendered_parts && video.rendered_parts.length > 0) {
        targetPath = video.rendered_parts[0].path;
    }

    if (!targetPath) {
        showToast('Video chưa được render AI!', 'warning');
        return;
    }

    const select = document.getElementById('modalProfileSelect');
    if (cachedGpmProfiles.length === 0) {
        showToast('Vui lòng đồng bộ danh sách trước!', 'warning');
        return;
    }

    select.innerHTML = cachedGpmProfiles.map(p => {
        const pName = (p.name || `Profile ${p.gpm_id}`).trim();
        const ttUser = p.tiktok_username ? (p.tiktok_username.startsWith('@') ? p.tiktok_username : '@' + p.tiktok_username) : (p.tiktok_nickname || 'Chưa gắn TikTok');
        const fullLabel = `${pName} - ${ttUser}`;
        const maxLen = 42;
        const displayLabel = fullLabel.length > maxLen ? fullLabel.substring(0, maxLen - 3) + '...' : fullLabel;
        return `<option value="${p.gpm_id}" title="${escapeHtml(fullLabel)}">${escapeHtml(displayLabel)}</option>`;
    }).join('');

    document.getElementById('modalVideoPath').value = targetPath;
    document.getElementById('modalVideoTitle').value = video.ai_title || video.title;
    if (video.ai_tags && document.getElementById('modalVideoTags')) {
        document.getElementById('modalVideoTags').value = video.ai_tags;
    }
    document.getElementById('uploadModal').classList.add('active');
}

let _uploadAbortController = null;

async function stopUploadVideo() {
    if (_uploadAbortController) {
        _uploadAbortController.abort();
        _uploadAbortController = null;
    }
    try {
        await fetch('/api/tiktok/upload-stop', { method: 'POST' });
        showToast('🛑 Đã gửi lệnh dừng tiến trình đăng video và đóng trình duyệt!');
    } catch (e) {
        showToast('Lỗi gửi lệnh dừng: ' + e.message, true);
    }
}

function closeUploadModal() {
    if (_uploadAbortController) {
        stopUploadVideo();
    }
    const modal = document.getElementById('uploadModal');
    if (modal) modal.classList.remove('active');
    const btn = document.getElementById('btnConfirmUpload');
    if (btn) {
        btn.removeAttribute('data-running');
        btn.className = 'btn btn-primary';
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Bắt Đầu Đăng Bài';
    }
}

async function executeUploadVideo() {
    if (window.LicenseManager && !window.LicenseManager.requireLicense('Đăng Video Lên TikTok')) {
        return;
    }

    const btn = document.getElementById('btnConfirmUpload');
    if (btn && btn.getAttribute('data-running') === 'true') {
        await stopUploadVideo();
        if (btn) {
            btn.removeAttribute('data-running');
            btn.className = 'btn btn-primary';
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Bắt Đầu Đăng Bài';
        }
        return;
    }

    const profileId = document.getElementById('modalProfileSelect')?.value;
    const videoPath = (document.getElementById('modalVideoPath')?.value || '').trim();
    const title = (document.getElementById('modalVideoTitle')?.value || '').trim();
    const tags = document.getElementById('modalVideoTags')?.value || '';

    if (!profileId) {
        markInputError('modalProfileSelect', 'Vui lòng chọn Profile để đăng video!');
        return;
    }
    if (!videoPath) {
        markInputError('modalVideoPath', 'Đường dẫn video không được để trống!');
        return;
    }
    if (!title) {
        markInputError('modalVideoTitle', 'Vui lòng nhập tiêu đề cho video TikTok!');
        return;
    }

    if (btn) {
        btn.setAttribute('data-running', 'true');
        btn.className = 'btn btn-danger';
        btn.innerHTML = '<i class="fa-solid fa-stop"></i> Dừng Đăng Ngay';
    }

    _uploadAbortController = new AbortController();
    showToast('🚀 Đang mở trình duyệt profile và upload... (Bấm nút Dừng để hủy)');

    try {
        const res = await fetch('/api/tiktok/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gpm_profile_id: profileId,
                video_path: videoPath,
                title: title,
                tags: tags
            }),
            signal: _uploadAbortController.signal
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast('✅ Đã thực hiện xong lệnh đăng video lên TikTok!', 'success');
            closeUploadModal();
        } else {
            showToast('Lỗi: ' + (data.detail || data.message || 'Không thể đăng video'), 'error');
        }
    } catch (err) {
        if (err.name === 'AbortError') {
            showToast('🛑 Đã hủy tiến trình đăng video!', 'warning');
        } else {
            showToast('Lỗi kết nối upload: ' + err.message, 'error');
        }
    } finally {
        _uploadAbortController = null;
        if (btn) {
            btn.removeAttribute('data-running');
            btn.className = 'btn btn-primary';
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Bắt Đầu Đăng Bài';
        }
    }
}


// Gửi Báo Cáo Hoạt Động Hàng Ngày Ngay Lập Tức
async function testDailyReportNow(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Gửi...';
    }
    showToast('Đang tạo và gửi Báo cáo hoạt động ngày tới các kênh Telegram...');
    try {
        const res = await fetch('/api/telegram/send-daily-report', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            showToast(`✅ ${data.message || 'Đã gửi Báo cáo hoạt động ngày thành công!'}`, 'success');
        } else {
            showToast('⚠️ ' + (data.message || 'Lỗi gửi báo cáo ngày'), true);
        }
    } catch (err) {
        showToast('Lỗi gửi Telegram: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// Gửi Cảnh Báo Sự Cố Thử Nghiệm Kèm Hướng Dẫn Khắc Phục
async function testIssueAlertNow(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang Gửi...';
    }
    showToast('Đang gửi cảnh báo lỗi kèm cách khắc phục thử nghiệm...');
    try {
        const res = await fetch('/api/telegram/test-issue-alert', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
            showToast(`✅ ${data.message || 'Đã gửi cảnh báo lỗi thành công!'}`, 'success');
        } else {
            showToast('⚠️ ' + (data.message || 'Lỗi gửi cảnh báo lỗi'), true);
        }
    } catch (err) {
        showToast('Lỗi gửi Telegram: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// Bắn cảnh báo sự cố từ System Diagnostics qua Telegram
async function sendDiagnosticsIssueAlertToTelegram(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi...';
    }
    try {
        const res = await fetch('/api/system/diagnostics');
        const diag = await res.json();
        const actionItems = diag.action_items || [];
        if (actionItems.length === 0) {
            showToast('🎉 Hệ thống hoạt động hoàn hảo! Không có sự cố nào để cảnh báo.', 'success');
            return;
        }

        const firstErr = actionItems.find(i => i.type === 'error') || actionItems[0];
        const payload = {
            title: `Sự cố phát hiện từ Chẩn Đoán Hệ Thống: ${firstErr.title || firstErr.category}`,
            message: firstErr.message || 'Phát hiện sự cố phần mềm phụ thuộc hoặc cấu hình môi trường.',
            solution: firstErr.message || 'Xem chi tiết hướng dẫn sửa trong tab Chẩn Đoán Hệ Thống.',
            severity: firstErr.type === 'error' ? 'HIGH' : 'WARNING',
            details: `Danh mục: ${firstErr.category || 'Môi trường'} | Tổng số lưu ý: ${actionItems.length}`
        };

        const postRes = await fetch('/api/telegram/send-issue-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const postData = await postRes.json();
        if (postRes.ok && postData.status === 'success') {
            showToast('✅ Đã bắn cảnh báo lỗi chẩn đoán qua Telegram thành công!', 'success');
        } else {
            showToast('⚠️ ' + (postData.message || 'Không thể gửi cảnh báo Telegram'), true);
        }
    } catch (err) {
        showToast('Lỗi gửi Telegram: ' + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// Utility
function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.toString().replace(/[&<>"']/g, m => map[m]);
}





// Tự động vô hiệu hóa (disable) và làm mờ các nick trùng lặp trên các trình duyệt khác nhau khi 1 nick đã được chọn
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
                noteBadge.innerHTML = `<i class="fa-solid fa-lock"></i> Đã chọn qua ${escapeHtml(source.browserLabel)} (${escapeHtml(source.profileName)})`;
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

    if (isNew) updateSelectedGpmCount();
    else updateEditSelectedGpmCount();
}
window.syncCampaignDuplicateCheckboxes = syncCampaignDuplicateCheckboxes;

// Module Window Exposures
window.closeUploadModal = closeUploadModal;
window.openUploadModal = openUploadModal;
window.executeUploadVideo = executeUploadVideo;
window.stopUploadVideo = stopUploadVideo;
window.saveProfileUsernameFromModal = saveProfileUsernameFromModal;
window.sendDiagnosticsIssueAlertToTelegram = sendDiagnosticsIssueAlertToTelegram;
window.testDailyReportNow = testDailyReportNow;
window.testIssueAlertNow = testIssueAlertNow;
window.toggleFollowerScanModeUI = toggleFollowerScanModeUI;
window.syncCampaignDuplicateCheckboxes = syncCampaignDuplicateCheckboxes;
window.scanSingleChannelFollowers = scanSingleChannelFollowers;
window.scanSingleProfileFollowers = scanSingleProfileFollowers;
window.scanAllProfilesFollowers = scanAllProfilesFollowers;
window.stopAllProfilesScan = stopAllProfilesScan;
window.checkScanProgress = checkScanProgress;
window.loadGpmProfiles = loadGpmProfiles;
window.debouncedRenderGpmProfilesTable = debouncedRenderGpmProfilesTable;
window.renderGpmProfilesTable = renderGpmProfilesTable;
window.openEditUsernameModal = openEditUsernameModal;
window.closeEditUsernameModal = closeEditUsernameModal;
window.openEditChannelModal = openEditChannelModal;
window.openThresholdSettingsModal = openThresholdSettingsModal;
window.closeThresholdSettingsModal = closeThresholdSettingsModal;
window.saveThresholdFromDedicatedModal = saveThresholdFromDedicatedModal;
window.openFollowerSchedulerModal = openFollowerSchedulerModal;
window.closeFollowerSchedulerModal = closeFollowerSchedulerModal;
window.saveFollowerSchedulerSettings = saveFollowerSchedulerSettings;
window.loadFollowerSchedulerBadge = loadFollowerSchedulerBadge;
window.setProfileNotifyStatus = setProfileNotifyStatus;
window.cycleProfileNotifyStatus = cycleProfileNotifyStatus;
window.setChannelNotifyStatus = setChannelNotifyStatus;
window.cycleChannelNotifyStatus = cycleChannelNotifyStatus;
window.deleteGpmProfileFromList = deleteGpmProfileFromList;
window.deleteChannelFromList = deleteChannelFromList;
window.deleteSubChannel = deleteSubChannel;
window.setDefaultChannel = setDefaultChannel;
window.toggleSubChannels = toggleSubChannels;
window.syncProfileChannels = syncProfileChannels;
window.scanCurrentEditProfile = scanCurrentEditProfile;
window.deleteCurrentEditProfile = deleteCurrentEditProfile;
window.exportGpmProfilesCsv = exportGpmProfilesCsv;
window.resetGpmFilters = resetGpmFilters;
window.handleGpmSortChange = handleGpmSortChange;
window.toggleGpmSortDirection = toggleGpmSortDirection;
window.handleGpmHeaderSort = handleGpmHeaderSort;
window.updateEditProfileModalLabels = updateEditProfileModalLabels;
window.onEditProfilePlatformChange = onEditProfilePlatformChange;
function goToGpmProfilesPage(page) {
    gpmCurrentPage = page;
    renderGpmProfilesTable();
}

function changeGpmProfilesPageSize(size) {
    gpmPageSize = parseInt(size, 10) || 20;
    gpmCurrentPage = 1;
    renderGpmProfilesTable();
}

window.goToGpmProfilesPage = goToGpmProfilesPage;
window.changeGpmProfilesPageSize = changeGpmProfilesPageSize;
window.openUploadModal = openUploadModal;
window.closeUploadModal = closeUploadModal;
window.executeUploadVideo = executeUploadVideo;
window.stopUploadVideo = stopUploadVideo;

// Thay đổi IP trực tiếp từ ô dropdown trong bảng
async function onTableIpChange(gpmId, selectedIpKey) {
    const p = (cachedGpmProfiles || []).find(item => item.gpm_id === gpmId);
    const ipSel = document.getElementById(`cellProxyIp_${gpmId}`);
    const countryBadge = document.getElementById(`cellCountry_${gpmId}`);

    if (!selectedIpKey) {
        if (p) {
            p.raw_proxy = '';
            p.country = 'NONE';
        }
        if (countryBadge) {
            countryBadge.textContent = '🌐 Direct';
            countryBadge.style.background = 'rgba(100, 116, 139, 0.12)';
            countryBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
            countryBadge.style.color = '#94a3b8';
        }
        if (ipSel) {
            ipSel.style.background = 'rgba(100, 116, 139, 0.15)';
            ipSel.style.borderColor = 'rgba(148, 163, 184, 0.35)';
            ipSel.style.color = '#94a3b8';
        }
    } else {
        const item = (cachedProxyPool || []).find(pi => pi.key === selectedIpKey);
        if (item) {
            if (p) {
                p.raw_proxy = item.raw_proxy_url || item.raw_proxy;
                p.country = item.country;
            }
            if (countryBadge) {
                const cName = item.country_name || (item.country === 'ID' ? 'Indonesia' : (item.country === 'MX' ? 'Mexico' : item.country));
                countryBadge.textContent = `[${item.country}] ${cName}`;
                countryBadge.style.background = 'rgba(56, 189, 248, 0.12)';
                countryBadge.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                countryBadge.style.color = '#38bdf8';
            }
            if (ipSel) {
                ipSel.style.background = 'rgba(56, 189, 248, 0.12)';
                ipSel.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                ipSel.style.color = '#38bdf8';
            }
        }
    }

    try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(gpmId)}/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy: selectedIpKey || 'NONE' })
        });
        const data = await res.json();
        if (data.success) {
            if (countryBadge && data.country) {
                const cName = data.country === 'ID' ? 'Indonesia' : (data.country === 'MX' ? 'Mexico' : (data.country_name || data.country));
                countryBadge.textContent = data.country === 'NONE' ? '🌐 Direct' : `[${data.country}] ${cName}`;
            }
            if (p && data.proxy_url !== undefined) {
                p.raw_proxy = data.proxy_url;
                p.country = data.country;
            }
            if (!selectedIpKey) {
                showToast(`🌐 Đã chuyển profile sang mạng trực tiếp (Direct IP)`, 'info');
            } else {
                showToast(`⚡ Đã gán IP ${data.ip || selectedIpKey} (${data.flag || ''} ${data.country || ''}) cho profile!`, 'success');
            }
        } else {
            showToast(data.detail || data.error || 'Lỗi gán proxy', 'error');
        }
    } catch (err) {
        showToast('Lỗi cập nhật proxy: ' + err.message, 'error');
    }
}

// Thay đổi quốc gia trực tiếp từ ô dropdown trong bảng
async function onTableCountryChange(gpmId, newCountry) {
    const cTarget = (newCountry || 'NONE').toUpperCase();
    const p = (cachedGpmProfiles || []).find(item => item.gpm_id === gpmId);
    if (p) p.country = cTarget;

    const countrySel = document.getElementById(`cellCountry_${gpmId}`);
    const ipSel = document.getElementById(`cellProxyIp_${gpmId}`);

    if (countrySel) {
        const isNone = cTarget === 'NONE';
        countrySel.style.background = isNone ? 'rgba(100, 116, 139, 0.15)' : 'rgba(56, 189, 248, 0.12)';
        countrySel.style.borderColor = isNone ? 'rgba(148, 163, 184, 0.35)' : 'rgba(56, 189, 248, 0.4)';
        countrySel.style.color = isNone ? '#94a3b8' : '#38bdf8';
    }

    try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(gpmId)}/country`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ country: cTarget })
        });
        const data = await res.json();

        if (cTarget === 'NONE') {
            if (p) p.raw_proxy = '';
            if (ipSel) {
                ipSel.value = '';
                ipSel.style.background = 'rgba(100, 116, 139, 0.15)';
                ipSel.style.borderColor = 'rgba(148, 163, 184, 0.35)';
                ipSel.style.color = '#94a3b8';
            }
            showToast(`🌐 Đã gỡ bỏ Proxy cho profile (Direct IP)`, 'info');
        } else if (data.proxy_url) {
            if (p) p.raw_proxy = data.proxy_url;
            const newKey = getProfileIpKey(data.proxy_url);
            if (ipSel && newKey) {
                ipSel.value = newKey;
                ipSel.style.background = 'rgba(56, 189, 248, 0.12)';
                ipSel.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                ipSel.style.color = '#38bdf8';
            }
            showToast(`⚡ Đã đổi quốc gia sang [${cTarget}] & gán IP ${newKey || data.proxy_url}!`, 'success');
        } else {
            showToast(`✅ Đã lưu quốc gia [${cTarget}] cho profile!`, 'success');
        }
    } catch (err) {
        showToast('Lỗi lưu quốc gia: ' + err.message, 'error');
    }
}

// ==========================================
// QUẢN LÝ CHECKBOX MULTI-PAGE & BULK ACTIONS
// ==========================================

function toggleSelectProfile(gpmId, isChecked) {
    if (isChecked) {
        selectedProfileIds.add(gpmId);
    } else {
        selectedProfileIds.delete(gpmId);
    }
    // Cập nhật giao diện thanh tác vụ hàng loạt & header checkbox
    syncSelectionUiState();
}

function toggleSelectAllCurrentPageGpm(isChecked) {
    const checkboxes = document.querySelectorAll('.gpm-profile-checkbox');
    checkboxes.forEach(cb => {
        const gid = cb.getAttribute('data-gpm-id');
        cb.checked = isChecked;
        if (gid) {
            if (isChecked) selectedProfileIds.add(gid);
            else selectedProfileIds.delete(gid);
        }
    });
    syncSelectionUiState();
}

function selectAllFilteredGpmProfiles() {
    const list = getCurrentlyFilteredGpmProfiles();
    list.forEach(p => {
        if (p.gpm_id) selectedProfileIds.add(p.gpm_id);
    });
    // Check lại tất cả checkbox đang hiển thị trên trang hiện tại
    document.querySelectorAll('.gpm-profile-checkbox').forEach(cb => {
        cb.checked = true;
    });
    syncSelectionUiState();
    showToast(`✅ Đã chọn tất cả ${selectedProfileIds.size} tài khoản qua mọi trang!`, 'info');
}

function clearGpmProfileSelection() {
    selectedProfileIds.clear();
    document.querySelectorAll('.gpm-profile-checkbox').forEach(cb => {
        cb.checked = false;
    });
    const chkAll = document.getElementById('chkGpmSelectAll');
    if (chkAll) {
        chkAll.checked = false;
        chkAll.indeterminate = false;
    }
    syncSelectionUiState();
}

function syncSelectionUiState() {
    const bulkBar = document.getElementById('gpmBulkActionBar');
    const badge = document.getElementById('selectedProfilesCountBadge');
    const totalAcross = document.getElementById('totalFilterableCount');
    const chkAll = document.getElementById('chkGpmSelectAll');

    const filtered = getCurrentlyFilteredGpmProfiles();
    if (totalAcross) totalAcross.textContent = filtered.length;

    const size = selectedProfileIds.size;
    if (badge) badge.textContent = `Đã chọn: ${size} profile`;

    if (bulkBar) {
        bulkBar.style.display = size > 0 ? 'flex' : 'none';
    }

    if (chkAll) {
        const pageCheckboxes = Array.from(document.querySelectorAll('.gpm-profile-checkbox'));
        if (pageCheckboxes.length > 0) {
            const allChecked = pageCheckboxes.every(cb => cb.checked);
            const someChecked = pageCheckboxes.some(cb => cb.checked);
            chkAll.checked = allChecked;
            chkAll.indeterminate = !allChecked && someChecked;
        } else {
            chkAll.checked = false;
            chkAll.indeterminate = false;
        }
    }
}

function updateBulkActionBar(filteredList, pagedList) {
    syncSelectionUiState();
}

function getCurrentlyFilteredGpmProfiles() {
    const filterGroup = document.getElementById('filterGpmGroup')?.value || 'ALL';
    const filterCampaign = document.getElementById('filterGpmCampaign')?.value || 'ALL';
    const filterCountry = (document.getElementById('filterGpmCountry')?.value || 'ALL').toUpperCase();
    const filterIp = document.getElementById('filterGpmIp')?.value || 'ALL';
    const filterBeta = document.getElementById('filterGpmBeta')?.value || 'ALL';
    const filterCreatorProgram = document.getElementById('filterGpmCreatorProgram')?.value || 'ALL';
    const filterFlop = document.getElementById('filterGpmFlop')?.value || 'ALL';
    const keyword = (document.getElementById('searchGpmKeyword') ? document.getElementById('searchGpmKeyword').value : '').trim().toLowerCase();

    return (cachedGpmProfiles || []).filter(p => {
        if ((p.platform || 'tiktok').toLowerCase() !== 'tiktok') return false;
        if (filterGroup !== 'ALL') {
            const grp = getProfileGroupName(p).trim().toLowerCase();
            if (filterGroup === 'UNGROUPED') {
                if (grp) return false;
            } else {
                if (grp !== filterGroup.toLowerCase()) return false;
            }
        }
        if (filterCampaign !== 'ALL') {
            const cList = (p.campaign_names || []).concat(p.campaign_name ? [p.campaign_name] : []);
            if (filterCampaign === 'UNASSIGNED') {
                if (cList.length > 0) return false;
            } else {
                if (!cList.some(cn => (cn || '').trim().toLowerCase() === filterCampaign.toLowerCase())) return false;
            }
        }
        if (filterCountry !== 'ALL') {
            const pCountry = (p.country || '').toUpperCase();
            if (filterCountry === 'NONE') {
                if (pCountry && pCountry !== 'NONE') return false;
            } else {
                if (pCountry !== filterCountry) return false;
            }
        }
        if (filterBeta === 'ELIGIBLE' && !isProfileEligible(p)) return false;
        if (filterBeta === 'INELIGIBLE' && isProfileEligible(p)) return false;
        if (keyword) {
            const matchName = (p.name || '').toLowerCase().includes(keyword);
            const matchUsername = (p.tiktok_username || '').toLowerCase().includes(keyword);
            const matchProxy = (p.raw_proxy || '').toLowerCase().includes(keyword);
            if (!matchName && !matchUsername && !matchProxy) return false;
        }
        return true;
    });
}

// ==========================================
// MODAL GÁN PROXY / IP HÀNG LOẠT
// ==========================================

function openBulkAssignProxyModal() {
    if (selectedProfileIds.size === 0) {
        showToast('Vui lòng tích chọn ít nhất 1 tài khoản để gán IP hàng loạt!', 'warning');
        return;
    }
    const modal = document.getElementById('bulkAssignProxyModal');
    if (!modal) return;
    const cntEl = document.getElementById('bulkModalSelectedCount');
    if (cntEl) cntEl.textContent = selectedProfileIds.size;

    const totalEl = document.getElementById('bulkIpTotalAvailable');
    if (totalEl) totalEl.textContent = `${(cachedProxyPool || []).length} IP khả dụng`;

    const btnSubmit = document.getElementById('btnSubmitBulkProxy');
    if (btnSubmit) {
        btnSubmit.innerHTML = `<i class="fa-solid fa-check"></i> Xác Nhận Gán Cho ${selectedProfileIds.size} Nick`;
    }

    // Nạp danh sách IP vào dropdown
    const ipSel = document.getElementById('bulkSelectIp');
    if (ipSel) {
        const directOpt = `<option value="DIRECT">🌐 Direct (Mạng Trực Tiếp - Không Dùng Proxy)</option>`;
        const proxyOpts = (cachedProxyPool || []).map(p => {
            const statusTag = p.status === 'blocked' ? ' [Bị Chặn]' : '';
            const countryName = p.country_name || p.country;
            const city = p.city ? ` - ${p.city}` : '';
            return `<option value="${p.key}">[${p.country}] ${p.key} (${countryName}${city})${statusTag}</option>`;
        }).join('');

        ipSel.innerHTML = directOpt + proxyOpts;
        // Nếu có IP trong pool thì chọn IP đầu tiên, nếu không thì chọn DIRECT
        if (cachedProxyPool && cachedProxyPool.length > 0) {
            ipSel.value = cachedProxyPool[0].key;
        } else {
            ipSel.value = 'DIRECT';
        }
    }

    updateBulkIpPreview(ipSel ? ipSel.value : 'DIRECT');
    modal.style.display = 'flex';
}

function closeBulkAssignProxyModal() {
    const modal = document.getElementById('bulkAssignProxyModal');
    if (modal) modal.style.display = 'none';
}

function updateBulkIpPreview(key) {
    const cntryEl = document.getElementById('bulkPreviewCountry');
    const cityEl = document.getElementById('bulkPreviewCity');
    const statEl = document.getElementById('bulkPreviewStatus');
    const assignEl = document.getElementById('bulkPreviewAssigned');

    if (key === 'DIRECT' || !key) {
        if (cntryEl) cntryEl.innerHTML = '🌐 Direct IP (Không Proxy)';
        if (cityEl) cityEl.textContent = 'Mạng LAN / Internet Máy Tính';
        if (statEl) statEl.innerHTML = '<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8;">Trực tiếp</span>';
        const directCount = (cachedGpmProfiles || []).filter(p => !p.raw_proxy || p.raw_proxy === '' || p.country === 'NONE').length;
        if (assignEl) assignEl.textContent = `${directCount} tài khoản`;
        return;
    }

    const item = (cachedProxyPool || []).find(p => p.key === key);
    if (!item) return;

    if (cntryEl) {
        const flag = item.flag || '🌐';
        const cname = item.country_name || item.country;
        cntryEl.innerHTML = `${flag} <strong>${cname}</strong> <span style="color:var(--text-muted); font-size:11px;">(${item.country})</span>`;
    }
    if (cityEl) {
        cityEl.textContent = item.city || 'Chưa xác định';
    }
    if (statEl) {
        if (item.status === 'blocked') {
            statEl.innerHTML = '<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> Bị chặn</span>';
        } else {
            const ping = item.latency_ms ? ` (${item.latency_ms}ms)` : '';
            statEl.innerHTML = `<span class="badge" style="background:rgba(34,197,94,0.15); color:#4ade80;"><i class="fa-solid fa-circle-check"></i> Sẵn sàng${ping}</span>`;
        }
    }
    if (assignEl) {
        assignEl.textContent = `${item.assigned_profiles || 0} tài khoản đang dùng`;
    }
}

async function executeBulkAssignProxy() {
    if (selectedProfileIds.size === 0) {
        showToast('Chưa chọn tài khoản nào!', 'warning');
        return;
    }
    const selectedIp = document.getElementById('bulkSelectIp')?.value || 'DIRECT';
    const isDirect = selectedIp === 'DIRECT';
    const mode = isDirect ? 'direct' : 'specific_ip';
    const target_value = isDirect ? '' : selectedIp;

    const btn = document.getElementById('btnSubmitBulkProxy');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gán IP...';
    }

    try {
        const res = await fetch('/api/gpm/bulk-assign-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gpm_ids: Array.from(selectedProfileIds),
                mode: mode,
                target_value: target_value
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ ${data.message || 'Đã gán IP thành công!'}`, 'success');
            closeBulkAssignProxyModal();
            await loadProxyPool();
            await loadGpmProfiles();
        } else {
            showToast(data.detail || data.error || 'Lỗi gán IP hàng loạt', 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml || '<i class="fa-solid fa-check"></i> Xác Nhận Gán IP';
        }
    }
}

async function bulkRemoveProxyDirect() {
    if (selectedProfileIds.size === 0) {
        showToast('Vui lòng chọn ít nhất 1 tài khoản để gỡ proxy!', 'warning');
        return;
    }
    if (!confirm(`Bạn có chắc chắn muốn gỡ bỏ proxy cho ${selectedProfileIds.size} tài khoản đã chọn?\nCác tài khoản này sẽ chuyển về dùng mạng trực tiếp (Direct IP).`)) {
        return;
    }

    try {
        const res = await fetch('/api/gpm/bulk-assign-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                gpm_ids: Array.from(selectedProfileIds),
                mode: 'direct'
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`🌐 Đã chuyển ${data.assigned || selectedProfileIds.size} tài khoản về mạng trực tiếp (Direct IP)!`, 'info');
            await loadGpmProfiles();
        } else {
            showToast(data.detail || data.error || 'Lỗi gỡ proxy', 'error');
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
    }
}

// ==========================================
// QUẢN LÝ MODAL IP PROXY POOL & STATUS
// ==========================================

async function openWireguardStatusModal() {
    const modal = document.getElementById('wireguardStatusModal');
    if (modal) modal.style.display = 'flex';
    await loadWireguardStatus();
}

function closeWireguardStatusModal() {
    const modal = document.getElementById('wireguardStatusModal');
    if (modal) modal.style.display = 'none';
}

async function loadWireguardStatus() {
    const tableBody = document.getElementById('wireguardProxyTableBody');
    const summarySpan = document.getElementById('wireguardActiveSummary');
    const badgesDiv = document.getElementById('proxySummaryBadges');
    const footerInfo = document.getElementById('wireguardModalFooterInfo');
    if (!tableBody) return;

    try {
        const res = await fetch('/api/proxy/summary?_t=' + Date.now());
        const data = await res.json();
        cachedProxySummary = data;
        const proxies = data.proxies || [];
        cachedProxyPool = proxies;
        cachedProxyCountries = data.countries || [];

        const total = data.total_proxies || 0;
        const active = data.active_count || 0;
        const blocked = data.blocked_count || 0;

        if (summarySpan) {
            summarySpan.innerHTML = `<strong>${total} IP</strong> trong kho`;
        }
        if (badgesDiv) {
            badgesDiv.innerHTML = `
                <span class="badge" style="background:rgba(34,197,94,0.18); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-size:11.5px; font-weight:700;">
                    <i class="fa-solid fa-circle-check"></i> ${active} Hoạt Động
                </span>
                ${blocked > 0 ? `
                <span class="badge" style="background:rgba(239,68,68,0.18); color:#f87171; border:1px solid rgba(239,68,68,0.3); font-size:11.5px; font-weight:700;">
                    <i class="fa-solid fa-circle-xmark"></i> ${blocked} Bị Chặn
                </span>` : ''}
                <span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); font-size:11.5px; font-weight:700;">
                    <i class="fa-solid fa-earth-americas"></i> ${cachedProxyCountries.length} Quốc Gia
                </span>
            `;
        }
        if (footerInfo) {
            footerInfo.textContent = `Tự động nạp từ thư mục data/vpn_configs/ (${total} IP khả dụng)`;
        }

        renderProxyModalRows(proxies);
    } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:15px; color:#ef4444;">Lỗi tải dữ liệu: ${err.message}</td></tr>`;
    }
}

function renderProxyModalRows(proxies) {
    const tableBody = document.getElementById('wireguardProxyTableBody');
    if (!tableBody) return;

    if (!proxies || proxies.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 28px; color: var(--text-muted);">
                    <i class="fa-solid fa-folder-open" style="font-size:24px; margin-bottom:8px; display:block; opacity:0.5;"></i>
                    Chưa có IP Proxy nào trong thư mục <code>data/vpn_configs/</code>.<br>
                    Hãy mở thư mục và thả file <code>Webshare 20 proxies.txt</code> vào đây!
                </td>
            </tr>
        `;
        return;
    }

    let rowsHtml = '';
    proxies.forEach(item => {
        const flag = item.flag || '🌐';
        const cName = item.country_name || item.country || 'Unknown';
        const city = item.city ? `(${item.city})` : '';
        const isBlocked = item.status === 'blocked';
        const isActive = item.status === 'active';

        let statusBadge = '';
        if (isActive) {
            statusBadge = `<span class="badge" style="background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.3); font-weight:700; font-size:11px; padding:3px 8px; white-space:nowrap;"><i class="fa-solid fa-circle-check"></i> Hoạt Động</span>`;
        } else if (isBlocked) {
            const errTooltip = escapeHtml(item.error_message || 'IP bị lỗi hoặc đóng cổng');
            statusBadge = `<span class="badge has-tooltip tooltip-top" data-tooltip="${errTooltip}" style="background:rgba(239,68,68,0.18); color:#ef4444; border:1px solid rgba(239,68,68,0.35); font-weight:700; font-size:11px; padding:3px 8px; white-space:nowrap; cursor:pointer;"><i class="fa-solid fa-ban"></i> Bị Chặn</span>`;
        } else {
            statusBadge = `<span class="badge" style="background:rgba(148,163,184,0.15); color:#94a3b8; font-weight:600; font-size:11px; padding:3px 8px; white-space:nowrap;"><i class="fa-solid fa-clock"></i> Chưa test</span>`;
        }

        let latencyHtml = '—';
        if (item.latency_ms > 0) {
            const latColor = item.latency_ms < 500 ? '#4ade80' : item.latency_ms < 1200 ? '#fbbf24' : '#f87171';
            latencyHtml = `<span style="font-weight:700; color:${latColor}; font-family:monospace;">${item.latency_ms} ms</span>`;
        }

        const assignedCnt = item.assigned_count || 0;
        const assignBadge = assignedCnt > 0 
            ? `<span class="badge" style="background:rgba(56,189,248,0.15); color:#38bdf8; font-weight:700; font-size:11px;">${assignedCnt} nick</span>`
            : `<span class="text-muted" style="font-size:11px; opacity:0.6;">0 nick</span>`;

        rowsHtml += `
            <tr id="row-proxy-${escapeHtml(item.key).replace(/[^a-zA-Z0-9_-]/g, '_')}" style="border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                <td style="padding: 10px 14px; font-family: monospace; font-size: 13px; color: var(--accent-cyan); font-weight:600; vertical-align: middle; white-space: nowrap;">
                    <i class="fa-solid fa-server" style="font-size:11px; margin-right:5px; opacity:0.7;"></i>
                    <span>${escapeHtml(item.key)}</span>
                    <button type="button" class="btn btn-sm" onclick="copyTextToClipboard('${escapeHtml(item.key)}', 'Đã copy IP!')" title="Sao chép IP:Port" style="padding:1px 5px; margin-left:4px; opacity:0.5; background:none; border:none; color:inherit; cursor:pointer;">
                        <i class="fa-regular fa-copy" style="font-size:11px;"></i>
                    </button>
                </td>
                <td style="padding: 10px 14px; color:#fff; vertical-align: middle; white-space: nowrap;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="font-size:16px;">${flag}</span>
                        <div>
                            <strong style="font-size:12.5px;">${escapeHtml(cName)} (${escapeHtml(item.country)})</strong>
                            ${city ? `<div style="font-size:11px; color:var(--text-muted);">${escapeHtml(city)}</div>` : ''}
                        </div>
                    </div>
                </td>
                <td style="padding: 10px 14px; color: var(--text-muted); font-size: 11.5px; vertical-align: middle;">
                    <span class="badge" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); font-size:10.5px; color:#94a3b8;">
                        ${item.source_file ? escapeHtml(item.source_file) : 'Static Residential'}
                    </span>
                </td>
                <td style="padding: 10px 14px; text-align: center; vertical-align: middle;">
                    ${assignBadge}
                </td>
                <td style="padding: 10px 14px; text-align: center; vertical-align: middle;">
                    ${latencyHtml}
                </td>
                <td style="padding: 10px 14px; text-align: center; vertical-align: middle;">
                    ${statusBadge}
                </td>
                <td style="padding: 10px 14px; text-align: center; vertical-align: middle; white-space: nowrap;">
                    <button type="button" class="btn btn-sm btn-secondary has-tooltip tooltip-top" onclick="testSingleProxyInModal('${escapeHtml(item.key)}', this)" data-tooltip="Kiểm tra kết nối và độ trễ IP này" style="padding:3px 8px; font-size:11px; font-weight:600;">
                        <i class="fa-solid fa-bolt text-warning"></i> Test
                    </button>
                </td>
            </tr>
        `;
    });
    tableBody.innerHTML = rowsHtml;
}

function filterProxiesInModal(keyword) {
    if (!cachedProxySummary || !cachedProxySummary.proxies) return;
    const kw = (keyword || '').trim().toLowerCase();
    if (!kw) {
        renderProxyModalRows(cachedProxySummary.proxies);
        return;
    }
    const filtered = cachedProxySummary.proxies.filter(p => {
        return (
            (p.key || '').toLowerCase().includes(kw) ||
            (p.country || '').toLowerCase().includes(kw) ||
            (p.country_name || '').toLowerCase().includes(kw) ||
            (p.city || '').toLowerCase().includes(kw) ||
            (p.status || '').toLowerCase().includes(kw)
        );
    });
    renderProxyModalRows(filtered);
}

async function testSingleProxyInModal(proxyKey, btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-warning"></i>';
    }

    try {
        const res = await fetch(`/api/proxy/test/${encodeURIComponent(proxyKey)}`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ [${proxyKey}] Hoạt động tốt (${data.country}): ${data.latency_ms}ms`, 'success');
        } else {
            showToast(`❌ [${proxyKey}] Bị chặn / Lỗi: ${data.error || 'Timeout'}`, 'warning');
        }
        await loadWireguardStatus();
    } catch (err) {
        showToast('Lỗi test proxy: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml || '<i class="fa-solid fa-bolt text-warning"></i> Test';
        }
    }
}

async function testAllProxiesInModal(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang test...';
    }
    showToast('🔄 Đang kiểm tra toàn bộ IP proxy trong kho...', 'info');

    try {
        const res = await fetch('/api/proxy/test-all?background=false', { method: 'POST' });
        const data = await res.json();
        showToast(`✅ Hoàn tất kiểm tra: ${data.active_count || 0} Hoạt Động, ${data.blocked_count || 0} Bị Chặn`, 'success');
        await loadWireguardStatus();
    } catch (err) {
        showToast('Lỗi kiểm tra toàn bộ: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml || '<i class="fa-solid fa-bolt"></i> Kiểm Tra Tất Cả IP';
        }
    }
}

async function openWireguardFolderOnWindows() {
    try {
        await fetch('/api/vpn/wireproxy/open-folder', { method: 'POST' });
        showToast('📁 Đã mở thư mục data/vpn_configs trên máy tính', 'info');
    } catch (err) {
        showToast('Không thể mở thư mục: ' + err.message, 'error');
    }
}

async function rescanWireguardConfigs(btn) {
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét...';
    }
    showToast('🔄 Đang nạp lại danh sách file IP proxy và WireGuard...', 'info');

    try {
        await fetch('/api/proxy/rescan', { method: 'POST' });
        await fetch('/api/vpn/wireproxy/rescan', { method: 'POST' });
        showToast('✅ Đã nạp lại toàn bộ file proxy thành công!', 'success');
        await loadWireguardStatus();
        await loadProxyPool();
    } catch (err) {
        showToast('Lỗi quét lại: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml || '<i class="fa-solid fa-arrows-rotate"></i> Quét Lại File';
        }
    }
}

async function testWireguardCountry(country, btn) {
    testSingleProxyInModal(country, btn);
}

async function deleteWireguardConfig(proxyId, sourceFile) {
    const fileName = sourceFile || proxyId;
    if (!confirm(`Bạn có chắc muốn xoá file proxy "${fileName}" không?`)) {
        return;
    }
    try {
        const res = await fetch(`/api/vpn/wireproxy/${encodeURIComponent(proxyId)}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
            showToast(`🗑️ Đã xoá proxy "${fileName}" thành công!`, 'success');
            await loadWireguardStatus();
        } else {
            showToast(`Lỗi xoá proxy: ${data.detail || data.error || 'Không xác định'}`, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối khi xoá proxy: ' + err.message, 'error');
    }
}

// Window exports
window.onTableIpChange = onTableIpChange;
window.onTableCountryChange = onTableCountryChange;
window.onFilterCountryChange = onFilterCountryChange;
window.populateDynamicIpFilters = populateDynamicIpFilters;
window.toggleSelectProfile = toggleSelectProfile;
window.toggleSelectAllCurrentPageGpm = toggleSelectAllCurrentPageGpm;
window.selectAllFilteredGpmProfiles = selectAllFilteredGpmProfiles;
window.clearGpmProfileSelection = clearGpmProfileSelection;
window.openBulkAssignProxyModal = openBulkAssignProxyModal;
window.closeBulkAssignProxyModal = closeBulkAssignProxyModal;
window.updateBulkIpPreview = updateBulkIpPreview;
window.executeBulkAssignProxy = executeBulkAssignProxy;
window.bulkRemoveProxyDirect = bulkRemoveProxyDirect;
window.openWireguardStatusModal = openWireguardStatusModal;
window.closeWireguardStatusModal = closeWireguardStatusModal;
window.loadWireguardStatus = loadWireguardStatus;
window.filterProxiesInModal = filterProxiesInModal;
window.testSingleProxyInModal = testSingleProxyInModal;
window.testAllProxiesInModal = testAllProxiesInModal;
window.openWireguardFolderOnWindows = openWireguardFolderOnWindows;
window.rescanWireguardConfigs = rescanWireguardConfigs;
window.testWireguardCountry = testWireguardCountry;
window.deleteWireguardConfig = deleteWireguardConfig;

// ==========================================
// 6. PROFILE DETAIL MODAL (MODAL CHI TIẾT PROFILE)
// ==========================================

let activeDetailGpmId = null;

const countryDisplayMap = {
    'US': { flag: '🇺🇸', name: 'Hoa Kỳ' },
    'GB': { flag: '🇬🇧', name: 'Vương Quốc Anh' },
    'UK': { flag: '🇬🇧', name: 'Vương Quốc Anh' },
    'DE': { flag: '🇩🇪', name: 'Đức' },
    'FR': { flag: '🇫🇷', name: 'Pháp' },
    'JP': { flag: '🇯🇵', name: 'Nhật Bản' },
    'KR': { flag: '🇰🇷', name: 'Hàn Quốc' },
    'CA': { flag: '🇨🇦', name: 'Canada' },
    'AU': { flag: '🇦🇺', name: 'Úc' },
    'SG': { flag: '🇸🇬', name: 'Singapore' },
    'NL': { flag: '🇳🇱', name: 'Hà Lan' },
    'MX': { flag: '🇲🇽', name: 'Mexico' },
    'ID': { flag: '🇮🇩', name: 'Indonesia' },
    'MY': { flag: '🇲🇾', name: 'Malaysia' },
    'PH': { flag: '🇵🇭', name: 'Philippines' },
    'VN': { flag: '🇻🇳', name: 'Việt Nam' }
};

function openProfileDetailModal(gpmId) {
    activeDetailGpmId = gpmId;
    const modal = document.getElementById('profileDetailModal');
    if (!modal) {
        console.error('Không tìm thấy element #profileDetailModal trong DOM');
        return;
    }

    // Hiển thị modal ngay lập tức
    modal.classList.add('active', 'show');
    modal.style.display = 'flex';

    // Lấy profile từ cache nếu có để render trước
    try {
        const cached = (cachedGpmProfiles || []).find(p => String(p.gpm_id) === String(gpmId));
        if (cached) {
            populateProfileDetailData(cached);
        }
    } catch (err) {
        console.warn('Lỗi render dữ liệu cache cho detail modal:', err);
    }

    // Tải chi tiết và danh sách video từ backend
    fetch(`/api/gpm/profiles/${encodeURIComponent(gpmId)}`)
        .then(res => res.json())
        .then(data => {
            if (activeDetailGpmId === gpmId && data && !data.detail) {
                try {
                    populateProfileDetailData(data);
                } catch (err) {
                    console.warn('Lỗi render chi tiết profile từ API:', err);
                }
            }
        })
        .catch(err => console.warn('Lỗi tải chi tiết profile:', err));
}

function closeProfileDetailModal() {
    activeDetailGpmId = null;
    const modal = document.getElementById('profileDetailModal');
    if (modal) {
        modal.classList.remove('active', 'show');
        modal.style.display = 'none';
    }
}

function populateProfileDetailData(p) {
    if (!p) return;

    // Header info
    const titleEl = document.getElementById('detailProfileTitle');
    if (titleEl) titleEl.textContent = p.name || `Profile ${p.gpm_id}`;

    const browserEl = document.getElementById('detailBrowserBadge');
    if (browserEl) browserEl.textContent = (p.browser_type || 'GPM').toUpperCase();

    const statusEl = document.getElementById('detailStatusBadge');
    if (statusEl) {
        const isRunning = p.status === 'running' || p.is_running;
        statusEl.textContent = isRunning ? 'Đang chạy' : 'Sẵn sàng';
        statusEl.className = isRunning ? 'badge badge-warning' : 'badge badge-success';
    }

    const gpmIdEl = document.getElementById('detailGpmIdText');
    if (gpmIdEl) gpmIdEl.textContent = p.gpm_id || '-';

    const lastScannedEl = document.getElementById('detailLastScanned');
    if (lastScannedEl) {
        lastScannedEl.innerHTML = p.last_checked
            ? `<i class="fa-regular fa-clock"></i> Quét: ${escapeHtml(p.last_checked)}`
            : `<i class="fa-regular fa-clock"></i> Chưa quét số liệu`;
    }

    // Avatar icon & color
    const avatarEl = document.getElementById('detailProfileAvatar');
    if (avatarEl) {
        const plat = (p.platform || 'tiktok').toLowerCase();
        let iconHtml = '<i class="fa-brands fa-tiktok"></i>';
        let bgGrad = 'linear-gradient(135deg, #06b6d4, #3b82f6)';
        if (plat === 'youtube') {
            iconHtml = '<i class="fa-brands fa-youtube"></i>';
            bgGrad = 'linear-gradient(135deg, #ef4444, #b91c1c)';
        } else if (plat === 'facebook') {
            iconHtml = '<i class="fa-brands fa-facebook"></i>';
            bgGrad = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
        }
        avatarEl.innerHTML = iconHtml;
        avatarEl.style.background = bgGrad;
    }

    // 4 KPI Cards
    // 1. Followers + 10k Progress Bar
    const followers = p.followers_count || 0;
    const followersEl = document.getElementById('detailFollowersVal');
    if (followersEl) followersEl.textContent = followers.toLocaleString('vi-VN');

    const pct = Math.min(100, Math.round((followers / 10000) * 100));
    const pctEl = document.getElementById('detailBetaPercent');
    if (pctEl) pctEl.textContent = `${pct}%`;
    const pBar = document.getElementById('detailBetaProgressBar');
    if (pBar) {
        pBar.style.width = `${pct}%`;
        pBar.style.background = followers >= 10000
            ? 'linear-gradient(90deg, #10b981, #059669)'
            : 'linear-gradient(90deg, #38bdf8, #f59e0b)';
    }

    // 2. Total Views
    const totalViews = p.total_views || 0;
    const viewsEl = document.getElementById('detailTotalViewsVal');
    if (viewsEl) viewsEl.textContent = totalViews.toLocaleString('vi-VN');
    const viewsSubEl = document.getElementById('detailViewsSubtitle');
    if (viewsSubEl) {
        if (p.views_7d) {
            viewsSubEl.textContent = `${Number(p.views_7d).toLocaleString('vi-VN')} views (7 ngày gần nhất)`;
        } else {
            viewsSubEl.textContent = 'Tổng lượt xem tích lũy';
        }
    }

    // 3. Chuẩn 10k Beta
    const isEligible = isProfileEligible(p);
    const betaStatusVal = document.getElementById('detailBetaStatusVal');
    if (betaStatusVal) {
        betaStatusVal.textContent = isEligible ? '🏆 ĐỦ 10K BETA!' : '🌱 Đang Nuôi';
        betaStatusVal.style.color = isEligible ? '#34d399' : '#f59e0b';
    }
    const betaSubtext = document.getElementById('detailBetaSubtext');
    if (betaSubtext) {
        betaSubtext.textContent = isEligible ? 'Đủ điều kiện bật kiếm tiền' : 'Cần ≥ 10.000 Follower';
    }

    // 4. Creator Rewards Program
    const cp = (p.creator_program || (isEligible ? 'active' : 'ineligible')).toLowerCase();
    const cpVal = document.getElementById('detailCreatorProgramVal');
    const cpSub = document.getElementById('detailCpSubtext');
    if (cpVal) {
        if (cp === 'active') {
            cpVal.textContent = 'Đã Bật';
            cpVal.style.color = '#34d399';
            if (cpSub) cpSub.textContent = 'Chương trình Sáng tạo Đang hoạt động';
        } else if (cp === 'not_enrolled') {
            cpVal.textContent = 'Chưa Đăng Ký';
            cpVal.style.color = '#38bdf8';
            if (cpSub) cpSub.textContent = 'Đủ điều kiện, cần gửi đơn duyệt';
        } else if (cp === 'banned') {
            cpVal.textContent = 'Bị Loại';
            cpVal.style.color = '#ef4444';
            if (cpSub) cpSub.textContent = 'Vi phạm chính sách TikTok';
        } else {
            cpVal.textContent = 'Chưa Đủ ĐK';
            cpVal.style.color = '#94a3b8';
            if (cpSub) cpSub.textContent = 'Cần đạt mốc 10.000 followers';
        }
    }

    // Section 1: TikTok Identity
    const cleanUsername = (p.tiktok_username || '').replace(/^@/, '');
    const handleEl = document.getElementById('detailTiktokHandle');
    if (handleEl) handleEl.textContent = cleanUsername ? `@${cleanUsername}` : '-';

    const nickEl = document.getElementById('detailTiktokNickname');
    if (nickEl) nickEl.textContent = p.tiktok_nickname || p.name || '-';

    const secUidEl = document.getElementById('detailTiktokSecUid');
    if (secUidEl) {
        secUidEl.textContent = p.sec_uid || '-';
        secUidEl.title = p.sec_uid || '';
    }

    const sessionEl = document.getElementById('detailSessionState');
    if (sessionEl) {
        if (p.has_cookie) {
            sessionEl.textContent = 'Đã có Cookie';
            sessionEl.className = 'badge badge-success';
        } else if (cleanUsername) {
            sessionEl.textContent = 'Chưa quét Cookie';
            sessionEl.className = 'badge badge-warning';
        } else {
            sessionEl.textContent = 'Chưa gán Nick';
            sessionEl.className = 'badge badge-secondary';
        }
    }

    // Section 2: Nhóm & Chiến Dịch
    const groupBadge = document.getElementById('detailGroupNameBadge');
    if (groupBadge) {
        const gName = getProfileGroupName(p);
        groupBadge.textContent = gName || 'Chưa phân nhóm';
        groupBadge.style.background = gName ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.06)';
        groupBadge.style.color = gName ? '#a5b4fc' : 'var(--text-muted)';
    }

    const campListEl = document.getElementById('detailCampaignList');
    if (campListEl) {
        const camps = (p.campaigns && p.campaigns.length > 0)
            ? p.campaigns
            : ((p.campaign_names && p.campaign_names.length > 0)
                ? p.campaign_names.map(name => ({ name }))
                : (p.campaign_name || p.campaign ? [{ name: p.campaign_name || p.campaign }] : []));
        if (camps.length > 0) {
            campListEl.innerHTML = camps.map(c => `
                <span class="badge" style="background: rgba(236, 72, 153, 0.16); color: #f472b6; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    <i class="fa-solid fa-bullhorn" style="font-size: 10px;"></i> ${escapeHtml(c.name || c.id || 'Chiến dịch')}
                </span>
            `).join('');
        } else {
            campListEl.innerHTML = `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); font-weight: 500;">Chưa gán chiến dịch</span>`;
        }
    }

    const postEl = document.getElementById('detailTotalPosts');
    if (postEl) {
        const vids = p.profile_videos || [];
        const count = p.post_count || vids.length || 0;
        postEl.textContent = `${count} video`;
    }

    const avgMaxEl = document.getElementById('detailAvgMaxViews');
    if (avgMaxEl) {
        if (p.avg_views || p.max_views) {
            avgMaxEl.textContent = `${(p.avg_views || 0).toLocaleString('vi-VN')} / ${(p.max_views || 0).toLocaleString('vi-VN')}`;
        } else {
            avgMaxEl.textContent = `${totalViews.toLocaleString('vi-VN')} views`;
        }
    }

    // Section 3: Mạng & Proxy SOCKS5
    const countryEl = document.getElementById('detailCountryDisplay');
    if (countryEl) {
        const cCode = (p.country || '').toUpperCase();
        if (cCode && cCode !== 'NONE') {
            const cInfo = countryDisplayMap[cCode] || { flag: '🌐', name: cCode };
            countryEl.innerHTML = `${cInfo.flag} ${cCode} - ${escapeHtml(cInfo.name)}`;
        } else {
            countryEl.innerHTML = `🌐 Direct IP (Không dùng Proxy)`;
        }
    }

    const proxyEl = document.getElementById('detailProxyDisplay');
    if (proxyEl) {
        const px = p.raw_proxy || p.proxy_url || '';
        proxyEl.textContent = px || 'Direct (Không proxy)';
    }

    const netModeEl = document.getElementById('detailNetworkMode');
    if (netModeEl) {
        const px = p.raw_proxy || p.proxy_url || '';
        if (px.includes('127.0.0.1:108') || px.includes('wireproxy')) {
            netModeEl.textContent = 'WireGuard SOCKS5 Cục Bộ';
            netModeEl.style.background = 'rgba(56, 189, 248, 0.15)';
            netModeEl.style.color = '#38bdf8';
        } else if (px) {
            netModeEl.textContent = 'Proxy Cố Định Ngoài';
            netModeEl.style.background = 'rgba(168, 85, 247, 0.15)';
            netModeEl.style.color = '#c084fc';
        } else {
            netModeEl.textContent = 'Direct IP Mạng Cục Bộ';
            netModeEl.style.background = 'rgba(148, 163, 184, 0.15)';
            netModeEl.style.color = '#94a3b8';
        }
    }

    // Section 4: Hiệu Suất / Flop
    const flopContainer = document.getElementById('detailFlopBadgeContainer');
    if (flopContainer) {
        const fs = (p.flop_status || 'new').toLowerCase();
        let fHtml = '<span class="badge badge-secondary">Mới nuôi</span>';
        if (fs === 'good') fHtml = '<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Rất tốt</span>';
        else if (fs === 'unstable') fHtml = '<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Không ổn định</span>';
        else if (fs === '200_view') fHtml = '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Flop 200 view</span>';
        else if (fs === '0_view') fHtml = '<span class="badge badge-danger"><i class="fa-solid fa-ban"></i> 0 view (Shadowban)</span>';
        flopContainer.innerHTML = fHtml;
    }

    const medianEl = document.getElementById('detailMedianViews');
    if (medianEl) {
        medianEl.textContent = `${(p.median_views || 0).toLocaleString('vi-VN')} views`;
    }

    const createdEl = document.getElementById('detailCreatedAt');
    if (createdEl) {
        createdEl.textContent = p.created_at || 'Đồng bộ từ GPMLogin';
    }

    // TikTok Web Link button
    const tiktokWebBtn = document.getElementById('btnDetailOpenTiktokWeb');
    if (tiktokWebBtn) {
        if (cleanUsername) {
            tiktokWebBtn.href = `https://www.tiktok.com/@${cleanUsername}`;
            tiktokWebBtn.style.display = 'inline-flex';
        } else {
            tiktokWebBtn.style.display = 'none';
        }
    }

    // Recent Videos Table
    const vidsSec = document.getElementById('detailRecentVideosSection');
    const vidsTbody = document.getElementById('detailRecentVideosTableBody');
    const vidsBadge = document.getElementById('detailVideosCountBadge');
    const vids = p.profile_videos || [];
    if (vidsSec && vidsTbody) {
        if (vids.length > 0) {
            vidsSec.style.display = 'block';
            if (vidsBadge) vidsBadge.textContent = `${vids.length} video`;
            vidsTbody.innerHTML = vids.map((v, i) => `
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                    <td style="padding: 8px 10px; color: var(--text-muted); font-size: 11px;">#${i + 1}</td>
                    <td style="padding: 8px 10px; font-weight: 500; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span title="${escapeHtml(v.title || v.desc || 'Video')}">${escapeHtml(v.title || v.desc || 'Video ' + (v.video_id || (i + 1)))}</span>
                    </td>
                    <td style="padding: 8px 10px; text-align: right; font-weight: 700; color: #38bdf8;">
                        ${(v.view_count || v.views || 0).toLocaleString('vi-VN')}
                    </td>
                    <td style="padding: 8px 10px; text-align: right; color: var(--text-muted); font-size: 11px;">
                        ${escapeHtml(v.posted_at || v.created_at || '-')}
                    </td>
                </tr>
            `).join('');
        } else {
            vidsSec.style.display = 'none';
        }
    }
}

function copyDetailGpmId() {
    const el = document.getElementById('detailGpmIdText');
    const id = el ? el.textContent.trim() : '';
    if (!id || id === '-') return;
    navigator.clipboard.writeText(id).then(() => {
        showToast(`📋 Đã sao chép GPM ID: ${id}`, 'success');
    }).catch(() => {
        showToast('Không thể sao chép ID!', 'error');
    });
}

function copyDetailProxy() {
    const el = document.getElementById('detailProxyDisplay');
    const px = el ? el.textContent.trim() : '';
    if (!px || px.startsWith('Direct')) return;
    navigator.clipboard.writeText(px).then(() => {
        showToast(`📋 Đã sao chép Proxy: ${px}`, 'success');
    }).catch(() => {
        showToast('Không thể sao chép proxy!', 'error');
    });
}

function openEditFromDetailModal() {
    if (!activeDetailGpmId) return;
    const p = (cachedGpmProfiles || []).find(item => String(item.gpm_id) === String(activeDetailGpmId));
    if (!p) return;
    closeProfileDetailModal();
    openEditUsernameModal(
        p.gpm_id,
        p.name,
        p.tiktok_username,
        p.followers_count || 0,
        p.tiktok_nickname || '',
        p.browser_type || 'gpm',
        p.platform || 'tiktok',
        '',
        p.country || 'NONE'
    );
}

async function scanDetailProfileFollowers(btn) {
    if (!activeDetailGpmId) return;
    await scanSingleProfileFollowers(activeDetailGpmId, btn);
    const updated = (cachedGpmProfiles || []).find(item => String(item.gpm_id) === String(activeDetailGpmId));
    if (updated) {
        populateProfileDetailData(updated);
    }
}

window.openProfileDetailModal = openProfileDetailModal;
window.closeProfileDetailModal = closeProfileDetailModal;
window.copyDetailGpmId = copyDetailGpmId;
window.copyDetailProxy = copyDetailProxy;
window.openEditFromDetailModal = openEditFromDetailModal;
window.scanDetailProfileFollowers = scanDetailProfileFollowers;
