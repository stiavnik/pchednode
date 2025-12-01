let hasLoadedOnce = false;

function formatRelativeTime(timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    // Constants for comparison
    const SECONDS_IN_HOUR = 3600;
    const SECONDS_IN_DAY = 86400; // 24 * 3600
    const SECONDS_IN_WEEK = 604800; // 7 * 86400

    if (diff < 60) return { text: `${diff} seconds ago`, class: "fresh" };
    if (diff < SECONDS_IN_HOUR) return { text: `${Math.floor(diff / 60)} minutes ago`, class: "recent" };
    
    // If less than 1 day, display hours
    if (diff < SECONDS_IN_DAY) return { text: `${Math.floor(diff / SECONDS_IN_HOUR)} hours ago`, class: "stale" };

    // If less than 7 days, display days
    if (diff < SECONDS_IN_WEEK) {
        return { text: `${Math.floor(diff / SECONDS_IN_DAY)} days ago`, class: "very-stale" };
    }
    
    // If 7 days or more, display weeks
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

async function sendRpcRequest() {
    const btn = document.getElementById("loadButton");

    if (!hasLoadedOnce) {
        hasLoadedOnce = true;
    }
    
    btn.textContent = "RELOAD";
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

    const ipCache = {};
    let tableHTML = `
        <table class="min-w-full">
            <thead>
                <tr>
                    <th class="rounded-tl-lg cursor-help" title="To have your name listed, send email">Name</th> 
                    <th>Pubkey</th>
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
        
        const fullPubkey = pod.pubkey || "";
        const shortPubkey = fullPubkey.length > 10 
            ? fullPubkey.substring(0, 4) + "..." + fullPubkey.substring(fullPubkey.length - 4) 
            : (fullPubkey || "N/A");
        
        const countryDisplay = ipCache[ip]?.country || "Loading...";
        const nameDisplay = ipCache[ip]?.name || "N/A";
        
        const nameTitle = `IP: ${ip}\nTo list your name, send email.`;

        tableHTML += `
            <tr class="mb-2">
                <td id="name-${ip}" 
                    class="${nameDisplay !== 'N/A' ? 'font-semibold text-indigo-700 cursor-pointer' : 'text-gray-500 cursor-pointer'}" 
                    title="${nameTitle}">
                    ${nameDisplay}
                </td>
                
                <td class="font-mono text-xs text-gray-600 cursor-help" title="${fullPubkey}">
                    ${shortPubkey}
                </td>
                
                <td id="country-${ip}">${countryDisplay}</td>
                <td class="${lastSeen.class}">${lastSeen.text}</td>
                <td>${pod.version}</td>
            </tr>
        `;

        if (!ipCache[ip]) {
            ipCache[ip] = { country: "Loading...", name: "N/A" };
            
            fetch(`${geoBase}?ip=${ip}`)
                .then(res => res.json())
                .then(geoData => {
                    const code = geoData.country_code?.toLowerCase() || "";
                    const countryName = geoData.country || "Unknown";
                    const serverName = geoData.name;
                    
                    const nameCell = document.getElementById(`name-${ip}`);
                    if (nameCell) {
                        nameCell.textContent = serverName || "N/A";
                        nameCell.classList.remove('text-gray-500');
                        nameCell.classList.add('font-semibold');
                        
                        const currentTitle = nameCell.getAttribute('title');
                        const newTitle = serverName 
                            ? currentTitle.replace(/(\nTo list your name, send email\.)/, `\nServer Name: ${serverName}$1`)
                            : currentTitle;
                        nameCell.setAttribute('title', newTitle);
                        
                        if (serverName) {
                            nameCell.parentElement.classList.add('known-server');
                            nameCell.classList.add('text-indigo-700');
                        } else {
                                nameCell.classList.add('text-gray-500');
                        }
                        ipCache[ip].name = serverName || "N/A";
                    }
                    
                    // --- CHANGED: Use Local Flag ---
                    // We now fetch from ${geoBase}/flag/${code} instead of flagcdn
                    const flag = code ? `<img src="${geoBase}/flag/${code}" alt="${code}" class="inline-block mr-2" style="width:16px; height:auto; display:inline-block;">` : "";
                    const countryDisplayHtml = `${flag} ${countryName}`;
                    
                    ipCache[ip].country = countryDisplayHtml;
                    
                    const countryCell = document.getElementById(`country-${ip}`);
                    if (countryCell) countryCell.innerHTML = countryDisplayHtml;

                })
                .catch(error => {
                    console.error(`Error fetching geo data for ${ip}:`, error);
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

function setupEmailObfuscation() {
    const nickElement = document.getElementById("footer-nick");
    if (nickElement) {
        const part1 = "hlasenie-pchednode";
        const part2 = "yahoo.com";
        
        nickElement.addEventListener("click", () => {
            window.location.href = `mailto:${part1}@${part2}`;
        });
    }
}

window.addEventListener("load", markLoadButton);
window.addEventListener("load", setupEmailObfuscation);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);
