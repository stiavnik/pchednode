let hasLoadedOnce = false;
let ipCache = {};
let pubkeyCountMap = {};
let pubkeyToIpsMap = {};

// --- Global State ---
let currentPods = [];
let sortCol = 'last_seen'; 
let sortAsc = false;      

function formatRelativeTime(ts) {
    if (!ts) return { text: "-", class: "text-gray-400" };
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return { text: `${diff}s ago`, class: "fresh" };
    if (diff < 3600) return { text: `${Math.floor(diff/60)}m ago`, class: "recent" };
    if (diff < 86400) return { text: `${Math.floor(diff/3600)}h ago`, class: "stale" };
    if (diff < 604800) return { text: `${Math.floor(diff/86400)}d ago`, class: "very-stale" };
    return { text: `${Math.floor(diff/604800)}w ago`, class: "very-stale" };
}

// --- NEW: Uptime Formatter ---
function formatUptime(seconds) {
    if (seconds === null || seconds === undefined) return "-";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h`;
    return `${Math.floor(seconds/86400)}d`;
}

// --- NEW: Storage Formatter ---
function formatStorage(bytes) {
    if (bytes === null || bytes === undefined) return "-";
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`;
    return `${gb.toFixed(1)} GB`;
}

// --- NEW: Percent Formatter ---
function formatPercent(val) {
    if (val === null || val === undefined) return "-";
    // val is 0.0248 -> 2.48%
    return `${(val * 100).toFixed(2)}%`;
}

// --- NEW: Clean Version (Strip dash) ---
function cleanVersion(v) {
    if (!v || v === "unknown") return "unknown";
    return v.split('-')[0];
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

function copyPubkey(text, element) {
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

function updatePingAndBalance(ip) {
    const cached = ipCache[ip];
    if (!cached) return;
    const nameCell = document.getElementById(`name-${ip}`);
    const row = nameCell?.parentElement;
    if (!row) return;

    // Ping (Column index shifted due to new columns)
    // We will use ID or strict query selectors to find cells safely, 
    // but here we just update innerHTML of specific cell indexes.
    // Let's verify indexes:
    // 0:Name, 1:Pubkey, 2:Public, 3:Country, 4:Storage, 5:Used, 6:Uptime, 7:Ping, 8:Credits, 9:Balance, 10:LastSeen, 11:Version
    
    // Ping is at index 7
    let pingHtml;
    if (cached.ping === undefined) {
         pingHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    } else if (cached.ping === null) {
        pingHtml = '<span class="text-red-600 font-medium">offline</span>';
    } else if (cached.ping > 400) {
        pingHtml = `<span class="text-red-500">${cached.ping} ms</span>`;
    } else if (cached.ping > 200) {
        pingHtml = `<span class="text-orange-500">${cached.ping} ms</span>`;
    } else {
        pingHtml = `<span class="text-green-600">${cached.ping} ms</span>`;
    }
    if (row.cells[7]) row.cells[7].innerHTML = `<div class="text-right font-mono text-sm">${pingHtml}</div>`;

    // Credits (index 8)
    let creditsHtml;
    if (cached.credits !== undefined) {
        if (cached.credits === null) {
            creditsHtml = `<span class="text-gray-400 text-xs">-</span>`;
        } else {
            const val = new Intl.NumberFormat().format(cached.credits);
            creditsHtml = `<span class="text-purple-600 dark:text-purple-400 font-bold">${val}</span>`;
        }
    } else {
        creditsHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-purple-600 rounded-full animate-spin"></span>';
    }
    if (row.cells[8]) row.cells[8].innerHTML = `<div class="text-right font-mono text-sm">${creditsHtml}</div>`;

    // Balance (index 9)
    let balanceHtml;
    if (cached.balance !== undefined && cached.balance !== null) {
         const val = parseFloat(cached.balance);
         const fmt = isNaN(val) ? cached.balance : val.toFixed(3);
         balanceHtml = `<span class="text-indigo-600 dark:text-indigo-400 font-medium">${fmt} ◎</span>`;
    } else if (cached.balance === null) {
         balanceHtml = `<span class="text-gray-400 text-xs">-</span>`;
    } else {
         balanceHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    }
    if (row.cells[9]) row.cells[9].innerHTML = `<div class="text-right font-mono text-sm">${balanceHtml}</div>`;
}

function updateRowAfterGeo(ip) {
    const cached = ipCache[ip];
    if (!cached) return;

    const nameCell = document.getElementById(`name-${ip}`);
    const row = nameCell?.parentElement;
    if (!row) return;

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

    const countryCell = row.cells[3]; // Country is index 3
    if (countryCell) {
        countryCell.innerHTML = cached.country || "Geo Error";
    }

    updatePingAndBalance(ip);
}

function refilterAndRestyle() {
    const toggle = document.getElementById("globalFilterToggle").checked;
    const value = document.getElementById("globalFilterValue").value.trim().toLowerCase();

    document.querySelectorAll("#output tbody tr").forEach(row => {
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
    const output = document.getElementById("output");
    
    if (!currentPods) return;
    let podsToRender = [...currentPods];

    // 1. FILTER (Version) - Clean version before check
    if (document.getElementById("versionFilterToggle").checked) {
        const v = document.getElementById("versionFilterValue").value.trim();
        if (v) podsToRender = podsToRender.filter(p => cleanVersion(p.version) === v);
    }

    // 2. SORT
    podsToRender.sort((a, b) => {
        const ipA = a.address.split(":")[0];
        const ipB = b.address.split(":")[0];
        const cacheA = ipCache[ipA] || { name: "", country: "" };
        const cacheB = ipCache[ipB] || { name: "", country: "" };

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
                valA = (cacheA.country || "").replace(/<[^>]*>?/gm, '').trim().toLowerCase();
                valB = (cacheB.country || "").replace(/<[^>]*>?/gm, '').trim().toLowerCase();
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

    // 3. BUILD HTML (12 columns total)
    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('name')">
            Name ${getSortIndicator('name')}
        </th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('pubkey')">
            Pubkey ${getSortIndicator('pubkey')}
        </th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('is_public')">
            Public ${getSortIndicator('is_public')}
        </th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('country')">
            Country ${getSortIndicator('country')}
        </th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('storage')">
            Storage ${getSortIndicator('storage')}
        </th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('usage')">
            % Used ${getSortIndicator('usage')}
        </th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('uptime')">
            Uptime ${getSortIndicator('uptime')}
        </th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('ping')">
            Ping ${getSortIndicator('ping')}
        </th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('credits')">
            Credits ${getSortIndicator('credits')}
        </th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('balance')">
            Balance ${getSortIndicator('balance')}
        </th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('last_seen')">
            Last Seen ${getSortIndicator('last_seen')}
        </th>
        <th class="rounded-tr-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" onclick="handleSort('version')">
            Version ${getSortIndicator('version')}
        </th>
    </tr></thead><tbody>`;

    for (const pod of podsToRender) {
        const ip = pod.address.split(":")[0];
        const { text: timeText, class: timeClass } = formatRelativeTime(pod.last_seen_timestamp);
        const pubkey = pod.pubkey || "";
        const shortKey = pubkey ? pubkey.slice(0,4) + "..." + pubkey.slice(-4) : "N/A";
        const isDuplicated = pubkey && pubkeyCountMap[pubkey] > 1;

        // Check cache
        const existing = ipCache[ip];
        const needsFetch = !existing || existing.country?.includes("loading-spinner") || existing.country === "Geo Error";
        
        const cached = existing && !needsFetch ? existing : { 
            name: "N/A", country: '<span class="loading-spinner">Loading</span>', ping: undefined, balance: undefined, credits: undefined 
        };

        const isKnown = cached.name && cached.name !== "N/A";
        const rowClass = (isKnown ? "known-server" : "") + (isDuplicated ? " duplicate-pubkey-row" : "");
        const nameClass = isKnown ? "font-semibold text-indigo-700" : "text-gray-500";
        const pubkeyCellClass = isDuplicated ? "pubkey-duplicate" : "";
        const warningIcon = isDuplicated ? `<span class="warning-icon" title="Duplicates found">!</span>` : "";

        // -- Placeholders for Ping/Credits/Balance --
        let pingHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
        if (cached.ping !== undefined) {
             if (cached.ping === null) pingHtml = '<span class="text-red-600 font-medium">offline</span>';
             else if (cached.ping > 400) pingHtml = `<span class="text-red-500">${cached.ping} ms</span>`;
             else if (cached.ping > 200) pingHtml = `<span class="text-orange-500">${cached.ping} ms</span>`;
             else pingHtml = `<span class="text-green-600">${cached.ping} ms</span>`;
        }

        let creditsHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-purple-600 rounded-full animate-spin"></span>';
        if (cached.credits !== undefined) {
            if (cached.credits === null) creditsHtml = `<span class="text-gray-400 text-xs">-</span>`;
            else creditsHtml = `<span class="text-purple-600 dark:text-purple-400 font-bold">${new Intl.NumberFormat().format(cached.credits)}</span>`;
        }

        let balanceHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
        if (cached.balance !== undefined) {
            if (cached.balance === null) balanceHtml = `<span class="text-gray-400 text-xs">-</span>`;
            else {
                const val = parseFloat(cached.balance);
                const fmt = isNaN(val) ? cached.balance : val.toFixed(3);
                balanceHtml = `<span class="text-indigo-600 dark:text-indigo-400 font-medium">${fmt} ◎</span>`;
            }
        }

        // -- NEW COLUMNS FORMATTING --
        const publicStr = (pod.is_public === true) ? "Yes" : (pod.is_public === false ? "No" : "-");
        const storageStr = formatStorage(pod.storage_committed);
        const usageStr = formatPercent(pod.storage_usage_percent);
        const uptimeStr = formatUptime(pod.uptime);
        const versionStr = cleanVersion(pod.version);

        html += `<tr class="${rowClass}">
            <td id="name-${ip}" class="${nameClass}" title="IP: ${ip}">${cached.name}</td>
            <td class="font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600 ${pubkeyCellClass}"
                data-pubkey="${pubkey}" onclick="copyPubkey('${pubkey}', this)">
                <span class="short-key">${shortKey}</span>${warningIcon}
            </td>
            <td>${publicStr}</td>
            <td id="country-${ip}">${cached.country}</td>
            <td class="text-right font-mono text-sm">${storageStr}</td>
            <td class="text-right font-mono text-sm">${usageStr}</td>
            <td class="text-right font-mono text-sm">${uptimeStr}</td>
            <td class="text-right font-mono text-sm">${pingHtml}</td>
            <td class="text-right font-mono text-sm">${creditsHtml}</td>
            <td class="text-right font-mono text-sm">${balanceHtml}</td>
            <td class="${timeClass}">${timeText}</td>
            <td>${versionStr}</td>
        </tr>`;

        // Fetch Geo if needed
        if (needsFetch) {
            const rpcUrl = document.getElementById("rpcSelector").value;
            const host = new URL(rpcUrl).hostname;
            const geoBase = `https://${host}/geo`;
            
            ipCache[ip] = { name: "N/A", country: '<span class="loading-spinner">Loading</span>', ping: undefined, balance: undefined, credits: undefined };
            
            fetch(`${geoBase}?ip=${ip}&pubkey=${pubkey}`)
                .then(r => { if (!r.ok) throw new Error(); return r.json(); })
                .then(g => {
                    const code = (g.country_code || "").toLowerCase();
                    const flag = code && code !== "--" ? `<img src="${geoBase}/flag/${code}" alt="${code}" class="inline-block mr-2" style="width:16px;height:auto;">` : "";
                    ipCache[ip].name = g.name || "N/A";
                    ipCache[ip].country = `${flag} ${g.country || "Unknown"}`;
                    ipCache[ip].ping = g.ping;
                    ipCache[ip].balance = g.balance;
                    ipCache[ip].credits = g.credits;
                    updateRowAfterGeo(ip);
                })
                .catch(() => {
                    ipCache[ip].country = "Geo Error";
                    ipCache[ip].ping = null;
                    ipCache[ip].balance = null;
                    ipCache[ip].credits = null;
                    updateRowAfterGeo(ip);
                });
        }
    }

    html += "</tbody></table>";
    output.innerHTML = html;
    
    setTimeout(refilterAndRestyle, 0);
}

async function sendRpcRequest() {
    if (!hasLoadedOnce) hasLoadedOnce = true;
    document.getElementById("loadButton").textContent = "RELOAD";
    clearLoadButtonHighlight();

    const rpcUrl = document.getElementById("rpcSelector").value;
    const output = document.getElementById("output");
    output.innerHTML = '<p class="text-center text-indigo-600 dark:text-indigo-400 font-semibold">Loading pod list...</p>';

    try {
        // --- CHANGED to get-pods-with-stats ---
        const res = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods-with-stats", id: 1 }) });
        
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        
        const rawPods = data.result?.pods || [];
        const uniqueMap = new Map();

        // Filter duplicates, keep freshest
        rawPods.forEach(p => {
             const ip = p.address ? p.address.split(':')[0] : 'unknown';
             if (ip === 'unknown') return;

             if (!uniqueMap.has(ip)) {
                 uniqueMap.set(ip, p);
             } else {
                 const existing = uniqueMap.get(ip);
                 // Preserve stats if new pod (e.g. from gossip) lacks them
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

// Event Listeners
document.getElementById("footer-nick")?.addEventListener("click", () => {
    location.href = "mailto:hlasenie-pchednode@yahoo.com";
});

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
