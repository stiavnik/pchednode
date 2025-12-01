let hasLoadedOnce = false;
const ipCache = {};

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

// Click-to-copy full pubkey with nice feedback
function copyPubkey(text, element) {
    navigator.clipboard.writeText(text).then(() => {
        const original = element.textContent;
        element.textContent = "Copied!";
        element.classList.replace("text-gray-600", "text-green-600");
        element.classList.add("font-bold");
        setTimeout(() => {
            element.textContent = original;
            element.classList.replace("text-green-600", "text-gray-600");
            element.classList.remove("font-bold");
        }, 1000);
    });
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
        const pubkey = row.cells[1]?.title?.toLowerCase() || "";

        // Known-server styling
        if (cache.name && cache.name !== "N/A") {
            row.classList.add("known-server");
            nameCell.classList.remove("text-gray-500");
            nameCell.classList.add("font-semibold", "text-indigo-700");
        } else {
            row.classList.remove("known-server");
        }

        // Filtering
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
    output.innerHTML = '<p class="text-center text-indigo-600 font-semibold">Loading pod list...</p>';

    let data;
    try {
        const res = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods", id: 1 }) });
        if (!res.ok) throw new Error(res.status);
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
            return ip.includes(f) || pk.includes(f);
        });
    }

    pods.sort((a, b) => b.last_seen_timestamp - a.last_seen_timestamp);
    document.getElementById("podCount").textContent = pods.length;

    if (pods.length === 0) {
        output.innerHTML = "<p class='text-gray-500'>No pods found.</p>";
        return;
    }

    let html = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-help" title="To have your name listed, send email">Name</th>
        <th>Pubkey</th><th>Country</th><th>Last Seen</th><th class="rounded-tr-lg">Version</th>
    </tr></thead><tbody>`;

    for (const pod of pods) {
        const ip = pod.address.split(":")[0];
        const { text: timeText, class: timeClass } = formatRelativeTime(pod.last_seen_timestamp);
        const pubkey = pod.pubkey || "";
        const shortKey = pubkey ? pubkey.slice(0,4) + "..." + pubkey.slice(-4) : "N/A";
        const cached = ipCache[ip] || {};
        const name = cached.name || "N/A";
        const country = cached.country || '<span class="loading-spinner">Loading</span>';

        html += `<tr>
            <td id="name-${ip}" class="text-gray-500 cursor-pointer" title="IP: ${ip}\nTo list your name, send email.">${name}</td>
            <td class="font-mono text-xs text-gray-600 cursor-pointer hover:text-indigo-600 transition-colors"
                onclick="copyPubkey('${pubkey}', this)" title="Click to copy full pubkey">${shortKey}</td>
            <td id="country-${ip}">${country}</td>
            <td class="${timeClass}">${timeText}</td>
            <td>${pod.version}</td>
        </tr>`;

        if (!ipCache[ip]) {
            ipCache[ip] = { name: "N/A", country: '<span class="loading-spinner">Loading</span>' };
            fetch(`${geoBase}?ip=${ip}`).then(r => r.json()).then(g => {
                const code = (g.country_code || "").toLowerCase();
                const flag = code ? `<img src="${geoBase}/flag/${code}" alt="${code}" class="inline-block mr-2" style="width:16px;height:auto;">` : "";
                ipCache[ip].name = g.name || "N/A";
                ipCache[ip].country = `${flag} ${g.country || "Unknown"}`;
                const nc = document.getElementById(`name-${ip}`);
                const cc = document.getElementById(`country-${ip}`);
                if (nc) nc.textContent = ipCache[ip].name;
                if (cc) cc.innerHTML = ipCache[ip].country;
                if (g.name) nc?.setAttribute("title", nc.title.replace("To list your name", `Server Name: ${g.name}\nTo list your name`));
                refilterAndRestyle();
            }).catch(() => {
                ipCache[ip].country = "Geo Error";
                refilterAndRestyle();
            });
        }
    }

    html += "</tbody></table>";
    output.innerHTML = html;
    refilterAndRestyle();
}

// Footer email
document.getElementById("footer-nick")?.addEventListener("click", () => location.href = "mailto:hlasenie-pchednode@yahoo.com");

// Listeners
window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);
document.getElementById("globalFilterToggle").addEventListener("change", scheduleFilter);
document.getElementById("globalFilterValue").addEventListener("input", scheduleFilter);

// Auto-refresh every 5 minutes
setInterval(() => { if (!document.hidden) sendRpcRequest(); }, 5*60*1000);
