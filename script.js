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
  btn.style.backgroundColor = "#ffe066";
  btn.style.boxShadow = "0 0 8px #ffcc00";
}

function clearLoadButtonHighlight() {
  const btn = document.getElementById("loadButton");
  btn.style.backgroundColor = "";
  btn.style.boxShadow = "";
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

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "get-pods", id: 1 })
  });

  if (!response.ok) {
    document.getElementById("output").innerHTML = "Error: " + response.statusText;
    return;
  }

  const data = await response.json();
  const pods = data.result?.pods || [];
  const output = document.getElementById("output");
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
    output.innerHTML = "<p>No pods found.</p>";
    return;
  }

  const ipCache = {};
  let tableHTML = `
    <table>
      <thead>
        <tr>
          <th>IP Address</th>
          <th>Country</th>
          <th>Last Seen</th>
          <th>Version</th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const pod of filteredPods) {
    const ip = pod.address.split(":")[0];
    const lastSeen = formatRelativeTime(pod.last_seen_timestamp);
    const country = ipCache[ip] || "Loading...";

    tableHTML += `
      <tr>
        <td>${ip}</td>
        <td id="country-${ip}">${country}</td>
        <td class="${lastSeen.class}">${lastSeen.text}</td>
        <td>${pod.version}</td>
      </tr>
    `;

    if (!ipCache[ip]) {
      fetch(`${geoBase}?ip=${ip}`)
        .then(res => res.json())
        .then(data => {
          const code = data.country_code?.toLowerCase() || "";
          const name = data.country || "Unknown";
          const flag = code ? `<img src="https://flagcdn.com/16x12/${code}.png" alt="${code}" style="margin-right:4px;">` : "";
          ipCache[ip] = `${flag}${name}`;
          const cell = document.getElementById(`country-${ip}`);
          if (cell) cell.innerHTML = ipCache[ip];
        })
        .catch(() => {
          ipCache[ip] = "Error";
          const cell = document.getElementById(`country-${ip}`);
          if (cell) cell.textContent = "Error";
        });
    }
  }

  tableHTML += "</tbody></table>";
  output.innerHTML = tableHTML;
}

window.addEventListener("load", markLoadButton);
document.getElementById("rpcSelector").addEventListener("change", markLoadButton);
document.getElementById("versionFilterToggle").addEventListener("change", markLoadButton);
document.getElementById("versionFilterValue").addEventListener("input", markLoadButton);
