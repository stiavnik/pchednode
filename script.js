let hasLoadedOnce = false;
let ipCache = {}; // Cache for Geo/Name data

// Function to handle retries with exponential backoff
async function fetchWithRetry(url, options = {}, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response;
        } catch (error) {
            console.error(`Fetch attempt ${i + 1} failed for ${url}:`, error);
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000; // Exponential backoff with jitter
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

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
    btn.classList.remove("bg-indigo-600", "hover:bg-indigo-700");
    btn.classList.add("bg-red-500", "hover:bg-red-600");
    btn.textContent = "LOAD (Data stale)";
}

function displayPodTable(pods, rpcUrl) {
    const output = document.getElementById("output");
    const podCountElement = document.getElementById("podCount");

    // Get filter values
    const versionFilterEnabled = document.getElementById('versionFilterToggle').checked;
    const versionFilterValue = document.getElementById('versionFilterValue').value.trim();
    const globalFilterEnabled = document.getElementById('globalFilterToggle').checked;
    const rawGlobalFilterValue = document.getElementById('globalFilterValue').value.trim();

    const filteredPods = [];

    for (const pod of pods) {
        // --- 1. Filter by Version (exact match) ---
        if (versionFilterEnabled && versionFilterValue) {
            if (pod.version !== versionFilterValue) {
                continue;
            }
        }

        // --- 2. Global Filter (Name, IP, PubKey - substring/case-insensitive match) ---
        let isGlobalMatch = true;
        
        if (globalFilterEnabled && rawGlobalFilterValue) {
            // Convert the search term to lowercase once
            const filter = rawGlobalFilterValue.toLowerCase();
            
            // Get name from cache (or 'N/A' if not found)
            const podName = ipCache[pod.address]?.name || 'N/A';
            
            // Perform case-insensitive substring search on all fields
            isGlobalMatch = (
                pod.address.toLowerCase().includes(filter) ||
                pod.pub_key.toLowerCase().includes(filter) ||
                podName.toLowerCase().includes(filter)
            );
        }

        if (!isGlobalMatch) {
            continue;
        }

        filteredPods.push(pod);
    }

    // Update pod count with filtered total
    podCountElement.textContent = filteredPods.length;

    if (filteredPods.length === 0) {
        output.innerHTML = `<p class="text-gray-500 mt-8">No pods found matching your current filters.</p>`;
        return;
    }
    
    // Start building the table HTML
    let tableHTML = `
        <table class="w-full text-sm">
            <thead>
                <tr>
                    <th>IP/Port</th>
                    <th>Name / Country</th>
                    <th>Version</th>
                    <th>Time Since Seen</th>
                    <th>Public Key</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Process filtered pods
    for (const pod of filteredPods) {
        const ip = pod.address; // ip:port
        const pubKeyShort = pod.pub_key ? pod.pub_key.substring(0, 8) + '...' : 'N/A';
        const pubKeyFull = pod.pub_key;
        const timeData = formatRelativeTime(pod.last_seen_timestamp);

        // Retrieve cached geo data or set up placeholders
        const cachedData = ipCache[ip];
        let nameDisplay = cachedData && cachedData.name && cachedData.name !== 'N/A' 
                          ? `<span class="font-semibold text-gray-800">${cachedData.name}</span>`
                          : '<span class="text-gray-400">Loading name...</span>';
                          
        let countryDisplayHtml = cachedData && cachedData.country && cachedData.country !== 'Unknown' 
                                 ? `<img src="https://flagcdn.com/16x12/${cachedData.country_code}.png" alt="${cachedData.country}" class="inline mr-1 border border-gray-300 shadow-sm" onerror="this.style.display='none'"> ${cachedData.country}`
                                 : `<span class="text-gray-400">Loading country...</span>`;

        if (cachedData && (cachedData.country === 'Geo Error' || cachedData.name === 'Geo Error')) {
            nameDisplay = '<span class="text-red-500 font-semibold">Geo Error</span>';
            countryDisplayHtml = '<span class="text-red-500">Geo Error</span>';
        }

        // Generate the table row HTML
        tableHTML += `
            <tr class="transition-shadow duration-200">
                <td class="font-mono text-gray-700">${ip}</td>
                <td>
                    <div id="name-${ip}" class="name-cell">${nameDisplay}</div>
                    <div id="country-${ip}" class="country-cell text-xs text-gray-500">${countryDisplayHtml}</div>
                </td>
                <td class="font-semibold text-indigo-600">${pod.version}</td>
                <td class="${timeData.class}">${timeData.text}</td>
                <td title="${pubKeyFull}" class="font-mono text-xs text-gray-500 hover:text-gray-800 cursor-help">${pubKeyShort}</td>
            </tr>
        `;

        // --- Fetch Geo Data if not in cache ---
        if (!ipCache[ip] || ipCache[ip].country === 'Loading...') {
            // Set initial state for the cache
            if (!ipCache[ip]) {
                ipCache[ip] = { country: 'Loading...', name: 'Loading...' };
            }
            
            // Extract just the IP address (excluding the port)
            const pureIp = ip.split(':')[0];
            
            // Fetch Geo/Name data
            fetchWithRetry(`/api/geo/${pureIp}`)
                .then(response => response.json())
                .then(data => {
                    const name = data.name || 'N/A';
                    const country = data.country || 'Unknown';
                    const countryCode = data.country_code || '--';
                    
                    // Update cache
                    ipCache[ip].country = country;
                    ipCache[ip].country_code = countryCode;
                    ipCache[ip].name = name;

                    // Update UI for this row
                    const nameCell = document.getElementById(`name-${ip}`);
                    if (nameCell) nameCell.innerHTML = name !== 'N/A' 
                                                     ? `<span class="font-semibold text-gray-800">${name}</span>`
                                                     : `<span class="text-gray-400">N/A</span>`;

                    const countryDisplayHtml = country !== 'Unknown'
                        ? `<img src="https://flagcdn.com/16x12/${countryCode}.png" alt="${country}" class="inline mr-1 border border-gray-300 shadow-sm" onerror="this.style.display='none'"> ${country}`
                        : `<span class="text-gray-400">Unknown</span>`;
                        
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
                    ipCache[ip].name = "Geo Error";
                });
        }
    }

    tableHTML += "</tbody></table>";
    output.innerHTML = tableHTML;
}

function loadPodData() {
    const rpcSelector = document.getElementById("rpcSelector");
    const rpcUrl = rpcSelector.value;
    const btn = document.getElementById("loadButton");

    btn.textContent = "Loading...";
    btn.disabled = true;
    btn.classList.add("animate-pulse");

    // Clear the cache only on a fresh load from a new RPC endpoint
    if (!hasLoadedOnce || rpcSelector.dataset.lastUrl !== rpcUrl) {
        ipCache = {};
        rpcSelector.dataset.lastUrl = rpcUrl;
    }

    // Call the server-side proxy
    fetchWithRetry(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ "id": 1, "jsonrpc": "2.0", "method": "state_getPods", "params": [] }) })
        .then(response => response.json())
        .then(data => {
            btn.classList.remove("bg-red-500", "hover:bg-red-600", "animate-pulse");
            btn.classList.add("bg-indigo-600", "hover:bg-indigo-700");
            btn.textContent = "LOAD (Data Fresh)";
            btn.disabled = false;
            hasLoadedOnce = true;

            if (data && data.result && Array.isArray(data.result.pods)) {
                // Initial display with all data (filters applied inside displayPodTable)
                displayPodTable(data.result.pods, rpcUrl);
            } else {
                document.getElementById("output").innerHTML = `<p class="text-red-500 mt-8 font-semibold">Error: Invalid RPC response format.</p>`;
                document.getElementById("podCount").textContent = 'N/A';
            }
        })
        .catch(error => {
            btn.classList.remove("bg-red-500", "hover:bg-red-600", "animate-pulse");
            btn.classList.add("bg-indigo-600", "hover:bg-indigo-700");
            btn.textContent = "LOAD (Data Fresh)"; // Reset button text even on error
            btn.disabled = false;

            console.error("Fetch Error:", error);
            document.getElementById("output").innerHTML = `<p class="text-red-500 mt-8 font-semibold">Error fetching data from RPC. Check console for details.</p><p class="text-gray-500 text-sm mt-2">RPC URL: ${rpcUrl}</p>`;
            document.getElementById("podCount").textContent = 'N/A';
        });
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

// Initial setup on load
window.addEventListener("load", markLoadButton);
window.addEventListener("load", setupEmailObfuscation);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);

// Filter Listeners
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);
document.getElementById("globalFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("globalFilterValue").addEventListener("input", markLoadButton);
document.getElementById("loadButton").addEventListener("click", loadPodData);
