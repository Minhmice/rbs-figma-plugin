/**
 * Persist recently inserted Magnific assets on disk with a 30-day TTL.
 */
import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appDataPath } from "./runtime-path.js";
import type {
  AssetItem,
  AssetKind,
  InsertPayload,
  SearchResponse,
} from "../src/shared/messages.js";

export const recentDir = appDataPath("recent");
const filesDir = join(recentDir, "files");
const indexPath = join(recentDir, "index.json");

export const RECENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const PAGE_SIZE = 24;

export type RecentEntry = {
  id: string;
  kind: AssetKind;
  name: string;
  slug: string;
  thumbnailUrl: string;
  freeSvg?: boolean;
  premium?: boolean;
  usedAt: string;
  payloadKind: "svg" | "image";
  mime?: string;
  file: string;
};

function entryKey(kind: string, id: string): string {
  return `${kind}_${id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isFresh(usedAt: string, now = Date.now()): boolean {
  const t = Date.parse(usedAt);
  if (Number.isNaN(t)) return false;
  return now - t < RECENT_TTL_MS;
}

async function ensureDirs(): Promise<void> {
  await mkdir(filesDir, { recursive: true });
}

async function loadIndex(): Promise<RecentEntry[]> {
  await ensureDirs();
  if (!existsSync(indexPath)) return [];
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: RecentEntry[]): Promise<void> {
  await ensureDirs();
  await writeFile(indexPath, JSON.stringify(entries, null, 2), "utf8");
}

async function removeFileSafe(rel: string): Promise<void> {
  const abs = join(filesDir, rel);
  try {
    await unlink(abs);
  } catch {
    /* missing file is fine */
  }
}

export async function pruneExpired(ttlMs = RECENT_TTL_MS): Promise<number> {
  const now = Date.now();
  const entries = await loadIndex();
  const kept: RecentEntry[] = [];
  let removed = 0;
  for (const e of entries) {
    const t = Date.parse(e.usedAt);
    if (!Number.isNaN(t) && now - t < ttlMs) {
      kept.push(e);
    } else {
      await removeFileSafe(e.file);
      removed++;
    }
  }
  if (removed > 0) await writeIndex(kept);

  // orphan files not in index
  if (existsSync(filesDir)) {
    const names = await readdir(filesDir);
    const known = new Set(kept.map((e) => e.file));
    for (const name of names) {
      if (name === ".gitkeep") continue;
      if (!known.has(name)) await removeFileSafe(name);
    }
  }

  return removed;
}

function toAssetItem(e: RecentEntry): AssetItem {
  return {
    id: e.id,
    kind: e.kind,
    name: e.name,
    slug: e.slug,
    thumbnailUrl: e.thumbnailUrl,
    freeSvg: e.freeSvg,
    premium: e.premium,
  };
}

export async function listRecent(opts: {
  page?: number;
  pageSize?: number;
}): Promise<SearchResponse> {
  await pruneExpired();
  const pageSize = Math.max(1, opts.pageSize || PAGE_SIZE);
  const page = Math.max(1, opts.page || 1);
  const entries = await loadIndex();
  const total = entries.length;
  const lastPage = Math.max(1, Math.ceil(total / pageSize) || 1);
  const start = (page - 1) * pageSize;
  const slice = entries.slice(start, start + pageSize);
  return {
    items: slice.map(toAssetItem),
    page,
    lastPage,
    total,
  };
}

export async function getCachedPayload(
  kind: AssetKind,
  id: string
): Promise<InsertPayload | null> {
  await pruneExpired();
  const entries = await loadIndex();
  const entry = entries.find((e) => e.kind === kind && e.id === id);
  if (!entry || !isFresh(entry.usedAt)) return null;

  // Old inserts cached thumbnail JPGs for vectors — ignore those and re-download the package.
  if ((kind === "vector" || kind === "icon") && entry.payloadKind === "image") {
    return null;
  }

  const abs = join(filesDir, entry.file);
  if (!existsSync(abs)) return null;

  try {
    if (entry.payloadKind === "svg") {
      const svg = await readFile(abs, "utf8");
      // touch usedAt
      entry.usedAt = new Date().toISOString();
      const rest = entries.filter((e) => !(e.kind === kind && e.id === id));
      await writeIndex([entry, ...rest]);
      return { kind: "svg", svg, name: entry.name, source: "svg" };
    }
    const buf = await readFile(abs);
    entry.usedAt = new Date().toISOString();
    const rest = entries.filter((e) => !(e.kind === kind && e.id === id));
    await writeIndex([entry, ...rest]);
    return {
      kind: "image",
      bytesBase64: buf.toString("base64"),
      name: entry.name,
      mime: entry.mime || "image/png",
    };
  } catch {
    return null;
  }
}

export async function saveRecent(
  item: {
    id: string;
    kind: AssetKind;
    name: string;
    slug?: string;
    thumbnailUrl?: string;
    freeSvg?: boolean;
    premium?: boolean;
  },
  payload: InsertPayload
): Promise<void> {
  await ensureDirs();
  const key = entryKey(item.kind, item.id);
  const fileName =
    payload.kind === "svg" ? `${key}.svg` : `${key}.bin`;
  const abs = join(filesDir, fileName);

  if (payload.kind === "svg") {
    await writeFile(abs, payload.svg, "utf8");
  } else {
    await writeFile(abs, Buffer.from(payload.bytesBase64, "base64"));
  }

  const entry: RecentEntry = {
    id: item.id,
    kind: item.kind,
    name: item.name || payload.name,
    slug: item.slug || item.id,
    thumbnailUrl: item.thumbnailUrl || "",
    freeSvg: item.freeSvg,
    premium: item.premium,
    usedAt: new Date().toISOString(),
    payloadKind: payload.kind === "svg" ? "svg" : "image",
    mime: payload.kind === "image" ? payload.mime : undefined,
    file: fileName,
  };

  let entries = await loadIndex();
  const prev = entries.find((e) => e.kind === item.kind && e.id === item.id);
  if (prev && prev.file !== fileName) await removeFileSafe(prev.file);

  entries = entries.filter((e) => !(e.kind === item.kind && e.id === item.id));
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);

  const keptFiles = new Set(entries.map((e) => e.file));
  const allFiles = existsSync(filesDir) ? await readdir(filesDir) : [];
  for (const name of allFiles) {
    if (name === ".gitkeep") continue;
    if (!keptFiles.has(name)) await removeFileSafe(name);
  }

  await writeIndex(entries);
}
