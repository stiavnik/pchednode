let hasLoadedOnce = false;
let ipCache = {};
let pubkeyCountMap = {};
let pubkeyToIpsMap = {};

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

function updatePingDisplay(ip) {
    const cached = ipCache[ip];
    if (!cached || cached.ping === undefined) return;

    let pingHtml;
    if (cached.ping === null) {
        pingHtml = '<span class="text-red-600 font-medium">offline</span>';
    } else if (cached.ping > 400) {
        pingHtml = `<span class="text-red-500">${cached.ping} ms</span>`;
    } else if (cached.ping > 200) {
        pingHtml = `<span class="text-orange-500">${cached.ping} ms</span>`;
    } else {
        pingHtml = `<span class="text-green-600">${cached.ping} ms</span>`;
    }

    const nameCell = document.getElementById(`name-${ip}`);
    const row = nameCell?.parentElement;
    if (row && row.cells[3]) {
        row.cells[3].innerHTML = `<div class="text-right font-mono text-sm">${pingHtml}</div>`;
    }
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

    updatePingDisplay(ip);
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

async function sendRpcRequest() {
    if (!hasLoadedOnce) hasLoadedOnce = true;
    document.getElementById("loadButton").textContent = "RELOAD";
    clearLoadButtonHighlight();

    const rpcUrl = document.getElementById("rpcSelector").value;
    const host = new URL(rpcUrl).hostname;
    const geoBase = `https://${host}/geo`;
    const output = document.getElementById("output");
    output.innerHTML = '<p class="text-center text-indigo-600 dark:text-indigo-400 font-semibold">Loading pod list...</p>';

    let data;
    try {
        const res = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods", id: 1 }) });
        if (!res.ok) throw new Error(res.status);  // ← FIXED LINE
        data = await res.json();
    } catch (e) {
        output.innerHTML = `<p class="text-red-500">Error: Could not reach RPC.</p>`;
        return;
    }

    let pods = data.result?.pods || [];

    if (document.getElementById("versionFilterToggle").checked) {
        const v = document.getElementById("versionFilterValue").value.trim();
        if (v) pods = pods.filter(p => p.version === v);
    }

    if (document.getElementById("globalFilterToggle").checked) {
        const f = document.getElementById("globalFilterValue").value.trim().toLowerCase();
        if (f) pods = pods.filter(p => {
            const ip = p.address.split(":")[0].toLowerCase();
            const pk = (p.pubkey || "").toLowerCase();
            const cachedName = ipCache[ip]?.name?.toLowerCase() || "";
            return ip.includes(f) || pk.includes(f) || cachedName.includes(f);
        });
    }

    pods.sort((a, b) => b.last_seen_timestamp - a.last_seen_timestamp);
    document.getElementById("podCount").textContent = pods.length;

    if (pods.length === 0) {
        output.innerHTML = "<p class='text-gray-500 dark:text-gray-400'>No pods found.</p>";
        return;
    }

    // Detect duplicate pubkeys
    pubkeyCountMap = {};
    pubkeyToIpsMap = {};
    pods.forEach(pod => {
        const pk = pod.pubkey || "";
        if (!pk) return;
        pubkeyCountMap[pk] = (pubkeyCountMap[pk] || 0) + 1;
        if (!pubkeyToIpsMap[pk]) pubkeyToIpsMap[pk] = [];
        pubkeyToIpsMap[pk].push(pod.address.split(":")[0]);
    });

    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-help" title="To have your name listed, click email in footer">Name</th>
        <th>Pubkey</th><th>Country</th><th class="text-right">Ping</th><th>Last Seen</th><th class="rounded-tr-lg">Version</th>
    </tr></thead><tbody>`;

    for (const pod of pods) {
        const ip = pod.address.split(":")[0];
        const { text: timeText, class: timeClass } = formatRelativeTime(pod.last_seen_timestamp);
        const pubkey = pod.pubkey || "";
        const shortKey = pubkey ? pubkey.slice(0,4) + "..." + pubkey.slice(-4) : "N/A";
        const isDuplicated = pubkey && pubkeyCountMap[pubkey] > 1;

        const existing = ipCache[ip];
        const needsFetch = !existing || existing.country?.includes("loading-spinner") || existing.country === "Geo Error";
        const cached = existing && !needsFetch ? existing : { name: "N/A", country: '<span class="loading-spinner">Loading</span>', ping: undefined };

        const isKnown = cached.name && cached.name !== "N/A";
        const rowClass = (isKnown ? "known-server" : "") + (isDuplicated ? " duplicate-pubkey-row" : "");
        const nameClass = isKnown ? "font-semibold text-indigo-700" : "text-gray-500";

        const pubkeyCellClass = isDuplicated ? "pubkey-duplicate" : "";
        const warningIcon = isDuplicated ? `<span class="warning-icon" title="This pubkey is used on ${pubkeyCountMap[pubkey]} nodes!">!</span>` : "";

        let pingHtml = cached.ping !== undefined
            ? (cached.ping === null ? '<span class="text-red-600 font-medium">offline</span>'
                : cached.ping > 400 ? `<span class="text-red-500">${cached.ping} ms</span>`
                : cached.ping > 200 ? `<span class="text-orange-500">${cached.ping} ms</span>`
                : `<span class="text-green-600">${cached.ping} ms</span>`)
            : '<span class="inline-block w-3 h-3 border border-gray-400 border-t-indigo-600 rounded-full animate-spin"></span>';

        html += `<tr class="${rowClass}">
            <td id="name-${ip}" class="${nameClass} cursor-pointer" title="IP: ${ip}\nTo list your name, click email in footer">${cached.name}</td>
            <td class="font-mono text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${pubkeyCellClass}"
                data-pubkey="${pubkey}"
                onclick="copyPubkey('${pubkey}', this)"
                title="Click to copy full pubkey${isDuplicated ? '\nDUPLICATE: also on ' + pubkeyToIpsMap[pubkey].filter(i => i !== ip).join(', ') : ''}">
                <span class="short-key">${shortKey}</span>${warningIcon}
            </td>
            <td id="country-${ip}">${cached.country}</td>
            <td class="text-right font-mono text-sm">${pingHtml}</td>
            <td class="${timeClass}">${timeText}</td>
            <td>${pod.version}</td>
        </tr>`;

        if (needsFetch) {
            ipCache[ip] = { name: "N/A", country: '<span class="loading-spinner">Loading</span>', ping: undefined };
            fetch(`${geoBase}?ip=${ip}`)
                .then(r => { if (!r.ok) throw new Error(); return r.json(); })
                .then(g => {
                    const code = (g.country_code || "").toLowerCase();
                    const flag = code && code !== "--" ? `<img src="${geoBase}/flag/${code}" alt="${code}" class="inline-block mr-2" style="width:16px;height:auto;">` : "";
                    ipCache[ip].name = g.name || "N/A";
                    ipCache[ip].country = `${flag} ${g.country || "Unknown"}`;
                    ipCache[ip].ping = g.ping;
                    updateRowAfterGeo(ip);
                    refilterAndRestyle();
                })
                .catch(() => {
                    ipCache[ip].country = "Geo Error";
                    ipCache[ip].ping = null;
                    updateRowAfterGeo(ip);
                    refilterAndRestyle();
                });
        }
    }

    html += "</tbody></table>";
    output.innerHTML = html;
    setTimeout(refilterAndRestyle, 0);
}

// Footer email
document.getElementById("footer-nick")?.addEventListener("click", () => location.href = "mailto:hlasenie-pchednode@yahoo.com");

// UI triggers
window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);
document.getElementById("globalFilterToggle").addEventListener("change", scheduleFilter);
document.getElementById("globalFilterValue").addEventListener("input", scheduleFilter);

setInterval(() => { if (!document.hidden) sendRpcRequest(); }, 5*60*1000);

// ——————— DARK MODE TOGGLE ———————
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    html.classList.add('dark');
} else {
    html.classList.remove('dark');
}

themeToggle?.addEventListener('click', () => {
    html.classList.toggle('dark');
    localStorage.theme = html.classList.contains('dark') ? 'dark' : 'light';
});
