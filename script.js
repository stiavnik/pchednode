let hasLoadedOnce = false;
let ipCache = {}; // Global cache to store IP -> Geo/Name data

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
    btn.classList.add("bg-yellow-500", "hover:bg-yellow-600");
    btn.classList.remove("bg-indigo-600", "hover:bg-indigo-700");
    
    // If data is already loaded, re-render the table for filtering changes
    if (hasLoadedOnce) {
        // We assume global variable 'rpcData' holds the last fetched data
        if (typeof rpcData !== 'undefined' && rpcData && rpcData.result && rpcData.result.pods) {
            renderTable(rpcData);
        }
    }
}

// Function to fetch Geo data (remains the same as per snippets)
function fetchGeoData(ip, nameCell, countryCell) {
    const geoUrl = `/geo/${ip}`; // Assumes geo-proxy runs on the same host
    
    fetch(geoUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            // Update cache and display
            ipCache[ip].country = data.country || "Unknown";
            ipCache[ip].name = data.name || "N/A";
            ipCache[ip].country_code = data.country_code || "--";

            nameCell.textContent = ipCache[ip].name;

            const flag = ipCache[ip].country_code !== '--' 
                ? `<img src="/flags/${ipCache[ip].country_code}.svg" alt="Flag" class="inline-block w-6 h-4 mr-2 border border-gray-200" onerror="this.onerror=null;this.src='/flags/--.svg';">`
                : '';
            const countryDisplayHtml = `${flag} ${ipCache[ip].country}`;
            countryCell.innerHTML = countryDisplayHtml;

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


function renderTable(data) {
    const output = document.getElementById("output");
    const podCountElement = document.getElementById("podCount");

    if (!data || !data.result || !data.result.pods) {
        output.innerHTML = "<p class=\"text-red-500 mt-8\">Error: Invalid RPC data received.</p>";
        podCountElement.textContent = "0";
        return;
    }

    let pods = data.result.pods;
    
    // --- FILTERING LOGIC ---
    
    // 1. Version Filter
    const versionFilterToggle = document.getElementById("versionFilterToggle").checked;
    const versionFilterValue = document.getElementById("versionFilterValue").value.trim();

    if (versionFilterToggle && versionFilterValue) {
        pods = pods.filter(pod => pod.version === versionFilterValue);
    }
    
    // 2. Global Search Filter
    const globalFilterToggle = document.getElementById("globalFilterToggle").checked;
    const globalFilterValue = document.getElementById("globalFilterValue").value.trim().toLowerCase();
    
    if (globalFilterToggle && globalFilterValue) {
        pods = pods.filter(pod => {
            // Check for IP address match
            if (pod.address.toLowerCase().includes(globalFilterValue)) {
                return true;
            }
            
            // Check for Public Key (PUBKEY) match (assuming this was already working)
            if (pod.public_key.toLowerCase().includes(globalFilterValue)) {
                return true;
            }
            
            // --- FIX: Implement case-insensitive substring search for NAME ---
            // Check the cached name, which can contain spaces and is the source for 'NAME' column
            const cachedPod = ipCache[pod.address];
            const podName = (cachedPod && cachedPod.name) ? cachedPod.name.toLowerCase() : "";
            
            if (podName.includes(globalFilterValue)) {
                return true;
            }
            // --- END FIX ---
            
            return false;
        });
    }

    // Update pod count
    podCountElement.textContent = pods.length;

    if (pods.length === 0) {
        output.innerHTML = "<p class=\"text-gray-500 mt-8\">No pods found matching the filters.</p>";
        return;
    }

    // --- TABLE RENDERING ---
    let tableHTML = `
        <table class="w-full">
            <thead>
                <tr>
                    <th>Version</th>
                    <th>Name</th>
                    <th>Public Key</th>
                    <th>Address</th>
                    <th>Country</th>
                    <th>Last Seen</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const pod of pods) {
        const ip = pod.address;
        const lastSeen = formatRelativeTime(pod.last_seen_timestamp);
        
        // Initialize cache entry if it doesn't exist
        if (!ipCache[ip]) {
            ipCache[ip] = {
                name: "Loading...",
                country: "Loading...",
                country_code: "--"
            };
        }

        const cachedPod = ipCache[ip];

        // Prepare Name and Country display
        let nameDisplay = cachedPod.name;
        let countryFlag = cachedPod.country_code !== '--' 
            ? `<img src="/flags/${cachedPod.country_code}.svg" alt="Flag" class="inline-block w-6 h-4 mr-2 border border-gray-200" onerror="this.onerror=null;this.src='/flags/--.svg';">`
            : '';
        let countryDisplay = `${countryFlag} ${cachedPod.country}`;


        tableHTML += `
            <tr id="row-${ip}">
                <td>${pod.version || 'N/A'}</td>
                <td id="name-${ip}" class="font-semibold">${nameDisplay}</td>
                <td class="text-xs break-all">${pod.public_key || 'N/A'}</td>
                <td class="text-sm break-all">${pod.address}</td>
                <td id="country-${ip}" class="text-sm whitespace-nowrap">${countryDisplay}</td>
                <td class="${lastSeen.class} whitespace-nowrap">${lastSeen.text}</td>
            </tr>
        `;
        
        // Trigger fetch only if the data is not yet loaded
        if (cachedPod.name === "Loading...") {
            // Using a simple delay to ensure the DOM is updated before trying to find the cell elements
            setTimeout(() => {
                const nameCell = document.getElementById(`name-${ip}`);
                const countryCell = document.getElementById(`country-${ip}`);
                if (nameCell && countryCell) {
                    fetchGeoData(ip, nameCell, countryCell);
                } else {
                    console.warn(`Could not find DOM elements for IP: ${ip} after rendering.`);
                }
            }, 10);
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

// Global variable to hold the last fetched RPC data
let rpcData = null;

// The load button handler needs to be able to fetch the data
document.getElementById("loadButton").addEventListener("click", async () => {
    const btn = document.getElementById("loadButton");
    const output = document.getElementById("output");
    
    // Reset button color to indicate loading has started
    btn.classList.remove("bg-yellow-500", "hover:bg-yellow-600");
    btn.classList.add("bg-indigo-600", "hover:bg-indigo-700");
    btn.textContent = "Loading...";

    const rpcUrl = document.getElementById("rpcSelector").value;
    output.innerHTML = `<p class="text-gray-500 mt-8">Fetching data from ${rpcUrl}...</p>`;

    try {
        const response = await fetch(rpcUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        rpcData = data; // Store the fetched data globally
        hasLoadedOnce = true;
        renderTable(rpcData);

    } catch (error) {
        output.innerHTML = `<p class="text-red-500 mt-8">Failed to load data: ${error.message}. Please check the URL or try again later.</p>`;
        console.error("RPC Fetch Error:", error);
    } finally {
        btn.textContent = "LOAD";
    }
});


window.addEventListener("load", markLoadButton);
window.addEventListener("load", setupEmailObfuscation);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);

// Filter Listeners
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);
document.getElementById("globalFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("globalFilterValue").addEventListener("input", markLoadButton);
