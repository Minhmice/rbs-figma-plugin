/**
 * Sync Magnific cookies from Chrome via CDP.
 * Uses a copied profile dir (Chrome 136+ blocks CDP on the default User Data path).
 */
import { mkdir, writeFile, readdir, readFile, unlink } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:net";
import CDP from "chrome-remote-interface";
import { appDataPath } from "./runtime-path.js";

export const cookiesDir = appDataPath("cookies");
const CDP_USER_DATA = join(process.env.LOCALAPPDATA || "", "MagnificPluginChromeCDP");
const CHROME_PROFILE_ID_PREFIX = "chrome-";
const CHROME_USER_DATA = join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
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

type ChromeProfile = {
  directory: string;
  email?: string;
  name?: string;
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

async function cdpReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function readChromeProfiles(): Promise<ChromeProfile[]> {
  const localStatePath = join(CHROME_USER_DATA, "Local State");
  if (!existsSync(localStatePath)) throw new Error("Chrome User Data not found");
  const profiles = new Map<string, ChromeProfile>();
  try {
    const local = JSON.parse(await readFile(localStatePath, "utf8")) as {
      profile?: {
        info_cache?: Record<string, { user_name?: string; name?: string }>;
      };
    };
    for (const [directory, info] of Object.entries(local.profile?.info_cache || {})) {
      if (directory === "Default" || /^Profile \d+$/.test(directory)) {
        profiles.set(directory, { directory, email: info.user_name, name: info.name });
      }
    }
  } catch {
    /* folder scan below remains authoritative */
  }
  const names = await readdir(CHROME_USER_DATA, { withFileTypes: true });
  for (const entry of names) {
    if (
      entry.isDirectory() &&
      (entry.name === "Default" || /^Profile \d+$/.test(entry.name)) &&
      !profiles.has(entry.name)
    ) {
      profiles.set(entry.name, { directory: entry.name });
    }
  }
  return [...profiles.values()].sort((a, b) => a.directory.localeCompare(b.directory));
}

function syncProfileCopy(profiles: ChromeProfile[]): void {
  mkdirSync(CDP_USER_DATA, { recursive: true });
  // Fresh copy of Local State + all profiles (cookies need Chrome closed).
  for (const { directory } of profiles) {
    const srcProfile = join(CHROME_USER_DATA, directory);
    const dstProfile = join(CDP_USER_DATA, directory);
    try {
      execSync(
        `robocopy "${srcProfile}" "${dstProfile}" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /XD Cache "Code Cache" GPUCache "Service Worker" "DawnCache" "GrShaderCache" "ShaderCache"`,
        { stdio: "ignore" }
      );
    } catch (err) {
      // robocopy: exit codes 0-7 = success
      const status = (err as { status?: number }).status ?? 1;
      if (status >= 8) throw err;
    }
  }
  for (const name of ["Local State", "Local State.bak"]) {
    const source = join(CHROME_USER_DATA, name);
    if (existsSync(source)) {
      execSync(`cmd /c copy /Y "${source}" "${join(CDP_USER_DATA, name)}"`, { stdio: "ignore" });
    }
  }
}

async function launchChromeProfile(profile: ChromeProfile, port: number): Promise<void> {
  console.log(`Starting Chrome CDP for ${profile.directory} on port ${port}...`);
  spawn(
    chromePath(),
    [
      `--remote-debugging-port=${port}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${CDP_USER_DATA}`,
      `--profile-directory=${profile.directory}`,
      "--no-first-run",
      "--no-default-browser-check",
      "https://www.magnific.com/",
    ],
    { detached: true, stdio: "ignore", windowsHide: false }
  ).unref();

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await cdpReachable(port)) {
      await new Promise((r) => setTimeout(r, 2000));
      return;
    }
  }
  throw new Error(`Chrome CDP not reachable on port ${port}`);
}

async function closeChromeProfile(
  client: { Browser: { close(): Promise<unknown> } },
  port: number
): Promise<void> {
  try {
    await client.Browser.close();
  } catch {
    /* Chrome may already have exited */
  }
  for (let i = 0; i < 20; i++) {
    if (!(await cdpReachable(port))) return;
    await new Promise((r) => setTimeout(r, 250));
  }
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
  if (chromeRunning()) {
    throw new Error(
      "Chrome is running. Close Chrome yourself before fallback CDP sync; extension auto-sync avoids this."
    );
  }

  const profiles = await readChromeProfiles();
  if (!profiles.length) throw new Error("No Chrome profiles found");
  syncProfileCopy(profiles);

  const jars: CookieJar[] = [];
  for (const profile of profiles) {
    const port = await freePort();
    let client: Awaited<ReturnType<typeof CDP>> | undefined;
    try {
      await launchChromeProfile(profile, port);
      client = await CDP({ port });
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
        console.warn(`No Magnific cookies in Chrome profile ${profile.directory}`);
        continue;
      }

      const id = `${CHROME_PROFILE_ID_PREFIX}${profile.directory.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const jar: CookieJar = {
        id,
        profile: profile.directory,
        browser: "chrome",
        label: profile.email
          ? `chrome ${profile.email.split("@")[0]} (${profile.name || profile.directory})`
          : `chrome ${profile.name || profile.directory}`,
        email: profile.email,
        cookie: header,
        updatedAt: new Date().toISOString(),
        cookieCount: count,
      };
      jars.push(jar);
      await writeFile(join(cookiesDir, `${jar.id}.json`), JSON.stringify(jar, null, 2), "utf8");
      console.log(`OK ${jar.label} — ${jar.cookieCount} cookies -> ${jar.id}.json`);
    } finally {
      if (client) {
        await closeChromeProfile(
          client as unknown as { Browser: { close(): Promise<unknown> } },
          port
        );
        await client.close();
      }
    }
  }

  if (!jars.length) {
    throw new Error("No Magnific/Freepik cookies found in any Chrome profile");
  }
  const currentFiles = (await readdir(cookiesDir)).filter(
    (file) => file.startsWith(CHROME_PROFILE_ID_PREFIX) && file.endsWith(".json")
  );
  const keep = new Set(jars.map((jar) => `${jar.id}.json`));
  await Promise.all(
    currentFiles
      .filter((file) => !keep.has(file))
      .map((file) => unlink(join(cookiesDir, file)))
  );
  const updatedAt = new Date().toISOString();
  await writeFile(
    join(cookiesDir, "active.json"),
    JSON.stringify({ activeId: jars[0].id, updatedAt }, null, 2),
    "utf8"
  );
  console.log(`Synced ${jars.length} Chrome profile(s)`);
  return jars;
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
