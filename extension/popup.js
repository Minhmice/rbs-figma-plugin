const proxyEl = document.getElementById("proxy");
const statusEl = document.getElementById("status");
const collectBtn = document.getElementById("collect");
const pushBtn = document.getElementById("push");
const downloadBtn = document.getElementById("download");

let lastJar = null;

function setStatus(text) {
  statusEl.textContent = text;
}

async function showGoogleStatus() {
  const res = await send({ type: "get-status" });
  if (res.ok) {
    setStatus(`Google signed in: ${res.email}\nAuto-sync ready.`);
  } else {
    setStatus(`Google sign-in required.\n${res.error}`);
  }
}

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: "No response" });
    });
  });
}

async function loadSettings() {
  const { proxyUrl } = await chrome.storage.local.get(["proxyUrl"]);
  proxyEl.value = proxyUrl || "http://localhost:8787";
}

proxyEl.addEventListener("change", () => {
  chrome.storage.local.set({ proxyUrl: proxyEl.value.trim() || "http://localhost:8787" });
});

collectBtn.addEventListener("click", async () => {
  collectBtn.disabled = true;
  setStatus("Collecting…");
  const res = await send({ type: "collect-cookies" });
  collectBtn.disabled = false;
  if (!res.ok) {
    setStatus(`Error: ${res.error}`);
    lastJar = null;
    return;
  }
  lastJar = res.jar;
  setStatus(
    `OK · ${res.jar.cookieCount} cookies\n` +
      `id: ${res.jar.id}\n` +
      `label: ${res.jar.label}\n` +
      (res.jar.email ? `email: ${res.jar.email}\n` : "") +
      `updated: ${res.jar.updatedAt}`
  );
});

pushBtn.addEventListener("click", async () => {
  pushBtn.disabled = true;
  setStatus("Sending to proxy…");
  const proxyUrl = proxyEl.value.trim() || "http://localhost:8787";
  await chrome.storage.local.set({ proxyUrl });
  const res = await send({ type: "push-cookies", proxyUrl });
  pushBtn.disabled = false;
  if (!res.ok) {
    setStatus(
      `Error: ${res.error}\n\nIs npm run server running?\nOr use Download JSON and save into server/cookies/`
    );
    return;
  }
  lastJar = res.jar;
  setStatus(
    `Sent to ${proxyUrl}\n` +
      `${res.jar.cookieCount} cookies → ${res.jar.id}.json\n` +
      `active: ${res.server?.activeId || res.jar.id}`
  );
});

downloadBtn.addEventListener("click", async () => {
  if (!lastJar) {
    const res = await send({ type: "collect-cookies" });
    if (!res.ok) {
      setStatus(`Error: ${res.error}`);
      return;
    }
    lastJar = res.jar;
  }
  const blob = new Blob([JSON.stringify(lastJar, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const filename = `${lastJar.id || "browser-extension"}.json`;
  await chrome.downloads.download({
    url,
    filename,
    saveAs: true,
  });
  setStatus(`Download started → save as server/cookies/${filename}\nThen set active.json activeId to "${lastJar.id}"`);
});

loadSettings();
showGoogleStatus();
