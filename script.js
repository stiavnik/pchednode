let hasLoadedOnce = false;

function formatRelativeTime(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return { text: `${diff} seconds ago`, class: "fresh" };
    if (diff < 3600) return { text: `${Math.floor(diff / 60)} minutes ago`, class: "recent" };
    return { text: `${Math.floor(diff / 3600)} hours ago`, class: "stale" };
}

function markLoadButton() {
    const btn = document.getElementById("loadButton");
    btn.classList.add("bg-yellow-500", "shadow-yellow-400/70");
    btn.classList.remove("bg-indigo-600");
    btn.textContent = "RELOAD";
}

function clearLoadButtonHighlight() {
    const btn = document.getElementById("loadButton");
    btn.classList.remove("bg-yellow-500", "shadow-yellow-400/70");
    btn.classList.add("bg-indigo-600");
}

async function sendRpcRequest() {
    const btn = document.getElementById("loadButton");
    if (!hasLoadedOnce) {
        btn.textContent = "RELOAD";
        hasLoadedOnce = true;
    }
    clearLoadButtonHighlight();

    const rpcUrl = document.getElementById("rpcSelector").value;
    const rpcHost = new URL(rpcUrl).hostname;
    const geoBase = `https://${rpcHost}/geo`;

    const output = document.getElementById("output");
    output.innerHTML = '<p class="text-center text-indigo-600 font-semibold">Loading pod list...</p>';

    let response;
    try {
        response = await fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods", id: 1 })
        });
    } catch (e) {
        output.innerHTML = `<p class="text-red-500">Network Error: Could not reach ${rpcUrl}.</p>`;
        return;
    }

    if (!response.ok) {
        output.innerHTML = `<p class="text-red-500">Error: RPC returned status ${response.status} (${response.statusText}).</p>`;
        return;
    }

    const data = await response.json();
    const pods = data.result?.pods || [];
    const podCount = document.getElementById("podCount");
    const filterToggle = document.getElementById("versionFilterToggle");
    const filterValue = document.getElementById("versionFilterValue").value.trim();

    let filteredPods = pods;
    if (filterToggle.checked && filterValue !== "") {
        filteredPods = pods.filter(pod => pod.version === filterValue);
    }

    filteredPods.sort((a, b) => b.last_seen_timestamp - a.last_seen_timestamp);
    podCount.textContent = filteredPods.length;

    if (filteredPods.length === 0) {
        output.innerHTML = "<p class='text-gray-500'>No pods found matching the filter criteria.</p>";
        return;
    }

    // Cache to store IP info (Country, Name) to avoid duplicate lookups
    const ipCache = {};
    let tableHTML = `
        <table class="min-w-full">
            <thead>
                <tr>
                    <th class="rounded-tl-lg cursor-help" title="To have your name listed, send email">Name</th> 
                    <th>Pubkey</th> <!-- New Column Header -->
                    <th>IP Address</th>
                    <th>Country</th>
                    <th>Last Seen</th>
                    <th class="rounded-tr-lg">Version</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const pod of filteredPods) {
        const ip = pod.address.split(":")[0];
        const lastSeen = formatRelativeTime(pod.last_seen_timestamp);
        
        // --- NEW: Handle Pubkey ---
        const fullPubkey = pod.pubkey || "";
        // If key is long, truncate it (e.g. "7UMj...XnXv"), otherwise show full
        const shortPubkey = fullPubkey.length > 10 
            ? fullPubkey.substring(0, 4) + "..." + fullPubkey.substring(fullPubkey.length - 4) 
            : (fullPubkey || "N/A");
        
        // Initialize country and name placeholders
        const countryDisplay = ipCache[ip]?.country || "Loading...";
        const nameDisplay = ipCache[ip]?.name || "N/A";

        tableHTML += `
            <tr class="mb-2">
                <td id="name-${ip}" class="${nameDisplay !== 'N/A' ? 'font-semibold text-indigo-700' : 'text-gray-500'}">${nameDisplay}</td>
                
                <!-- NEW: Pubkey Cell -->
                <td class="font-mono text-xs text-gray-600 cursor-help" title="${fullPubkey}">
                    ${shortPubkey}
                </td>
                
                <td>${ip}</td>
                <td id="country-${ip}">${countryDisplay}</td>
                <td class="${lastSeen.class}">${lastSeen.text}</td>
                <td>${pod.version}</td>
            </tr>
        `;

        // If IP not in cache, fetch Geo data
        if (!ipCache[ip]) {
            ipCache[ip] = { country: "Loading...", name: "N/A" }; // Mark as loading
            
            // Asynchronously fetch geo info
            fetch(`${geoBase}?ip=${ip}`)
                .then(res => res.json())
                .then(geoData => {
                    const code = geoData.country_code?.toLowerCase() || "";
                    const countryName = geoData.country || "Unknown";
                    const serverName = geoData.name; // The custom name from geo.py
                    
                    // 1. Update Name Cell
                    const nameCell = document.getElementById(`name-${ip}`);
                    if (nameCell) {
                        nameCell.textContent = serverName || "N/A";
                        nameCell.classList.remove('text-gray-500');
                        nameCell.classList.add('font-semibold');
                        
                        // Highlight the entire row if a custom name is found
                        if (serverName) {
                            nameCell.parentElement.classList.add('known-server');
                            nameCell.classList.add('text-indigo-700');
                        } else {
                                nameCell.classList.add('text-gray-500');
                        }
                        ipCache[ip].name = serverName || "N/A";
                    }
                    
                    // 2. Update Country/Flag Cell
                    const flag = code ? `<img src="https://flagcdn.com/16x12/${code}.png" alt="${code}" class="inline-block mr-2">` : "";
                    const countryDisplayHtml = `${flag}${countryName}`;
                    
                    ipCache[ip].country = countryDisplayHtml;
                    
                    const countryCell = document.getElementById(`country-${ip}`);
                    if (countryCell) countryCell.innerHTML = countryDisplayHtml;

                })
                .catch(error => {
                    console.error(`Error fetching geo data for ${ip}:`, error);
                    // Update Name and Country cells to show error
                    const nameCell = document.getElementById(`name-${ip}`);
                    if (nameCell) nameCell.textContent = "Geo Error";
                    const countryCell = document.getElementById(`country-${ip}`);
                    if (countryCell) countryCell.textContent = "Geo Error";
                    ipCache[ip].country = "Geo Error";
                    ipCache[ip].name = "N/A";
                });
        }
    }

    tableHTML += "</tbody></table>";
    output.innerHTML = tableHTML;
}

// Security: Obfuscate email to prevent bot scraping
function setupEmailObfuscation() {
    const nickElement = document.getElementById("footer-nick");
    if (nickElement) {
        const part1 = "hlasenie-pchednode";
        const part2 = "yahoo.com"; // <-- CHANGE THIS to your actual domain
        
        nickElement.addEventListener("click", () => {
            window.location.href = `mailto:${part1}@${part2}`;
        });
    }
}

// Event Listeners
window.addEventListener("load", markLoadButton);
window.addEventListener("load", setupEmailObfuscation); // Add email security
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);

// Initial load on startup
window.addEventListener("load", sendRpcRequest);
