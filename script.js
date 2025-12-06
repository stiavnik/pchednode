let hasLoadedOnce = false;
let ipCache = {};
let pubkeyCountMap = {};
let pubkeyToIpsMap = {};

// Global state for rendering & sorting
let currentPods = [];
let sortCol = 'last_seen';
let sortAsc = false;

let renderTimer;          // debounce user sorting
let backgroundTimer;      // one-time re-sort after background updates finish
let isRendering = false;

// ------------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------------
function formatRelativeTime(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return { text: `${diff}s ago`, class: "fresh" };
    if (diff < 3600) return { text: `${Math.floor(diff/60)}m ago`, class: "recent" };
    if (diff < 86400) return { text: `${Math.floor(diff/3600)}h ago`, class: "stale" };
    if (diff < 604800) return { text: `${Math.floor(diff/86400)}d ago`, class: "very-stale" };
    return { text: `${Math.floor(diff/604800)}w ago`, class: "very-stale" };
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

// ------------------------------------------------------------------
// Sorting
// ------------------------------------------------------------------
function handleSort(column) {
    if (sortCol === column) {
        sortAsc = !sortAsc;
    } else {
        sortCol = column;
        sortAsc = (
            column === 'version' || 
            column === 'name' || 
            column === 'pubkey' || 
            column === 'country'
        ); // ascending by default for strings
        // descending by default for numbers/times
        if (['last_seen', 'ping', 'credits', 'balance'].includes(column)) {
            sortAsc = false;
        }
    }
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderTable, 50);
}

function getSortIndicator(col) {
    if (sortCol !== col) return '<span class="text-gray-300 ml-1 opacity-50">↕</span>';
    return sortAsc 
        ? '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↑</span>' 
        : '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↓</span>';
}

// ------------------------------------------------------------------
// Row updates (background geo/ping/balance)
// ------------------------------------------------------------------
function updatePingAndBalance(ip) {
    const cached = ipCache[ip];
    if (!cached) return;
    const nameCell = document.getElementById(`name-${ip}`);
    const row = nameCell?.parentElement;
    if (!row) return;

    // Ping
    let pingHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    if (cached.ping !== undefined) {
        if (cached.ping === null) pingHtml = '<span class="text-red-600 font-medium">offline</span>';
        else if (cached.ping > 400) pingHtml = `<span class="text-red-500">${cached.ping} ms</span>`;
        else if (cached.ping > 200) pingHtml = `<span class="text-orange-500">${cached.ping} ms</span>`;
        else pingHtml = `<span class="text-green-600">${cached.ping} ms</span>`;
    }
    if (row.cells[3]) row.cells[3].innerHTML = `<div class="text-right font-mono text-sm">${pingHtml}</div>`;

    // Credits
    let creditsHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-purple-600 rounded-full animate-spin"></span>';
    if (cached.credits !== undefined) {
        if (cached.credits === null) creditsHtml = `<span class="text-gray-400 text-xs">-</span>`;
        else creditsHtml = `<span class="text-purple-600 dark:text-purple-400 font-bold">${new Intl.NumberFormat().format(cached.credits)}</span>`;
    }
    if (row.cells[4]) row.cells[4].innerHTML = `<div class="text-right font-mono text-sm">${creditsHtml}</div>`;

    // Balance
    let balanceHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
    if (cached.balance !== undefined) {
        if (cached.balance === null) balanceHtml = `<span class="text-gray-400 text-xs">-</span>`;
        else {
            const val = parseFloat(cached.balance);
            const fmt = isNaN(val) ? cached.balance : val.toFixed(3);
            balanceHtml = `<span class="text-indigo-600 dark:text-indigo-400 font-medium">${fmt} ◎</span>`;
        }
    }
    if (row.cells[5]) row.cells[5].innerHTML = `<div class="text-right font-mono text-sm">${balanceHtml}</div>`;
}

function updateRowAfterGeo(ip) {
    const cached = ipCache[ip];
    if (!cached) return;

    const nameCell = document.getElementById(`name-${ip}`);
    const row = nameCell?.parentElement;
    if (!row) return;

    // Name
    if (cached.name && cached.name !== "N/A") {
        nameCell.textContent = cached.name;
        row.classList.add("known-server");
        nameCell.classList.remove("text-gray-500");
        nameCell.classList.add("font-semibold", "text-indigo-700");
    } else if (cached.name === "N/A") {
        nameCell.textContent = "N/A";
        row.classList.remove("known-server");
    }

    // Country
    if (row.cells[2]) row.cells[2].innerHTML = cached.country || "Geo Error";

    updatePingAndBalance(ip);

    // Schedule ONE final re-sort after background updates calm down
    clearTimeout(backgroundTimer);
    backgroundTimer = setTimeout(renderTable, 400);
}

// ------------------------------------------------------------------
// Filtering
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// Main render (full table rebuild – only for sorting / version filter)
// ------------------------------------------------------------------
function renderTable() {
    if (isRendering) return;
    isRendering = true;

    const output = document.getElementById("output");
    let podsToRender = [...currentPods];

    // Version filter
    if (document.getElementById("versionFilterToggle").checked) {
        const v = document.getElementById("versionFilterValue").value.trim();
        if (v) podsToRender = podsToRender.filter(p => p.version === v);
    }

    // Sorting
    podsToRender.sort((a, b) => {
        const ipA = a.address.split(":")[0];
        const ipB = b.address.split(":")[0];
        const cacheA = ipCache[ipA] || {};
        const cacheB = ipCache[ipB] || {};

        let valA, valB;

        switch (sortCol) {
            case 'name':
                valA = cacheA.name || '~~~';
                valB = cacheB.name || '~~~';
                return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            case 'pubkey':
                valA = a.pubkey || '~~~';
                valB = b.pubkey || '~~~';
                return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            case 'country':
                valA = (cacheA.country || '').replace(/<[^>]*>/g, '').trim() || '~~~';
                valB = (cacheB.country || '').replace(/<[^>]*>/g, '').trim() || '~~~';
                return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
            case 'ping':
                valA = (cacheA.ping === null) ? Infinity : (cacheA.ping === undefined ? 99999 : cacheA.ping);
                valB = (cacheB.ping === null) ? Infinity : (cacheB.ping === undefined ? 99999 : cacheB.ping);
                break;
            case 'credits':
                valA = (cacheA.credits === undefined || cacheA.credits === null) ? -1 : cacheA.credits;
                valB = (cacheB.credits === undefined || cacheB.credits === null) ? -1 : cacheB.credits;
                break;
            case 'balance':
                valA = parseFloat(cacheA.balance) || -1;
                valB = parseFloat(cacheB.balance) || -1;
                break;
            case 'last_seen':
                valA = a.last_seen_timestamp || 0;
                valB = b.last_seen_timestamp || 0;
                break;
            case 'version':
                // Proper handling of missing versions → push to bottom
                if (!a.version && !b.version) return 0;
                if (!a.version) return sortAsc ? 1 : -1;
                if (!b.version) return sortAsc ? -1 : 1;
                const cmp = a.version.localeCompare(b.version, undefined, { numeric: true, sensitivity: 'base' });
                return sortAsc ? cmp : -cmp;
            default:
                valA = a.last_seen_timestamp || 0;
                valB = b.last_seen_timestamp || 0;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });

    document.getElementById("podCount").textContent = podsToRender.length;

    // Build HTML
    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="name">Name ${getSortIndicator('name')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="pubkey">Pubkey ${getSortIndicator('pubkey')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="country">Country ${getSortIndicator('country')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="ping">Ping ${getSortIndicator('ping')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="credits">Credits ${getSortIndicator('credits')}</th>
        <th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="balance">Balance ${getSortIndicator('balance')}</th>
        <th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="last_seen">Last Seen ${getSortIndicator('last_seen')}</th>
        <th class="rounded-tr-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="version">Version ${getSortIndicator('version')}</th>
    </tr></thead><tbody>`;

    for (const pod of podsToRender) {
        const ip = pod.address.split(":")[0];
        const { text: timeText, class: timeClass } = formatRelativeTime(pod.last_seen_timestamp);
        const pubkey = pod.pubkey || "";
        const shortKey = pubkey ? pubkey.slice(0,4) + "..." + pubkey.slice(-4) : "N/A";
        const isDuplicated = pubkey && pubkeyCountMap[pubkey] > 1;

        const cached = ipCache[ip] || { name: "N/A", country: '<span class="loading-spinner">Loading</span>', ping: undefined, balance: undefined, credits: undefined };
        const isKnown = cached.name && cached.name !== "N/A";
        const rowClass = (isKnown ? "known-server" : "") + (isDuplicated ? " duplicate-pubkey-row" : "");
        const nameClass = isKnown ? "font-semibold text-indigo-700" : "text-gray-500";
        const pubkeyCellClass = isDuplicated ? "pubkey-duplicate" : "";
        const warningIcon = isDuplicated ? `<span class="warning-icon" title="Duplicates found">!</span>` : "";

        // Placeholders
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

        html += `<tr class="${rowClass}">
            <td id="name-${ip}" class="${nameClass} cursor-pointer" title="IP: ${ip}">${cached.name}</td>
            <td class="font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600 ${pubkeyCellClass}"
                data-pubkey="${pubkey}" onclick="copyPubkey('${pubkey}', this)">
                <span class="short-key">${shortKey}</span>${warningIcon}
            </td>
            <td id="country-${ip}">${cached.country}</td>
            <td class="text-right font-mono text-sm">${pingHtml}</td>
            <td class="text-right font-mono text-sm">${creditsHtml}</td>
            <td class="text-right font-mono text-sm">${balanceHtml}</td>
            <td class="${timeClass}">${timeText}</td>
            <td>${pod.version || ''}</td>
        </tr>`;

        // Trigger background fetch only once per IP
        if (!ipCache[ip] || ipCache[ip].country?.includes("loading-spinner") || ipCache[ip].country === "Geo Error") {
            const rpcUrl = document.getElementById("rpcSelector").value;
            const host = new URL(rpcUrl).hostname;
            const geoBase = `https://${host}/geo`;

            ipCache[ip] = { name: "N/A", country: '<span class="loading-spinner">Loading</span>', ping: undefined, balance: undefined, credits: undefined };

            fetch(`${geoBase}?ip=${ip}&pubkey=${pubkey}`)
                .then(r => { if (!r.ok) throw new Error(); return r.json(); })
                .then(g => {
                    const code = (g.country_code || "").toLowerCase();
                    const flag = code && code !== "--" ? `<img src="${geoBase}/flag/${code}" alt="${code}" class="inline-block mr-2" style="width:16px;height:auto;">` : "";
                    ipCache[ip] = {
                        name: g.name || "N/A",
                        country: `${flag} ${g.country || "Unknown"}`,
                        ping: g.ping,
                        balance: g.balance,
                        credits: g.credits
                    };
                    updateRowAfterGeo(ip);
                })
                .catch(() => {
                    ipCache[ip] = { name: "N/A", country: "Geo Error", ping: null, balance: null, credits: null };
                    updateRowAfterGeo(ip);
                });
        }
    }

    html += "</tbody></table>";
    output.innerHTML = html;

    // Event delegation for header clicks (cleaner & survives re-render)
    output.onclick = e => {
        const th = e.target.closest('th[data-sort-col]');
        if (th) {
            const col = th.dataset.sortCol;
            handleSort(col);
        }
    };

    isRendering = false;
    setTimeout(refilterAndRestyle, 0);
}

// ------------------------------------------------------------------
// copy pubkey helper
// ------------------------------------------------------------------
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

// ------------------------------------------------------------------
// MAIN RPC REQUEST (you said it stays the same)
// ------------------------------------------------------------------
async function sendRpcRequest() {
    hasLoadedOnce = true;
    clearLoadButtonHighlight();

    // YOUR ORIGINAL RPC LOGIC HERE – it should populate currentPods, pubkeyCountMap, etc.
    // For brevity I'll just put a placeholder – replace with your real code
    try {
        const rpcUrl = document.getElementById("rpcSelector").value;
        const resp = await fetch(rpcUrl, { method: "POST", body: JSON.stringify({ /* your RPC payload */ }), headers: { "Content-Type": "application/json" } });
        const data = await resp.json();
        // ... process data into currentPods, pubkeyCountMap, etc.
        // Example placeholder:
        currentPods = data.result.pods || []; // <-- adapt to your real structure

        // rebuild pubkeyCountMap
        pubkeyCountMap = {};
        currentPods.forEach(p => {
            if (p.pubkey) pubkeyCountMap[p.pubkey] = (pubkeyCountMap[p.pubkey] || 0) + 1;
        });

        ipCache = {}; // reset cache on each load
        renderTable();
    } catch (err) {
        document.getElementById("output").innerHTML = `<p class="text-red-600">Error loading data: ${err.message}</p>`;
    }
}

// ------------------------------------------------------------------
// UI event listeners
// ------------------------------------------------------------------
window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("loadButton").addEventListener("click", sendRpcRequest);

document.getElementById("versionFilterToggle").addEventListener("change", () => { markLoadButton(); renderTable(); });
document.getElementById("versionFilterValue").addEventListener("input", () => { markLoadButton(); renderTable(); });
document.getElementById("globalFilterToggle").addEventListener("change", scheduleFilter);
document.getElementById("globalFilterValue").addEventListener("input", scheduleFilter);

setInterval(() => { if (!document.hidden) sendRpcRequest(); }, 5*60*1000);

// Dark mode handling
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

document.getElementById("footer-nick")?.addEventListener("click", () => {
    location.href = "mailto:hlasenie-pchednode@yahoo.com";
});
