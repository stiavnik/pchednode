let hasLoadedOnce = false;
let ipCache = {};
let pubkeyCountMap = {};
let pubkeyToIpsMap = {};

// --- Global State ---
let currentPods = [];
let sortCol = 'credits';
let sortAsc = false;
let isBatchFetching = false;

function escapeHtml(text) {
    if (!text) return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatRelativeTime(ts) {
    if (!ts) return { text: "-", class: "text-gray-400" };
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return { text: `${diff}s ago`, class: "fresh" };
    if (diff < 3600) return { text: `${Math.floor(diff/60)}m ago`, class: "recent" };
    if (diff < 86400) return { text: `${Math.floor(diff/3600)}h ago`, class: "stale" };
    if (diff < 604800) return { text: `${Math.floor(diff/86400)}d ago`, class: "very-stale" };
    return { text: `${Math.floor(diff/604800)}w ago`, class: "very-stale" };
}

function formatUptime(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h`;
    return `${Math.floor(seconds/86400)}d`;
}

function formatStorage(bytes) {
    if (bytes === null || bytes === undefined) return "-";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`;
    return `${gb.toFixed(1)} GB`;
}

function formatPercent(val) {
    if (val === null || val === undefined) return "-";
    return `${val.toFixed(2)}%`;
}

function cleanVersion(v) {
    if (!v || v === "unknown") return "unknown";
    return v.split('-')[0];
}

function formatPingHtml(ping) {
    if (ping === undefined) return '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    if (ping === null) return '<span class="text-gray-400 text-xs font-mono">-</span>';
    if (ping > 400) return `<span class="text-red-500">${ping} ms</span>`;
    if (ping > 200) return `<span class="text-orange-500">${ping} ms</span>`;
    return `<span class="text-green-600">${ping} ms</span>`;
}

function formatCreditsHtml(credits) {
    if (credits === undefined) return '<span class="inline-block w-3 h-3 border border-gray-400 border-t-purple-600 rounded-full animate-spin"></span>';
    if (credits === null) return `<span class="text-gray-400 text-xs">-</span>`;
    const val = new Intl.NumberFormat().format(credits);
    return `<span class="text-purple-600 dark:text-purple-400 font-bold">${val}</span>`;
}

// --- STAKE FORMATTER (3 decimal places) ---
function formatStakeHtml(stake, hasStaking = false) {
    if (!hasStaking) return '<span class="text-gray-400 dark:text-gray-600 text-xs font-medium">—</span>';
    return `<span class="text-indigo-600 dark:text-indigo-400 font-medium">${parseFloat(stake).toFixed(1)}</span>`;
}

function formatCommissionHtml(com, hasStaking = false) {
    if (!hasStaking) return '<span class="text-gray-400 dark:text-gray-600 text-xs font-medium">—</span>';
    return `<span class="text-amber-600 dark:text-amber-400 font-medium">${parseFloat(com).toFixed(2)}%</span>`;
}

function formatStcoinHtml(stoin, hasStaking = false) {
    if (!hasStaking) return '<span class="text-gray-400 dark:text-gray-600 text-xs font-medium">—</span>';
    return `<span class="text-teal-600 dark:text-teal-400 font-medium">${parseFloat(stoin).toFixed(3)}</span>`;
}

function formatBoostHtml(boost) {
    if (boost === undefined || boost === null || boost <= 0) {
        return '<span class="text-gray-400 dark:text-gray-600 text-xs font-medium">—</span>';
    }
    const highlightClass = boost > 16
        ? "text-amber-500 dark:text-amber-400 font-bold"
        : "text-violet-600 dark:text-violet-400 font-medium";
    return `<span class="${highlightClass}">${parseFloat(boost).toFixed(1)}x</span>`;
}

async function loadYugaInfo() {
    const rpcUrl = document.getElementById("rpcSelector").value;
    const host = new URL(rpcUrl).hostname;

    const box = document.getElementById("yuga-box");
    if (!box) return;

    try {
        const res = await fetch(`https://${host}/yuga-info`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP error");
        const data = await res.json();

        if (data.error) throw new Error(data.error);
        document.getElementById("yuga-current").textContent = data.yuga || '?';
        document.getElementById("yuga-remaining").textContent = data.remaining ? `${data.remaining} left` : '?';
        box.style.opacity = "1";
    } catch (e) {
        console.warn("Yuga info unavailable", e);
        const current = document.getElementById("yuga-current");
        const remaining = document.getElementById("yuga-remaining");
        if (current) current.textContent = "—";
        if (remaining) remaining.textContent = "Remaining: ?";
    }
}

function markLoadButton() {
    const b = document.getElementById("loadButton");
    b.classList.add("bg-yellow-500", "shadow-yellow-400/70");
    b.classList.remove("bg-indigo-600");
    b.textContent = hasLoadedOnce ? "RELOAD" : "LOAD";
}

function clearLoadButtonHighlight() {
    const b = document.getElementById("loadButton");
    b.classList.remove("bg-yellow-500", "shadow-yellow-400/70");
    b.classList.add("bg-indigo-600");
}

function compareVersions(vA, vB) {
    const cleanA = cleanVersion(vA);
    const cleanB = cleanVersion(vB);
    if (!cleanA && !cleanB) return 0;
    if (!cleanA) return -1;
    if (!cleanB) return 1;
    const partsA = cleanA.split('.').map(Number);
    const partsB = cleanB.split('.').map(Number);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const a = partsA[i] || 0;
        const b = partsB[i] || 0;
        if (a > b) return 1;
        if (a < b) return -1;
    }
    return 0;
}

function handleSort(column) {
    if (!currentPods || currentPods.length === 0) return;
    if (sortCol === column) {
        sortAsc = !sortAsc;
    } else {
        sortCol = column;
        sortAsc = false;
        if (['version', 'name', 'country', 'pubkey', 'is_public', 'nfts', 'owner', 'manager'].includes(column)) {
            sortAsc = true;
        }
    }
    requestAnimationFrame(() => renderTable());
}

function copyPubkey(text, element, event) {
    if (event) { event.stopPropagation(); } else if (window.event) { window.event.cancelBubble = true; }
    navigator.clipboard.writeText(text).then(() => {
        const originalHTML = element.innerHTML;
        element.innerHTML = "Copied!";
        element.classList.replace("text-gray-600", "text-green-600");
        element.classList.add("font-bold");
        setTimeout(() => {
            element.innerHTML = originalHTML;
            element.classList.replace("text-green-600", "text-gray-600");
            element.classList.remove("font-bold");
        }, 1000);
    });
}

function getSortIndicator(col) {
    if (sortCol !== col) return '<span class="text-gray-300 ml-1 opacity-50">↕</span>';
    return sortAsc
        ? '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↑</span>'
        : '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↓</span>';
}

function refilterAndRestyle() {
    const toggle = document.getElementById("globalFilterToggle").checked;
    const value = document.getElementById("globalFilterValue").value.trim().toLowerCase();
    document.querySelectorAll("#pched-live-view tbody tr").forEach(row => {
        const nameCell = row.querySelector("td[id^='name-']");
        if (!nameCell) return;
        const ip = nameCell.id.replace("name-", "");
        const cache = ipCache[ip] || {};
        const name = (cache.name || "N/A").toLowerCase();
        const ipText = ip.toLowerCase();
        const pubkey = row.cells[2]?.dataset.pubkey?.toLowerCase() || "";
        const owner = (cache.owner || "").toLowerCase();
        const manager = (cache.manager || "").toLowerCase();
        if (!toggle || value === "") {
            row.style.display = "";
        } else {
            const match = ipText.includes(value) || pubkey.includes(value) ||
                          name.includes(value) || owner.includes(value) || manager.includes(value);
            row.style.display = match ? "" : "none";
        }
    });
}

let filterTimer;
function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { markLoadButton(); refilterAndRestyle(); }, 150);
}

function renderTable() {
    const output = document.getElementById("pched-live-view");
    if (!currentPods) return;
    let podsToRender = [...currentPods];

    if (document.getElementById("versionFilterToggle").checked) {
        const v = document.getElementById("versionFilterValue").value.trim();
        if (v) podsToRender = podsToRender.filter(p => cleanVersion(p.version) === v);
    }

    podsToRender.sort((a, b) => {
        const ipA = a.address.split(":")[0];
        const ipB = b.address.split(":")[0];
        const cacheA = ipCache[ipA] || {
            name: "", geo_sort: "zzzz", is_registered: false, nft_count: 0,
            owner: "--", manager: "--",
            nft_slot_1_name: "--", nft_slot_2_name: "--",
            boost: 0   // ← NEW
        };
        const cacheB = ipCache[ipB] || {
            name: "", geo_sort: "zzzz", is_registered: false, nft_count: 0,
            owner: "--", manager: "--",
            nft_slot_1_name: "--", nft_slot_2_name: "--",
            boost: 0   // ← NEW
        };
        let valA, valB, comparison = 0;

        switch (sortCol) {
            case 'name':
                valA = (cacheA.name === "N/A" ? "" : cacheA.name).toLowerCase();
                valB = (cacheB.name === "N/A" ? "" : cacheB.name).toLowerCase();
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            case 'pubkey':
                valA = (a.pubkey || "").toLowerCase();
                valB = (b.pubkey || "").toLowerCase();
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            case 'owner':
                valA = (cacheA.owner || "").toLowerCase();
                valB = (cacheB.owner || "").toLowerCase();
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            case 'manager':
                valA = (cacheA.manager || "").toLowerCase();
                valB = (cacheB.manager || "").toLowerCase();
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            case 'is_public':
                comparison = (a.is_public ? 1 : 0) - (b.is_public ? 1 : 0);
                break;
            case 'country':
                valA = (cacheA.geo_sort || "").toLowerCase();
                valB = (cacheB.geo_sort || "").toLowerCase();
                if (valA.includes("loading") && !valB.includes("loading")) return 1;
                if (!valA.includes("loading") && valB.includes("loading")) return -1;
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            case 'storage':
                 comparison = (a.storage_committed || -1) - (b.storage_committed || -1);
                 break;
            case 'usage':
                 comparison = (a.storage_usage_percent || -1) - (b.storage_usage_percent || -1);
                 break;
            case 'ping':
                valA = (cacheA.ping === null) ? Infinity : (cacheA.ping === undefined ? 99999 : cacheA.ping);
                valB = (cacheB.ping === null) ? Infinity : (cacheB.ping === undefined ? 99999 : cacheB.ping);
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            case 'credits':
                valA = (cacheA.credits ?? -1);
                valB = (cacheB.credits ?? -1);
                if (valA < valB) comparison = -1; else if (valA > valB) comparison = 1;
                break;
            // --- UPDATED SORT FOR STAKE ---
            case 'stake':
                if (!cacheA.has_staking && cacheB.has_staking) {
                    // A has no stake, B does. Force A to the bottom.
                    // We check sortAsc to counteract the global flip at the end of the function.
                    comparison = sortAsc ? 1 : -1;
                } else if (cacheA.has_staking && !cacheB.has_staking) {
                    // A has stake, B does not. Force B to the bottom.
                    comparison = sortAsc ? -1 : 1;
                } else if (!cacheA.has_staking && !cacheB.has_staking) {
                    // Neither have stake, keep them together
                    comparison = 0;
                } else {
                    // Both have stake, sort them by actual amount
                    comparison = cacheA.stake - cacheB.stake;
                }
                break;
            case 'commission':
                if (!cacheA.has_staking && cacheB.has_staking) comparison = sortAsc ? 1 : -1;
                else if (cacheA.has_staking && !cacheB.has_staking) comparison = sortAsc ? -1 : 1;
                else if (!cacheA.has_staking && !cacheB.has_staking) comparison = 0;
                else comparison = (cacheA.commission || 0) - (cacheB.commission || 0);
                break;
            case 'stoin_c':
                if (!cacheA.has_staking && cacheB.has_staking) comparison = sortAsc ? 1 : -1;
                else if (cacheA.has_staking && !cacheB.has_staking) comparison = sortAsc ? -1 : 1;
                else if (!cacheA.has_staking && !cacheB.has_staking) comparison = 0;
                else comparison = (cacheA.stoin_c || 0) - (cacheB.stoin_c || 0);
                break;
            case 'uptime':
                comparison = (a.uptime || -1) - (b.uptime || -1);
                break;
            case 'version':
                comparison = compareVersions(a.version, b.version);
                break;
            case 'nfts':
                valA = (cacheA.is_registered ? 1 : 0) * 10 + (cacheA.nft_count || 0);
                valB = (cacheB.is_registered ? 1 : 0) * 10 + (cacheB.nft_count || 0);
                comparison = valA - valB;
                break;
            case 'boost':
                valA = (cacheA.boost ?? 0);
                valB = (cacheB.boost ?? 0);
                comparison = valA - valB;
                break;
            default: // last_seen
                comparison = (a.last_seen_timestamp || 0) - (b.last_seen_timestamp || 0);
                break;
        }
        return sortAsc ? comparison : -comparison;
    });

    document.getElementById("podCount").textContent = podsToRender.length;

    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('credits')">Credits ${getSortIndicator('credits')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('name')" title="Click footer to register your name">Name ${getSortIndicator('name')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('pubkey')">Pubkey ${getSortIndicator('pubkey')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none text-center" onclick="handleSort('nfts')">Reg?<br>(NFTs) ${getSortIndicator('nfts')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none text-center" onclick="handleSort('boost')">BOOST ${getSortIndicator('boost')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none text-center" onclick="handleSort('owner')" title="Owner pubkey">O ${getSortIndicator('owner')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none text-center" onclick="handleSort('manager')" title="Manager pubkey">M ${getSortIndicator('manager')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('stake')">Stake<br>XAND ${getSortIndicator('stake')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('commission')">Commi<br>ssion ${getSortIndicator('commission')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('stoin_c')">STOINC<br>WSOL ${getSortIndicator('stoin_c')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('country')">Country ${getSortIndicator('country')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('ping')">Ping ${getSortIndicator('ping')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('storage')">Disk<br>Size ${getSortIndicator('storage')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('usage')">Disk<br>Used ${getSortIndicator('usage')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('version')">Ver ${getSortIndicator('version')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('is_public')">Pub? ${getSortIndicator('is_public')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('uptime')">Time<br>up ${getSortIndicator('uptime')}</th>
        <th class="rounded-tr-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('last_seen')">Last<br>Seen ${getSortIndicator('last_seen')}</th>
    </tr></thead><tbody>`;

    const batchQueue = [];
    const rpcSelector = document.getElementById("rpcSelector");
    const rpcHost = rpcSelector ? new URL(rpcSelector.value).hostname : window.location.hostname;

    for (const pod of podsToRender) {
        const ip = pod.address.split(":")[0];
        const { text: timeText, class: timeClass } = formatRelativeTime(pod.last_seen_timestamp);
        const pubkey = pod.pubkey || "";
        const shortKey = pubkey ? pubkey.slice(0,4) + "..." + pubkey.slice(-4) : "N/A";
        const isDuplicated = pubkey && pubkeyCountMap[pubkey] > 1;

        let hoverTitle = `Click to copy: ${pubkey}`;
        if (isDuplicated) {
            const sharedIps = pubkeyToIpsMap[pubkey] || [];
            hoverTitle = `🚨 LIVE DUPLICATE PUBKEY (${sharedIps.length} active nodes)\nIPs: ${sharedIps.join(', ')}\n\nClick to copy: ${pubkey}`;
        }

        const existing = ipCache[ip];
        const needsFetch = !existing || existing.country?.includes("loading-spinner") || existing.country === "Geo Error" || !existing.provider;

        if (needsFetch) batchQueue.push({ ip: ip, pubkey: pubkey });

        // Default when nothing cached yet
        const cached = existing && !needsFetch ? existing : {
            name: "N/A",
            country: '<span class="loading-spinner">Loading</span>',
            provider: "",
            geo_sort: "loading",
            stake: 0,
            has_staking: false,
            commission: 0,
            stoin_c: 0,
            is_registered: false,
            nft_count: 0,
            owner: "--",
            manager: "--",
            nft_slot_1_name: "--",
            nft_slot_2_name: "--",
            boost: 0
        };

        // === UPDATED NFT CELL with highlighted count when > 0 ===
        let nftCellHtml = `<span class="text-gray-400 dark:text-gray-600 text-sm">-</span>`;
        if (cached.is_registered) {
            const nftCount = cached.nft_count || 0;

            let tooltipLines = [];
            if (cached.nft_slot_1_name && cached.nft_slot_1_name !== "--") {
                tooltipLines.push(`NFT Slot 1: ${cached.nft_slot_1_name}`);
            }
            if (cached.nft_slot_2_name && cached.nft_slot_2_name !== "--") {
                tooltipLines.push(`NFT Slot 2: ${cached.nft_slot_2_name}`);
            }

            const titleAttr = tooltipLines.length > 0
                ? `title="${escapeHtml(tooltipLines.join('\n'))}"`
                : '';

            const countClass = nftCount > 0
                ? 'text-emerald-600 dark:text-emerald-400 text-xs font-bold'
                : 'text-pink-500 dark:text-pink-400 text-xs font-medium';

            nftCellHtml = `
                <span class="font-bold text-emerald-600 dark:text-emerald-400" ${titleAttr}>Y</span>
                <span class="ml-1 ${countClass}">(${nftCount})</span>
            `;
        }

        let countryHtml = cached.country;
        if (cached.country_code && cached.provider) {
             const flagUrl = `https://${rpcHost}/geo/flag/${cached.country_code}`;
             const flagImg = (cached.country_code !== "--") ? `<img src="${flagUrl}" class="inline-block mr-2 w-4 h-auto shadow-sm">` : "";
             const providerHtml = `<span class="text-[10px] uppercase tracking-tighter opacity-80">${cached.provider}</span>`;
             countryHtml = `${flagImg}${providerHtml}`;
        }

        const isKnown = cached.name && cached.name !== "N/A";
        const isRegistered = cached.is_registered ? "bg-emerald-50/30 dark:bg-emerald-900/10" : "";
        const rowClass = `${isKnown ? "known-server" : ""} ${isDuplicated ? "duplicate-pubkey-row" : ""} ${isRegistered}`;
        const nameClass = isKnown ? "font-semibold text-indigo-700" : "text-gray-500";
        const pubkeyCellClass = isDuplicated ? "pubkey-duplicate" : "";
        const warningIcon = isDuplicated ? `<span class="warning-icon" title="Duplicates found">!</span>` : "";

        let pingHtml = formatPingHtml(cached.ping);
        let creditsHtml = formatCreditsHtml(cached.credits);

        const publicStr = (pod.is_public === true) ? "Yes" : (pod.is_public === false ? "No" : "-");
        const storageStr = formatStorage(pod.storage_committed);
        const usageStr = formatPercent(pod.storage_usage_percent);
        const uptimeStr = formatUptime(pod.uptime);
        const rawVer = pod.version || "";
        const cleanVer = cleanVersion(rawVer);
        let versionHtml = cleanVer;

        // If the version was truncated (contained a dash), add decoration
        if (rawVer !== cleanVer) {
            // Adds a dotted underline and an asterisk, with the full version in the tooltip
            versionHtml = `<span title="${escapeHtml(rawVer)}" class="cursor-help border-b border-dotted border-gray-400 hover:border-indigo-500 transition-colors">${cleanVer}*</span>`;
        }

        html += `<tr class="${rowClass}" onclick="window.location.href='history.html?ip=${ip}&host=${rpcHost}'" style="cursor:pointer;">
            <td class="text-right font-mono text-sm">${creditsHtml}</td>
            <td id="name-${ip}" class="${nameClass}" title="Click footer to register your name">${cached.name}</td>
            <td class="font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600 ${pubkeyCellClass}"
                data-pubkey="${pubkey}" title="${hoverTitle}" onclick="copyPubkey('${pubkey}', this, event)">
                <span class="short-key">${shortKey}</span>${warningIcon}
            </td>
            <td class="text-center">${nftCellHtml}</td>
            <td class="text-center">${formatBoostHtml(cached.boost)}</td>
            <td class="text-center font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600"
                title="${cached.owner === '--' ? '' : `Click to copy: ${cached.owner}`}"
                onclick="copyPubkey('${cached.owner}', this, event)">
                ${cached.owner === '--' ? '<span class="text-gray-400 dark:text-gray-600">-</span>' : 'O'}
            </td>
            <td class="text-center font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600"
                title="${cached.manager === '--' ? '' : `Click to copy: ${cached.manager}`}"
                onclick="copyPubkey('${cached.manager}', this, event)">
                ${cached.manager === '--' ? '<span class="text-gray-400 dark:text-gray-600">-</span>' : 'M'}
            </td>
            <td class="text-right font-mono text-sm">${formatStakeHtml(cached.stake, cached.has_staking)}</td>
            <td class="text-right font-mono text-sm">${formatCommissionHtml(cached.commission, cached.has_staking)}</td>
            <td class="text-right font-mono text-sm">${formatStcoinHtml(cached.stoin_c, cached.has_staking)}</td>
            <td id="country-${ip}" title="${cached.geo_sort}">${countryHtml}</td>
            <td class="text-right font-mono text-sm">${pingHtml}</td>
            <td class="text-right font-mono text-xs">${storageStr}</td>
            <td class="text-right font-mono text-xs">${usageStr}</td>
            <td>${versionHtml}</td>
            <td class="text-xs">${publicStr}</td>
            <td class="text-right font-mono text-xs">${uptimeStr}</td>
            <td class="${timeClass}">${timeText}</td>
        </tr>`;
    }

    html += "</tbody></table>";
    output.innerHTML = html;

    if (batchQueue.length > 0 && !isBatchFetching) {
        isBatchFetching = true;
        const rpcUrl = document.getElementById("rpcSelector").value;
        const host = new URL(rpcUrl).hostname;
        const geoBatchUrl = `https://${host}/geo/batch`;

        fetch(geoBatchUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: batchQueue })
        })
        .then(r => r.json())
        .then(results => {
            for (const ip in results) {
                const g = results[ip];
                ipCache[ip] = {
                    name: g.name || "N/A",
                    country: g.country,
                    country_code: g.country_code,
                    provider: g.provider,
                    geo_sort: g.geo_sort,
                    ping: g.ping,
                    is_registered: g.is_registered,
                    nft_count: g.nft_count,
                    stake: g.stake || 0,
                    has_staking: !!g.has_staking,
                    commission: g.commission || 0,
                    stoin_c: g.stoin_c || 0,
                    owner: g.owner || "--",
                    manager: g.manager || "--",
                    credits: g.credits,
                    nft_slot_1_name: g.nft_slot_1_name || "--",
                    nft_slot_2_name: g.nft_slot_2_name || "--",
                    boost: g.boost || 0,
                };
            }
            requestAnimationFrame(() => renderTable());
        })
        .catch(e => console.error("Batch geo error", e))
        .finally(() => { isBatchFetching = false; });
    }
    setTimeout(refilterAndRestyle, 0);
}

async function sendRpcRequest() {
    if (!hasLoadedOnce) hasLoadedOnce = true;
    document.getElementById("loadButton").textContent = "RELOAD";
    clearLoadButtonHighlight();
    const rpcUrl = document.getElementById("rpcSelector").value;
    const output = document.getElementById("pched-live-view");
    output.innerHTML = '<p class="text-center text-indigo-600 dark:text-indigo-400 font-semibold">Loading pod list...</p>';
    try {
        const res = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods-with-stats", id: 1 }) });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        const rawPods = data.result?.pods || [];
        const uniqueMap = new Map();
        rawPods.forEach(p => {
             const ip = p.address ? p.address.split(':')[0] : 'unknown';
             if (ip === 'unknown') return;
             if (!uniqueMap.has(ip)) { uniqueMap.set(ip, p); }
             else {
                 const existing = uniqueMap.get(ip);
                 if ((p.last_seen_timestamp || 0) > (existing.last_seen_timestamp || 0)) uniqueMap.set(ip, { ...existing, ...p });
             }
        });
        currentPods = Array.from(uniqueMap.values());
        if (currentPods.length === 0) { output.innerHTML = "<p class='text-gray-500 dark:text-gray-400'>No pods found.</p>"; return; }
        // === DUPLICATE DETECTION — ONLY RECENT / SIMULTANEOUS ===
        const ACTIVE_THRESHOLD_SECONDS = 720;   // 12 minutes

        pubkeyCountMap = {};
        pubkeyToIpsMap = {};

        const now = Math.floor(Date.now() / 1000);

        currentPods.forEach(pod => {
            const pk = pod.pubkey || "";
            if (!pk) return;

            const ageSeconds = now - (pod.last_seen_timestamp || 0);
            if (ageSeconds > ACTIVE_THRESHOLD_SECONDS) return;   // ← skip stale/old entries

            pubkeyCountMap[pk] = (pubkeyCountMap[pk] || 0) + 1;
            if (!pubkeyToIpsMap[pk]) pubkeyToIpsMap[pk] = [];
            pubkeyToIpsMap[pk].push(pod.address.split(":")[0]);
        });
        renderTable();
        loadYugaInfo();   // ← ADD THIS LINE
    } catch (e) { output.innerHTML = `<p class="text-red-500">Error: Could not reach RPC.</p>`; }
}

window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", () => {
    markLoadButton();
    ipCache = {}; // Clears the ghost data

    // Optional: clear the table immediately so the user doesn't see "stale" rows
    // while waiting for the new LOAD click.
    document.getElementById("pched-live-view").innerHTML =
        '<p class="text-gray-500 dark:text-gray-400 mt-12 text-lg">Click LOAD to fetch pod data...</p>';
    document.getElementById("podCount").textContent = "0";
    loadYugaInfo();
});
document.getElementById("versionFilterToggle").addEventListener("change", () => { markLoadButton(); renderTable(); });
document.getElementById("versionFilterValue").addEventListener("input", () => { markLoadButton(); renderTable(); });
document.getElementById("globalFilterToggle").addEventListener("change", scheduleFilter);
document.getElementById("globalFilterValue").addEventListener("input", scheduleFilter);
setInterval(() => { if (!document.hidden) sendRpcRequest(); }, 5*60*1000);

const themeToggle = document.getElementById('themeToggle');
const htmlEl = document.documentElement;
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    htmlEl.classList.add('dark');
} else {
    htmlEl.classList.remove('dark');
}
themeToggle?.addEventListener('click', () => {
    htmlEl.classList.toggle('dark');
    localStorage.setItem('theme', htmlEl.classList.contains('dark') ? 'dark' : 'light');
});

window.addEventListener("load", () => {
    markLoadButton();
    loadYugaInfo(); // <--- Fetches Yuga immediately on page load
});
