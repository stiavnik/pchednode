let hasLoadedOnce = false;
let ipCache = {};
let pubkeyCountMap = {};
let pubkeyToIpsMap = {};

// --- NEW: Global State for Data and Sorting ---
let currentPods = []; // Store the raw pods list here
let sortCol = 'last_seen'; // Default sort column
let sortAsc = false;      // Default descending (highest/newest first)

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

// --- NEW: Handle Sort Click ---
function handleSort(column) {
    if (sortCol === column) {
        // If clicking the same column, toggle direction
        sortAsc = !sortAsc;
    } else {
        // If new column, set it and default to descending (usually better for numbers)
        sortCol = column;
        sortAsc = false; 
        // Exception: For "Name" or "Version", ascending is usually better default
        if (column === 'version' || column === 'name') sortAsc = true;
    }
    renderTable(); // Re-draw table with new sort order
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

    // Ping (Cell 3)
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
    if (row.cells[3]) row.cells[3].innerHTML = `<div class="text-right font-mono text-sm">${pingHtml}</div>`;

    // Credits (Cell 4)
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
    if (row.cells[4]) row.cells[4].innerHTML = `<div class="text-right font-mono text-sm">${creditsHtml}</div>`;

    // Balance (Cell 5)
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
    if (row.cells[5]) row.cells[5].innerHTML = `<div class="text-right font-mono text-sm">${balanceHtml}</div>`;
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

    const countryCell = row.cells[2];
    if (countryCell) {
        countryCell.innerHTML = cached.country || "Geo Error";
    }

    updatePingAndBalance(ip);
}

// Only hides/shows rows, doesn't re-order (rendering does that)
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

// --- NEW: Helper to generate sort arrow HTML ---
function getSortIndicator(col) {
    if (sortCol !== col) return '<span class="text-gray-300 ml-1 opacity-50">↕</span>';
    return sortAsc 
        ? '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↑</span>' 
        : '<span class="text-indigo-600 dark:text-indigo-400 ml-1">↓</span>';
}

// --- NEW: Core Render Function (Sorts & Builds HTML) ---
function renderTable() {
    const output = document.getElementById("output");
    let podsToRender = [...currentPods]; // Copy array to sort safely

    // 1. FILTER (Version)
    if (document.getElementById("versionFilterToggle").checked) {
        const v = document.getElementById("versionFilterValue").value.trim();
        if (v) podsToRender = podsToRender.filter(p => p.version === v);
    }
    
    // 2. FILTER (Text Search - Optional optimization to filter before sort, but current visual filter is CSS based)
    // We stick to CSS filtering in refilterAndRestyle() to avoid re-rendering HTML on every keystroke.

    // 3. SORT
    podsToRender.sort((a, b) => {
        const ipA = a.address.split(":")[0];
        const ipB = b.address.split(":")[0];
        const cacheA = ipCache[ipA] || {};
        const cacheB = ipCache[ipB] || {};

        let valA, valB;

        switch (sortCol) {
			case 'ping':
				// Null (offline) should be last, so treat it as Infinity.
				// Undefined (loading) should be near the bottom, but above offline.
				valA = (cacheA.ping === null) ? Infinity : (cacheA.ping === undefined ? 99999 : cacheA.ping);
				valB = (cacheB.ping === null) ? Infinity : (cacheB.ping === undefined ? 99999 : cacheB.ping);
				
				// For credits and balance, we can keep the -1 or 0 for missing data, 
				// but for Ping, Infinity works best to push "offline" last.
				break;
            case 'credits':
                valA = (cacheA.credits === undefined || cacheA.credits === null) ? -1 : cacheA.credits;
                valB = (cacheB.credits === undefined || cacheB.credits === null) ? -1 : cacheB.credits;
                break;
            case 'balance':
                valA = parseFloat(cacheA.balance) || -1;
                valB = parseFloat(cacheB.balance) || -1;
                break;
			case 'version':
				const vA = a.version || "";
				const vB = b.version || "";

				// 1. Logic to force "Unknown" versions (empty string) to the end of the list (remains correct).
				if (vA === "" && vB !== "") return 1;
				if (vA !== "" && vB === "") return -1;
				if (vA === "" && vB === "") return 0;

				// 2. Semantic versioning comparison for non-empty versions.
				// We use { numeric: true } to ensure 0.9.0 < 0.10.0.
				const comparison = vA.localeCompare(vB, undefined, { numeric: true, sensitivity: 'base' });
				
				// Return the comparison result, reversed if sorting descending.
				return sortAsc ? comparison : -comparison;
            case 'last_seen':
                valA = a.last_seen_timestamp || 0;
                valB = b.last_seen_timestamp || 0;
                break;
            default: // Default to last_seen
                valA = a.last_seen_timestamp || 0;
                valB = b.last_seen_timestamp || 0;
        }

        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
    });

    document.getElementById("podCount").textContent = podsToRender.length;

    // 4. BUILD HTML
    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-help" title="To have your name listed, click email in footer">Name</th>
        <th>Pubkey</th>
        <th>Country</th>
		<th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="ping">
			Ping ${getSortIndicator('ping')}
		</th>
		<th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="credits">
			Credits ${getSortIndicator('credits')}
		</th>
		<th class="text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="balance">
			Balance ${getSortIndicator('balance')}
		</th>
		<th class="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="last_seen">
			Last Seen ${getSortIndicator('last_seen')}
		</th>
		<th class="rounded-tr-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors select-none" data-sort-col="version">
			Version ${getSortIndicator('version')}
        </th>
    </tr></thead><tbody>`;

    for (const pod of podsToRender) {
        const ip = pod.address.split(":")[0];
        const { text: timeText, class: timeClass } = formatRelativeTime(pod.last_seen_timestamp);
        const pubkey = pod.pubkey || "";
        const shortKey = pubkey ? pubkey.slice(0,4) + "..." + pubkey.slice(-4) : "N/A";
        const isDuplicated = pubkey && pubkeyCountMap[pubkey] > 1;

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

        // -- Placeholders (Rendering Logic remains same) --
        // Ping
        let pingHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';
        if (cached.ping !== undefined) {
             if (cached.ping === null) pingHtml = '<span class="text-red-600 font-medium">offline</span>';
             else if (cached.ping > 400) pingHtml = `<span class="text-red-500">${cached.ping} ms</span>`;
             else if (cached.ping > 200) pingHtml = `<span class="text-orange-500">${cached.ping} ms</span>`;
             else pingHtml = `<span class="text-green-600">${cached.ping} ms</span>`;
        }
        // Credits
        let creditsHtml = '<span class="inline-block w-3 h-3 border border-gray-400 border-t-purple-600 rounded-full animate-spin"></span>';
        if (cached.credits !== undefined) {
            if (cached.credits === null) creditsHtml = `<span class="text-gray-400 text-xs">-</span>`;
            else creditsHtml = `<span class="text-purple-600 dark:text-purple-400 font-bold">${new Intl.NumberFormat().format(cached.credits)}</span>`;
        }
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
            <td>${pod.version}</td>
        </tr>`;

        // Only trigger fetch if needed
        if (needsFetch) {
            const rpcUrl = document.getElementById("rpcSelector").value;
            const host = new URL(rpcUrl).hostname;
            const geoBase = `https://${host}/geo`;
            
            // Initialize empty cache entry to prevent multi-fetch
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
                    refilterAndRestyle();
                })
                .catch(() => {
                    ipCache[ip].country = "Geo Error";
                    ipCache[ip].ping = null;
                    ipCache[ip].balance = null;
                    ipCache[ip].credits = null;
                    updateRowAfterGeo(ip);
                    refilterAndRestyle();
                });
        }
    }

    html += "</tbody></table>";
	output.innerHTML = html;

    // --- NEW: Attach Sort Handlers using JavaScript (CSP-compliant) ---
    document.querySelectorAll('#output thead th[data-sort-col]').forEach(header => {
        header.addEventListener('click', () => {
            const column = header.getAttribute('data-sort-col');
            if (column) handleSort(column);
        });
    });
    // ------------------------------------------------------------------

    setTimeout(refilterAndRestyle, 0);
}

// --- MAIN FETCH LOOP ---
async function sendRpcRequest() {
    if (!hasLoadedOnce) hasLoadedOnce = true;
    document.getElementById("loadButton").textContent = "RELOAD";
    clearLoadButtonHighlight();

    const rpcUrl = document.getElementById("rpcSelector").value;
    const output = document.getElementById("output");
    output.innerHTML = '<p class="text-center text-indigo-600 dark:text-indigo-400 font-semibold">Loading pod list...</p>';

    try {
        const res = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods", id: 1 }) });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        
        currentPods = data.result?.pods || [];
        
        if (currentPods.length === 0) {
            output.innerHTML = "<p class='text-gray-500 dark:text-gray-400'>No pods found.</p>";
            return;
        }

        // Calculate duplicates once on load
        pubkeyCountMap = {};
        pubkeyToIpsMap = {};
        currentPods.forEach(pod => {
            const pk = pod.pubkey || "";
            if (!pk) return;
            pubkeyCountMap[pk] = (pubkeyCountMap[pk] || 0) + 1;
            if (!pubkeyToIpsMap[pk]) pubkeyToIpsMap[pk] = [];
            pubkeyToIpsMap[pk].push(pod.address.split(":")[0]);
        });

        // DRAW TABLE
        renderTable();

    } catch (e) {
        output.innerHTML = `<p class="text-red-500">Error: Could not reach RPC.</p>`;
    }
}

// Footer email click
document.getElementById("footer-nick")?.addEventListener("click", () => {
    location.href = "mailto:hlasenie-pchednode@yahoo.com";
});

// UI triggers
window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
// Re-render table (resort/refilter) when version toggle changes
document.getElementById("versionFilterToggle").addEventListener("change", () => { markLoadButton(); renderTable(); });
document.getElementById("versionFilterValue").addEventListener("input", () => { markLoadButton(); renderTable(); });
document.getElementById("globalFilterToggle").addEventListener("change", scheduleFilter);
document.getElementById("globalFilterValue").addEventListener("input", scheduleFilter);

setInterval(() => { if (!document.hidden) sendRpcRequest(); }, 5*60*1000);

// DARK MODE
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
