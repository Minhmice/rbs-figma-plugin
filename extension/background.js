/**
 * Collect Magnific/Freepik/Flaticon cookies → CookieJar JSON for server/cookies/
 */
const HOST_FILTER = /magnific\.com$|freepik\.com$|flaticon\.com$/i;
const DEFAULT_PROXY = "http://localhost:8787";
const JAR_ID = "browser-extension";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("sync-cookies", { periodInMinutes: 15 });
  void syncIfMagnificOpen();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync-cookies") void syncIfMagnificOpen();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") void syncIfMagnificOpen();
});

async function syncIfMagnificOpen() {
  const tabs = await chrome.tabs.query({ url: ["*://*.magnific.com/*", "*://*.freepik.com/*"] });
  if (!tabs.length) return;
  try {
    await pushJar();
  } catch {
    // Login may be incomplete or proxy may be offline; next event retries.
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "collect-cookies") {
    collectJar()
      .then((jar) => sendResponse({ ok: true, jar }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg?.type === "push-cookies") {
    pushJar(msg.proxyUrl || DEFAULT_PROXY)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  return false;
});

async function getAllRelevantCookies() {
  const all = await chrome.cookies.getAll({});
  return all.filter((c) => {
    const domain = (c.domain || "").replace(/^\./, "");
    return HOST_FILTER.test(domain);
  });
}

function toCookieHeader(cookies) {
  // Prefer unique names; last write wins (same as browser)
  const map = new Map();
  for (const c of cookies) {
    map.set(c.name, c.value);
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function guessEmail(cookieHeader) {
  try {
    const m = cookieHeader.match(/(?:^|;\s*)GR_TOKEN=([^;]+)/);
    if (!m) return "";
    const jwt = decodeURIComponent(m[1]);
    const payload = jwt.split(".")[1];
    if (!payload) return "";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.email || "";
  } catch {
    return "";
  }
}

async function collectJar() {
  const cookies = await getAllRelevantCookies();
  if (!cookies.length) {
    throw new Error(
      "No Magnific/Freepik cookies found. Open magnific.com, log in, then try again."
    );
  }
  const cookie = toCookieHeader(cookies);
  const email = guessEmail(cookie);
  const jar = {
    id: JAR_ID,
    profile: "extension",
    browser: "chrome",
    label: email ? `extension ${email.split("@")[0]}` : "extension Magnific",
    email: email || undefined,
    cookie,
    updatedAt: new Date().toISOString(),
    cookieCount: cookie.split(";").filter((s) => s.trim()).length,
  };
  return jar;
}

async async function pushJar(proxyUrl = DEFAULT_PROXY) {
  const jar = await collectJar();
  const base = String(proxyUrl || DEFAULT_PROXY).replace(/\/$/, "");
  const res = await fetch(`${base}/cookies/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jar),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(json?.error || `Proxy import failed (${res.status})`);
  }
  return { ok: true, jar, server: json };
}
