let hasLoadedOnce = false;
const ipCache = {}; // Persistent cache across reloads

function formatRelativeTime(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    const SECONDS_IN_HOUR = 3600;
    const SECONDS_IN_DAY = 86400;
    const SECONDS_IN_WEEK = 604800;

    if (diff < 60) return { text: `${diff} seconds ago`, class: "fresh" };
    if (diff < SECONDS_IN_HOUR) return { text: `${Math.floor(diff / 60)} minutes ago`, class: "recent" };
    if (diff < SECONDS_IN_DAY) return { text: `${Math.floor(diff / SECONDS_IN_HOUR)} hours ago`, class: "stale" };
    if (diff < SECONDS_IN_WEEK) return { text: `${Math.floor(diff / SECONDS_IN_DAY)} days ago`, class: "very-stale" };
    return { text: `${Math.floor(diff / SECONDS_IN_WEEK)} weeks ago`, class: "very-stale" };
}

function markLoadButton() {
    const btn = document.getElementById("loadButton");
    btn.classList.add("bg-yellow-500", "shadow-yellow-400/70");
    btn.classList.remove("bg-indigo-600");
    btn.textContent = hasLoadedOnce ? "RELOAD" : "LOAD";
}

function clearLoadButtonHighlight() {
    const btn = document.getElementById("loadButton");
    btn.classList.remove("bg-yellow-500", "shadow-yellow-400/70");
    btn.classList.add("bg-indigo-600");
}

// Re-apply filtering + known-server styling when new geo data arrives
function refilterAndRestyle() {
    const globalToggle = document.getElementById("globalFilterToggle");
    const globalValue = document.getElementById("globalFilterValue").value.trim().toLowerCase();

    document.querySelectorAll("#output tbody tr").forEach(row => {
        const nameCell = row.querySelector("td[id^='name-']");
        if (!nameCell) return;

        const ip = nameCell.id.replace("name-", "");
        const cached = ipCache[ip] || {};
        const name = (cached.name || "N/A").toLowerCase();
        const ipText = ip.toLowerCase();
        const pubkey = row.cells[1]?.title?.toLowerCase() || "";

        // Apply known-server style if we have a real name
        if (cached.name && cached.name !== "N/A") {
            row.classList.add("known-server");
            nameCell.classList.remove("text-gray-500");
            nameCell.classList.add("font-semibold", "text-indigo-700");
        } else {
            row.classList.remove("known-server");
        }

        // Filtering
        if (!globalToggle.checked || globalValue === "") {
            row.style.display = "";
        } else {
            const matches = ipText.includes(globalValue) || pubkey.includes(globalValue) || name.includes(globalValue);
            row.style.display = matches ? "" : "none";
        }
    });
}

async function sendRpcRequest() {
    const btn = document.getElementById("loadButton");
    if (!hasLoadedOnce) hasLoadedOnce = true;
    btn.textContent = "RELOAD";
    clearLoadButtonHighlight();

    const rpcUrl = document.getElementById("rpcSelector").value;
    const rpcHost = new URL(rpcUrl).hostname;
    const geoBase = `https://${rpcHost}/geo`;

    const output = document.getElementById("output");
    output.innerHTML = '<p class="text-center text-indigo-600 font-semibold">Loading pod list...</p>';

    let response;
    try {
        response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods", id: 1 }) });
    } catch (e) {
        output.innerHTML = `<p class="text-red-500">Network Error: Could not reach ${rpcUrl}.</p>`;
        return;
    }

    if (!response.ok) {
        output.innerHTML = `<p class="text-red-500">Error: RPC returned status ${response.status}.</p>`;
        return;
    }

    const data = await response.json();
    const pods = data.result?.pods || [];

    // Filters
    const versionToggle = document.getElementById("versionFilterToggle");
    const versionValue = document.getElementById("versionFilterValue").value.trim();
    const globalToggle = document.getElementById("globalFilterToggle");
    const globalValue = document.getElementById("globalFilterValue").value.trim();

    let filteredPods = pods;

    if (versionToggle.checked && versionValue !== "") {
        filteredPods = filteredPods.filter(p => p.version === versionValue);
    }

    if (globalToggle.checked && globalValue !== "") {
        const f = globalValue.toLowerCase();
        filteredPods = filteredPods.filter(p => {
            const ip = p.address.split(":")[0].toLowerCase();
            const pubkey = (p.pubkey || "").toLowerCase();
            return ip.includes(f) || pubkey.includes(f);
        });
    }

    filteredPods.sort((a, b) => b.last_seen_timestamp - a.last_seen_timestamp);
    document.getElementById("podCount").textContent = filteredPods.length;

    if (filteredPods.length === 0) {
        output.innerHTML = "<p class='text-gray-500'>No pods found matching the filter criteria.</p>";
        return;
    }

    let tableHTML = `<table class="min-w-full"><thead><tr>
        <th class="rounded-tl-lg cursor-help" title="To have your name listed, send email">Name</th>
        <th>Pubkey</th><th>Country</th><th>Last Seen</th><th class="rounded-tr-lg">Version</th>
    </tr></thead><tbody>`;

    for (const pod of filteredPods) {
        const ip = pod.address.split(":")[0];
        const lastSeen = formatRelativeTime(pod.last_seen_timestamp);
        const fullPubkey = pod.pubkey || "";
        const shortPubkey = fullPubkey.length > 10 ? fullPubkey.slice(0,4) + "..." + fullPubkey.slice(-4) : (fullPubkey || "N/A");

        const cached = ipCache[ip] || {};
        const nameDisplay = cached.name || "N/A";
        const countryDisplay = cached.country || "Loading...";

        tableHTML += `
            <tr>
                <td id="name-${ip}" class="text-gray-500 cursor-pointer font-medium" title="IP: ${ip}\nTo list your name, send email.">
                    ${nameDisplay}
                </td>
                <td class="font-mono text-xs text-gray-600 cursor-help" title="${fullPubkey}">${shortPubkey}</td>
                <td id="country-${ip}">${countryDisplay}</td>
                <td class="${lastSeen.class}">${lastSeen.text}</td>
                <td>${pod.version}</td>
            </tr>`;

        // Geo lookup (only once per IP)
        if (!ipCache[ip]) {
            ipCache[ip] = { country: "Loading...", name: "N/A" };

            fetch(`${geoBase}?ip=${ip}`)
                .then(r => r.json())
                .then(geo => {
                    const code = (geo.country_code || "").toLowerCase();
                    const countryName = geo.country || "Unknown";
                    const serverName = geo.name || "";

                    ipCache[ip].name = serverName || "N/A";
                    ipCache[ip].country = code 
                        ? `<img src="${geoBase}/flag/${code}" alt="${code}" class="inline-block mr-2" style="width:16px;height:auto;"> ${countryName}`
                        : countryName;

                    // Update cells if they exist
                    const nameCell = document.getElementById(`name-${ip}`);
                    const countryCell = document.getElementById(`country-${ip}`);
                    if (nameCell) {
                        nameCell.textContent = serverName || "N/A";
                        if (serverName) {
                            nameCell.setAttribute("title", nameCell.getAttribute("title").replace("To list your name", `Server Name: ${serverName}\nTo list your name`));
                        }
                    }
                    if (countryCell) countryCell.innerHTML = ipCache[ip].country;

                    // This is the key: re-style + re-filter everything
                    refilterAndRestyle();
                })
                .catch(err => {
                    console.error("Geo error for", ip, err);
                    ipCache[ip].country = "Geo Error";
                    ipCache[ip].name = "N/A";
                    refilterAndRestyle();
                });
        }
    }

    tableHTML += "</tbody></table>";
    output.innerHTML = tableHTML;

    // Initial styling pass for already-cached entries
    refilterAndRestyle();
}

function setupEmailObfuscation() {
    const el = document.getElementById("footer-nick");
    if (el) el.addEventListener("click", () => location.href = "mailto:hlasenie-pchednode@yahoo.com");
}

// Event listeners
window.addEventListener("load", markLoadButton);
window.addEventListener("load", setupEmailObfuscation);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);

document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);

document.getElementById("globalFilterToggle").addEventListener("change", () => { markLoadButton(); refilterAndRestyle(); });
document.getElementById("globalFilterValue").addEventListener("input", () => { markLoadButton(); refilterAndRestyle(); });
