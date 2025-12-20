let hasLoadedOnce = false;
let ipCache = {};
let pubkeyCountMap = {};
let pubkeyToIpsMap = {};

// --- Global State ---
let currentPods = [];
let sortCol = 'credits'; 
let sortAsc = false;      

// --- Batch Fetch State ---
let isBatchFetching = false;

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

// --- HTML Formatters for Stats ---
function formatPingHtml(ping) {
    if (ping === undefined) {
        return '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    }
    if (ping === null) {
        return '<span class="text-gray-400 text-xs font-mono">-</span>';
    }
    if (ping > 400) {
        return `<span class="text-red-500">${ping} ms</span>`;
    }
    if (ping > 200) {
        return `<span class="text-orange-500">${ping} ms</span>`;
    }
    return `<span class="text-green-600">${ping} ms</span>`;
}

function formatCreditsHtml(credits) {
    if (credits === undefined) return '<span class="inline-block w-3 h-3 border border-gray-400 border-t-purple-600 rounded-full animate-spin"></span>';
    if (credits === null) return `<span class="text-gray-400 text-xs">-</span>`;
    const val = new Intl.NumberFormat().format(credits);
    return `<span class="text-purple-600 dark:text-purple-400 font-bold">${val}</span>`;
}

function formatBalanceHtml(balance) {
    if (balance === undefined) return '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    if (balance === null) return `<span class="text-gray-400 text-xs">-</span>`;
    const val = parseFloat(balance);
    const fmt = isNaN(val) ? balance : val.toFixed(3);
    return `<span class="text-indigo-600 dark:text-indigo-400 font-medium">${fmt} ◎</span>`;
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
        if (['version', 'name', 'country', 'pubkey', 'is_public'].includes(column)) {
            sortAsc = true;
        }
    }
    requestAnimationFrame(() => renderTable());
}

function copyPubkey(text, element, event) {
    if (event) {
        event.stopPropagation();
    } else if (window.event) {
        window.event.cancelBubble = true;
    }

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
    }).catch(err => {
        console.error("Clipboard write failed", err);
    });
}

// --- CORE UI UPDATE FUNCTION ---
function updateRowAfterGeo(ip) {
    const cached = ipCache[ip];
    if (!cached) return;

    const nameCell = document.getElementById(`name-${ip}`);
    const row = nameCell?.parentElement;
    if (!row) return;

    // 1. Update Name
    if (nameCell) {
        if (cached.name && cached.name !== "N/A") {
            nameCell.textContent = cached.name;
            row.classList.add("known-server");
            nameCell.classList.remove("text-gray-500");
            nameCell.classList.add("font-semibold", "text-indigo-700");
        } else if (cached.name === "N/A") {
            nameCell.textContent = "N/A";
            row.classList.remove("known-server");
        }
    }

    // 2. Update Country + Provider (Flag + Small Text)
    if (row.cells[3]) {
        // Fix: Use the selected RPC host for the flag image
        const rpcSelector = document.getElementById("rpcSelector");
        const rpcHost = rpcSelector ? new URL(rpcSelector.value).hostname : window.location.hostname;

        const flag = cached.country_code && cached.country_code !== "--" 
            ? `<img src="https://${rpcHost}/geo/flag/${cached.country_code}" class="inline-block mr-2 w-4 h-auto shadow-sm">` 
            : "";
        
        // Short provider name in small text
        const providerHtml = `<span class="text-[10px] uppercase tracking-tighter opacity-80">${cached.provider || ""}</span>`;
        
        row.cells[3].innerHTML = `${flag}${providerHtml}`;
        row.cells[3].title = cached.geo_sort || "Unknown"; // Tooltip shows "Germany Contabo"
    }

    // 3. Update Stats
    if (row.cells[7]) row.cells[7].innerHTML = formatPingHtml(cached.ping);
    if (row.cells[8]) row.cells[8].innerHTML = formatCreditsHtml(cached.credits);
    if (row.cells[9]) row.cells[9].innerHTML = formatBalanceHtml(cached.balance);
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
        const pubkey = row.cells[1]?.dataset.pubkey?.toLowerCase() || "";

        if (!toggle || value === "") {
            row.style.display = "";
        } else {
            const match = ipText.includes(value) || pubkey.includes(value) || name.includes(value);
            row.style.display = match ? "" : "none";
        }
    });
}

let filterTimer;
function scheduleFilter() {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => {
        markLoadButton();
        refilterAndRestyle();
    }, 150);
}

function getSortIndicator(col) {
    if (sortCol !== col) return '<span class="text-gray-300 ml-1 opacity-50">↕</span>';
    return sortAsc 
        ? '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↑</span>' 
        : '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↓</span>';
}

function renderTable() {
    const output = document.getElementById("pched-live-view");
    
    if (!currentPods) return;
    let podsToRender = [...currentPods];

    // 1. FILTER
    if (document.getElementById("versionFilterToggle").checked) {
        const v = document.getElementById("versionFilterValue").value.trim();
        if (v) podsToRender = podsToRender.filter(p => cleanVersion(p.version) === v);
    }

    // 2. SORT
    podsToRender.sort((a, b) => {
        const ipA = a.address.split(":")[0];
        const ipB = b.address.split(":")[0];
        const cacheA = ipCache[ipA] || { name: "", geo_sort: "zzzz" };
        const cacheB = ipCache[ipB] || { name: "", geo_sort: "zzzz" };

        let valA, valB, comparison = 0;

        switch (sortCol) {
            case 'name':
                valA = (cacheA.name === "N/A" ? "" : cacheA.name).toLowerCase();
                valB = (cacheB.name === "N/A" ? "" : cacheB.name).toLowerCase();
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
            case 'pubkey':
                valA = (a.pubkey || "").toLowerCase();
                valB = (b.pubkey || "").toLowerCase();
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
            case 'is_public':
                valA = a.is_public ? 1 : 0;
                valB = b.is_public ? 1 : 0;
                comparison = valA - valB;
                break;
            case 'country':
                // --- CRITICAL SORT LOGIC ---
                valA = (cacheA.geo_sort || "").toLowerCase();
                valB = (cacheB.geo_sort || "").toLowerCase();
                
                // Keep loading rows at the bottom during initial fetch
                if (valA.includes("loading") && !valB.includes("loading")) return 1;
                if (!valA.includes("loading") && valB.includes("loading")) return -1;
                
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
            case 'storage':
                 valA = a.storage_committed || -1;
                 valB = b.storage_committed || -1;
                 comparison = valA - valB;
                 break;
            case 'usage':
                 valA = a.storage_usage_percent || -1;
                 valB = b.storage_usage_percent || -1;
                 comparison = valA - valB;
                 break;
            case 'ping':
                valA = (cacheA.ping === null) ? Infinity : (cacheA.ping === undefined ? 99999 : cacheA.ping);
                valB = (cacheB.ping === null) ? Infinity : (cacheB.ping === undefined ? 99999 : cacheB.ping);
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
            case 'credits':
                valA = (cacheA.credits === undefined || cacheA.credits === null) ? -1 : cacheA.credits;
                valB = (cacheB.credits === undefined || cacheB.credits === null) ? -1 : cacheB.credits;
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
            case 'balance':
                valA = parseFloat(cacheA.balance) || -1;
                valB = parseFloat(cacheB.balance) || -1;
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
            case 'uptime':
                valA = a.uptime || -1;
                valB = b.uptime || -1;
                comparison = valA - valB;
                break;
            case 'version':
                comparison = compareVersions(a.version, b.version);
                break;
            case 'last_seen':
            default:
                valA = a.last_seen_timestamp || 0;
                valB = b.last_seen_timestamp || 0;
                if (valA < valB) comparison = -1;
                else if (valA > valB) comparison = 1;
                break;
        }
        return sortAsc ? comparison : -comparison;
    });

    document.getElementById("podCount").textContent = podsToRender.length;

    // 3. BUILD HTML
    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('name')" title="Click footer to register your name">Name ${getSortIndicator('name')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('pubkey')">Pubkey ${getSortIndicator('pubkey')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('is_public')">Pub? ${getSortIndicator('is_public')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('country')">Country ${getSortIndicator('country')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('storage')">Size ${getSortIndicator('storage')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('usage')">Use ${getSortIndicator('usage')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('uptime')">Up ${getSortIndicator('uptime')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('ping')">Ping ${getSortIndicator('ping')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('credits')">Credits ${getSortIndicator('credits')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('balance')">Bal ${getSortIndicator('balance')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('last_seen')">Seen ${getSortIndicator('last_seen')}</th>
        <th class="rounded-tr-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('version')">Ver ${getSortIndicator('version')}</th>
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
            hoverTitle = `⚠️ DUPLICATE PUBKEY!\nShared by nodes: ${sharedIps.join(', ')}\n\nClick to copy: ${pubkey}`;
        }

        const existing = ipCache[ip];
        // If we don't have a provider yet (or it's an error state), re-fetch
        const needsFetch = !existing || existing.country?.includes("loading-spinner") || existing.country === "Geo Error" || !existing.provider;
        
        if (needsFetch) {
            batchQueue.push({ ip: ip, pubkey: pubkey });
        }
        
        // Default placeholder while loading
        const cached = existing && !needsFetch ? existing : { 
            name: "N/A", 
            country: '<span class="loading-spinner">Loading</span>', 
            provider: "",
            geo_sort: "loading",
            ping: undefined, 
            balance: undefined, 
            credits: undefined 
        };

        // --- CRITICAL FIX: Generate Country HTML Here (Fixes "Text Only" on Sort) ---
        let countryHtml = cached.country; 
        if (cached.country_code && cached.provider) {
             const flagUrl = `https://${rpcHost}/geo/flag/${cached.country_code}`;
             const flagImg = (cached.country_code !== "--") 
                ? `<img src="${flagUrl}" class="inline-block mr-2 w-4 h-auto shadow-sm">` 
                : "";
             const providerHtml = `<span class="text-[10px] uppercase tracking-tighter opacity-80">${cached.provider}</span>`;
             countryHtml = `${flagImg}${providerHtml}`;
        }
        // ---------------------------------------------------------------------------

        const isKnown = cached.name && cached.name !== "N/A";
        const rowClass = (isKnown ? "known-server" : "") + (isDuplicated ? " duplicate-pubkey-row" : "");
        const nameClass = isKnown ? "font-semibold text-indigo-700" : "text-gray-500";
        const pubkeyCellClass = isDuplicated ? "pubkey-duplicate" : "";
        const warningIcon = isDuplicated ? `<span class="warning-icon" title="Duplicates found">!</span>` : "";

        let pingHtml = formatPingHtml(cached.ping);
        let creditsHtml = formatCreditsHtml(cached.credits);
        let balanceHtml = formatBalanceHtml(cached.balance);

        const publicStr = (pod.is_public === true) ? "Yes" : (pod.is_public === false ? "No" : "-");
        const storageStr = formatStorage(pod.storage_committed);
        const usageStr = formatPercent(pod.storage_usage_percent);
        const uptimeStr = formatUptime(pod.uptime);
        const versionStr = cleanVersion(pod.version);

        html += `<tr class="${rowClass}" onclick="window.location.href='history.html?ip=${ip}&host=${rpcHost}'" style="cursor:pointer;">
            <td id="name-${ip}" class="${nameClass}" title="Click footer to register your name">${cached.name}</td>
            <td class="font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600 ${pubkeyCellClass}"
                data-pubkey="${pubkey}" 
                title="${hoverTitle}" 
                onclick="copyPubkey('${pubkey}', this, event)">
                <span class="short-key">${shortKey}</span>${warningIcon}
            </td>
            <td class="text-xs">${publicStr}</td>
            <td id="country-${ip}" title="${cached.geo_sort}">${countryHtml}</td>
            <td class="text-right font-mono text-xs">${storageStr}</td>
            <td class="text-right font-mono text-xs">${usageStr}</td>
            <td class="text-right font-mono text-xs">${uptimeStr}</td>
            <td class="text-right font-mono text-sm">${pingHtml}</td>
            <td class="text-right font-mono text-sm">${creditsHtml}</td>
            <td class="text-right font-mono text-sm">${balanceHtml}</td>
            <td class="${timeClass}">${timeText}</td>
            <td>${versionStr}</td>
        </tr>`;
    }

    html += "</tbody></table>";
    output.innerHTML = html;
    
    // 4. FIRE THE BATCH FETCH
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
                
                // Update Cache
                ipCache[ip] = {
                    name: g.name || "N/A",
                    country: g.country,
                    country_code: g.country_code,
                    provider: g.provider,
                    geo_sort: g.geo_sort,
                    ping: g.ping !== undefined ? g.ping : null,
                    balance: g.balance !== undefined ? g.balance : null,
                    credits: g.credits !== undefined ? g.credits : null
                };
            }
            // Force a re-render to apply sorting now that data is available
            requestAnimationFrame(() => renderTable());
        })
        .catch(e => console.error("Batch geo error", e))
        .finally(() => {
            isBatchFetching = false;
        });
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

             if (!uniqueMap.has(ip)) {
                 uniqueMap.set(ip, p);
             } else {
                 const existing = uniqueMap.get(ip);
                 const merged = { ...existing, ...p };
                 if ((p.last_seen_timestamp || 0) > (existing.last_seen_timestamp || 0)) {
                     uniqueMap.set(ip, merged);
                 }
             }
        });
        
        currentPods = Array.from(uniqueMap.values());
        
        if (currentPods.length === 0) {
            output.innerHTML = "<p class='text-gray-500 dark:text-gray-400'>No pods found.</p>";
            return;
        }

        pubkeyCountMap = {};
        pubkeyToIpsMap = {};
        currentPods.forEach(pod => {
            const pk = pod.pubkey || "";
            if (!pk) return;
            pubkeyCountMap[pk] = (pubkeyCountMap[pk] || 0) + 1;
            if (!pubkeyToIpsMap[pk]) pubkeyToIpsMap[pk] = [];
            pubkeyToIpsMap[pk].push(pod.address.split(":")[0]);
        });

        renderTable();

    } catch (e) {
        output.innerHTML = `<p class="text-red-500">Error: Could not reach RPC.</p>`;
    }
}

window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("versionFilterToggle").addEventListener("change", () => { markLoadButton(); renderTable(); });
document.getElementById("versionFilterValue").addEventListener("input", () => { markLoadButton(); renderTable(); });
document.getElementById("globalFilterToggle").addEventListener("change", scheduleFilter);
document.getElementById("globalFilterValue").addEventListener("input", scheduleFilter);

setInterval(() => { if (!document.hidden) sendRpcRequest(); }, 5*60*1000);

const themeToggle = document.getElementById('themeToggle');
const htmlEl = document.documentElement; 

if (localStorage.getItem('theme') === 'dark' || 
   (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    htmlEl.classList.add('dark');
} else {
    htmlEl.classList.remove('dark');
}

themeToggle?.addEventListener('click', () => {
    htmlEl.classList.toggle('dark');
    localStorage.setItem('theme', htmlEl.classList.contains('dark') ? 'dark' : 'light');
});
