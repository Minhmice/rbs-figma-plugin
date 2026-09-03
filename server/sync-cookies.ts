/**
 * Sync Magnific cookies from Chrome via CDP.
 * Uses a copied profile dir (Chrome 136+ blocks CDP on the default User Data path).
 */
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import CDP from "chrome-remote-interface";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const cookiesDir = join(rootDir, "server", "cookies");
const PORT = Number(process.env.CHROME_CDP_PORT || 9222);
const CDP_USER_DATA = join(process.env.LOCALAPPDATA || "", "MagnificPluginChromeCDP");
const HOST_FILTER = /magnific\.com|freepik\.com|flaticon\.com/i;

export type CookieJar = {
  id: string;
  profile: string;
  browser: string;
  label: string;
  email?: string;
  cookie: string;
  updatedAt: string;
  cookieCount: number;
};

function chromePath(): string {
  const candidates = [
    join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
    join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("chrome.exe not found");
}

function chromeRunning(): boolean {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe"', {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.toLowerCase().includes("chrome.exe");
  } catch {
    return false;
  }
}

async function cdpReachable(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

function syncProfileCopy(): void {
  const srcRoot = join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
  const srcDefault = join(srcRoot, "Default");
  if (!existsSync(srcDefault)) throw new Error("Chrome Default profile not found");

  mkdirSync(CDP_USER_DATA, { recursive: true });
  // Fresh copy of Local State + Default (cookies need Chrome closed)
  const dstDefault = join(CDP_USER_DATA, "Default");
  try {
    execSync(
      `robocopy "${srcDefault}" "${dstDefault}" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /XD Cache "Code Cache" GPUCache "Service Worker" "DawnCache" "GrShaderCache" "ShaderCache"`,
      { stdio: "ignore" }
    );
  } catch (err) {
    // robocopy: exit codes 0-7 = success
    const status = (err as { status?: number }).status ?? 1;
    if (status >= 8) throw err;
  }
  // robocopy exit codes 0-7 are success
  for (const name of ["Local State", "Local State.bak"]) {
    const s = join(srcRoot, name);
    if (existsSync(s)) {
      execSync(`cmd /c copy /Y "${s}" "${join(CDP_USER_DATA, name)}"`, { stdio: "ignore" });
    }
  }
}

async function ensureChromeDebugging(): Promise<void> {
  if (await cdpReachable()) {
    // Ensure it's OUR cdp profile — still ok to reuse
    return;
  }

  console.log("Preparing Chrome CDP profile copy...");
  if (chromeRunning()) {
    throw new Error(
      "Chrome is running. Close Chrome yourself before fallback CDP sync; extension auto-sync avoids this."
    );
  }

  syncProfileCopy();

  console.log(`Starting Chrome CDP on port ${PORT}...`);
  spawn(
    chromePath(),
    [
      `--remote-debugging-port=${PORT}`,
      `--remote-allow-origins=*`,
      `--user-data-dir=${CDP_USER_DATA}`,
      "--profile-directory=Default",
      "--no-first-run",
      "--no-default-browser-check",
      "https://www.magnific.com/",
    ],
    { detached: true, stdio: "ignore", windowsHide: false }
  ).unref();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpReachable()) {
      console.log("CDP ready");
      // Give Magnific a moment to settle cookies
      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
  }
  throw new Error(`Chrome CDP not reachable on port ${PORT}`);
}

function toHeader(cookies: Array<{ name: string; value: string; domain?: string }>): {
  header: string;
  count: number;
} {
  const map = new Map<string, string>();
  for (const c of cookies) {
    if (!HOST_FILTER.test(c.domain || "")) continue;
    map.set(c.name, c.value);
  }
  return {
    header: [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    count: map.size,
  };
}

export async function syncCookiesFromChrome(): Promise<CookieJar[]> {
  await mkdir(cookiesDir, { recursive: true });
  await ensureChromeDebugging();

  const client = await CDP({ port: PORT });
  try {
    const { Network, Storage, Page } = client;
    await Network.enable();
    try {
      await Page.enable();
      await Page.navigate({ url: "https://www.magnific.com/" });
      await new Promise((r) => setTimeout(r, 2500));
    } catch {
      /* optional */
    }

    let cookies: Array<{ name: string; value: string; domain?: string }> = [];
    try {
      const all = await Storage.getCookies({});
      cookies = all.cookies || [];
    } catch {
      const net = await Network.getAllCookies();
      cookies = net.cookies || [];
    }

    const { header, count } = toHeader(cookies);
    if (!count) {
      throw new Error(
        "No Magnific/Freepik cookies found. Log into magnific.com in the CDP Chrome window, then re-run npm run cookies:sync"
      );
    }

    let email = "";
    try {
      const local = JSON.parse(
        await readFile(
          join(process.env.LOCALAPPDATA || "", "Google/Chrome/User Data/Local State"),
          "utf8"
        )
      ) as { profile?: { info_cache?: Record<string, { user_name?: string }> } };
      email = local.profile?.info_cache?.Default?.user_name || "";
    } catch {
      /* ignore */
    }

    const jar: CookieJar = {
      id: "chrome-default",
      profile: "Default",
      browser: "chrome",
      label: email ? `chrome ${email.split("@")[0]} (Default)` : "chrome Default",
      email,
      cookie: header,
      updatedAt: new Date().toISOString(),
      cookieCount: count,
    };

    await writeFile(join(cookiesDir, `${jar.id}.json`), JSON.stringify(jar, null, 2), "utf8");
    await writeFile(
      join(cookiesDir, "active.json"),
      JSON.stringify({ activeId: jar.id, updatedAt: jar.updatedAt }, null, 2),
      "utf8"
    );
    console.log(`OK ${jar.label} — ${jar.cookieCount} cookies -> ${jar.id}.json`);
    console.log("Add more jars later as server/cookies/<id>.json ; set active.json activeId");
    return [jar];
  } finally {
    await client.close();
  }
}

export async function saveCookieJar(jar: CookieJar, makeActive = true): Promise<CookieJar> {
  if (!jar?.id || !jar?.cookie?.trim()) {
    throw new Error("Cookie jar requires id and cookie header");
  }
  await mkdir(cookiesDir, { recursive: true });
  const normalized: CookieJar = {
    id: jar.id.replace(/[^a-zA-Z0-9_-]/g, "_") || "browser-extension",
    profile: jar.profile || "extension",
    browser: jar.browser || "chrome",
    label: jar.label || jar.id,
    email: jar.email,
    cookie: jar.cookie.trim(),
    updatedAt: jar.updatedAt || new Date().toISOString(),
    cookieCount:
      jar.cookieCount ||
      jar.cookie.split(";").map((s) => s.trim()).filter(Boolean).length,
  };
  await writeFile(
    join(cookiesDir, `${normalized.id}.json`),
    JSON.stringify(normalized, null, 2),
    "utf8"
  );
  if (makeActive) {
    await writeFile(
      join(cookiesDir, "active.json"),
      JSON.stringify({ activeId: normalized.id, updatedAt: normalized.updatedAt }, null, 2),
      "utf8"
    );
  }
  return normalized;
}

export async function loadCookieJars(): Promise<CookieJar[]> {
  if (!existsSync(cookiesDir)) return [];
  const files = (await readdir(cookiesDir)).filter(
    (f) => f.endsWith(".json") && f !== "active.json"
  );
  const jars: CookieJar[] = [];
  for (const f of files) {
    try {
      const jar = JSON.parse(await readFile(join(cookiesDir, f), "utf8")) as CookieJar;
      if (jar?.cookie?.trim()) jars.push(jar);
    } catch {
      /* ignore */
    }
  }
  return jars;
}

export async function getCookieRotation(): Promise<string[]> {
  const jars = await loadCookieJars();
  if (!jars.length) return [];
  let activeId = "";
  try {
    activeId =
      (JSON.parse(await readFile(join(cookiesDir, "active.json"), "utf8")) as { activeId?: string })
        .activeId || "";
  } catch {
    /* none */
  }
  return [
    ...jars.filter((j) => j.id === activeId),
    ...jars.filter((j) => j.id !== activeId),
  ].map((j) => j.cookie);
}

export async function getActiveCookieHeader(): Promise<string> {
  const rot = await getCookieRotation();
  return rot[0] || "";
}

export async function getActiveJarMeta(): Promise<{ id: string; label: string } | null> {
  const jars = await loadCookieJars();
  if (!jars.length) return null;
  let activeId = "";
  try {
    activeId =
      (JSON.parse(await readFile(join(cookiesDir, "active.json"), "utf8")) as { activeId?: string })
        .activeId || "";
  } catch {
    /* none */
  }
  const jar = jars.find((j) => j.id === activeId) || jars[0];
  return jar ? { id: jar.id, label: jar.label } : null;
}

if (process.argv[1]?.includes("sync-cookies")) {
  syncCookiesFromChrome()
    .then((jars) => {
      console.log(`Done. ${jars.length} jar(s)`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
