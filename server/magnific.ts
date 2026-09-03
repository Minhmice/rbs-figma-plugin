import type { AssetItem, AssetKind } from "../src/shared/messages.js";
import { convertBytes, pickBestFromZip, type ConvertResult } from "./convert.js";

const WEB = "https://www.magnific.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

export type WebSearchResult = {
  items: AssetItem[];
  page: number;
  lastPage: number;
  total: number;
};

function headers(cookie?: string, referer?: string): HeadersInit {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: referer || `${WEB}/`,
    Origin: WEB,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };
  if (cookie?.trim()) h.Cookie = cookie.trim();
  return h;
}

async function webGet(pathAndQuery: string, cookie?: string, referer?: string): Promise<unknown> {
  const url = pathAndQuery.startsWith("http") ? pathAndQuery : `${WEB}${pathAndQuery}`;
  const res = await fetch(url, { headers: headers(cookie, referer) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      (json as { message?: string })?.message ||
      (res.status === 403
        ? "Magnific blocked the request. Sync Chrome cookies (logged into magnific.com) and retry."
        : `Magnific web request failed (${res.status})`);
    throw Object.assign(new Error(msg), { status: res.status });
  }
  if (typeof text === "string" && text.includes("bm-verify")) {
    throw Object.assign(new Error("Magnific bot check — sync cookies / open magnific.com once"), {
      status: 403,
    });
  }
  return json;
}

type ThumbEntry = { url?: string; width?: number; height?: number };
type Thumbnails =
  | ThumbEntry[]
  | {
      small?: ThumbEntry;
      medium?: ThumbEntry;
      large?: ThumbEntry;
      [key: string]: ThumbEntry | undefined;
    }
  | undefined;

function pickThumb(thumbnails: Thumbnails, fallback?: string): string {
  if (!thumbnails) return fallback || "";

  if (Array.isArray(thumbnails)) {
    if (!thumbnails.length) return fallback || "";
    const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
    return sorted[0]?.url || fallback || "";
  }

  const preferred =
    thumbnails.large?.url ||
    thumbnails.medium?.url ||
    thumbnails.small?.url ||
    Object.values(thumbnails).find((t) => t?.url)?.url;
  return preferred || fallback || "";
}

function iconCdnUrl(id: string | number): string {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "";
  const prefix = Math.floor(n / 1000);
  return `https://cdn-icons-png.magnific.com/512/${prefix}/${n}.png`;
}

type RawIcon = {
  id?: number | string;
  name?: string;
  title?: string;
  slug?: string;
  free_svg?: boolean;
  freeSvg?: boolean;
  thumbnails?: Thumbnails;
  url?: string;
};

type RawResource = {
  id?: number | string;
  name?: string;
  title?: string;
  slug?: string;
  type?: string;
  premium?: boolean;
  url?: string;
  thumbnails?: Thumbnails;
  preview?: { url?: string; width?: number; height?: number };
  image?: { source?: { url?: string } };
};

type FileTypeItem = { id?: number | string; size?: number; name?: string };
type FileTypes = Record<string, { total?: number; items?: FileTypeItem[] } | undefined>;

type ResourceDetail = {
  id?: number | string;
  name?: string;
  url?: string;
  type?: string;
  premium?: boolean;
  fileTypes?: FileTypes;
  preview?: { url?: string };
};

function formatForKind(kind: AssetKind): string {
  if (kind === "icon") return "SVG, PNG";
  if (kind === "vector") return "EPS, JPG, SVG";
  return "JPG";
}

function buildInfo(opts: {
  kind: AssetKind;
  premium?: boolean;
  freeSvg?: boolean;
  width?: number;
  height?: number;
  moreInfoUrl?: string;
}): AssetItem["info"] {
  const premium = Boolean(opts.premium) || opts.freeSvg === false;
  const w = opts.width;
  const h = opts.height;
  return {
    license: premium ? "Premium" : "Free",
    dimension: w && h ? `${w}px × ${h}px` : "—",
    format: formatForKind(opts.kind),
    attribution: premium ? "Not required" : "Required",
    moreInfoUrl: opts.moreInfoUrl,
  };
}

function mapIcon(raw: RawIcon): AssetItem | null {
  if (raw.id == null) return null;
  const thumb = pickThumb(raw.thumbnails) || iconCdnUrl(raw.id);
  const freeSvg = raw.freeSvg ?? raw.free_svg;
  const moreInfoUrl =
    raw.url ||
    (raw.slug ? `${WEB}/icon/${raw.slug}` : `${WEB}/search?type=icon&query=${raw.id}`);
  const large =
    raw.thumbnails && !Array.isArray(raw.thumbnails)
      ? raw.thumbnails.large || raw.thumbnails.medium || raw.thumbnails.small
      : undefined;
  return {
    id: String(raw.id),
    kind: "icon",
    name: raw.name || raw.title || raw.slug || `Icon ${raw.id}`,
    slug: raw.slug || String(raw.id),
    thumbnailUrl: thumb,
    freeSvg,
    premium: freeSvg === false,
    info: buildInfo({
      kind: "icon",
      freeSvg,
      width: large?.width || 512,
      height: large?.height || 512,
      moreInfoUrl,
    }),
  };
}

function mapResource(raw: RawResource, kind: AssetKind): AssetItem | null {
  if (raw.id == null) return null;
  const premium = Boolean(raw.premium);
  return {
    id: String(raw.id),
    kind,
    name: raw.title || raw.name || raw.slug || `${kind} ${raw.id}`,
    slug: raw.slug || String(raw.id),
    thumbnailUrl: pickThumb(raw.thumbnails, raw.preview?.url || raw.image?.source?.url),
    premium,
    info: buildInfo({
      kind,
      premium,
      width: raw.preview?.width,
      height: raw.preview?.height,
      moreInfoUrl: raw.url,
    }),
  };
}

export async function searchWebIcons(
  opts: { term: string; page: number; iconType?: string; freeSvg?: string },
  cookie?: string
): Promise<WebSearchResult> {
  const url = new URL(`${WEB}/api/icons`);
  if (opts.term) url.searchParams.set("term", opts.term);
  url.searchParams.set("locale", "en");
  url.searchParams.set("format[search]", "1");
  url.searchParams.set("type[icon]", "1");
  url.searchParams.set("page", String(opts.page));
  if (opts.iconType) url.searchParams.append("filters[icon_type][]", opts.iconType);
  if (opts.freeSvg) url.searchParams.set("filters[free_svg]", opts.freeSvg);

  const json = (await webGet(url.toString(), cookie)) as {
    items?: RawIcon[];
    data?: RawIcon[];
    lastPage?: number;
    total?: number;
    pagination?: { last_page?: number; total?: number; current_page?: number; totalPages?: number };
    meta?: {
      pagination?: { last_page?: number; total?: number; current_page?: number; totalPages?: number };
    };
  };

  const rawList = json.items || json.data || [];
  const items = rawList.map(mapIcon).filter(Boolean) as AssetItem[];
  const pag = json.pagination || json.meta?.pagination;
  const lastPage = pag?.last_page || pag?.totalPages || json.lastPage || opts.page;
  const total = pag?.total || json.total || items.length;
  return { items, page: opts.page, lastPage, total };
}

export async function searchWebResources(
  opts: { term: string; page: number; type: "vector" | "photo" },
  cookie?: string
): Promise<WebSearchResult> {
  const url = new URL(`${WEB}/api/regular/search`);
  if (opts.term) url.searchParams.set("term", opts.term);
  url.searchParams.set("locale", "en");
  url.searchParams.set("page", String(opts.page));
  url.searchParams.set("type", opts.type === "photo" ? "photo" : "vector");

  try {
    const json = (await webGet(url.toString(), cookie)) as {
      items?: RawResource[];
      data?: RawResource[];
      lastPage?: number;
      total?: number;
      pagination?: { last_page?: number; total?: number; totalPages?: number };
      meta?: { pagination?: { last_page?: number; total?: number; totalPages?: number } };
    };
    const rawList = json.items || json.data || [];
    const kind: AssetKind = opts.type;
    const items = rawList.map((r) => mapResource(r, kind)).filter(Boolean) as AssetItem[];
    const pag = json.pagination || json.meta?.pagination;
    return {
      items,
      page: opts.page,
      lastPage: pag?.last_page || pag?.totalPages || json.lastPage || opts.page,
      total: pag?.total || json.total || items.length,
    };
  } catch (_err) {
    const fp = new URL("https://www.freepik.com/api/regular/search");
    if (opts.term) fp.searchParams.set("term", opts.term);
    fp.searchParams.set("locale", "en");
    fp.searchParams.set("page", String(opts.page));
    fp.searchParams.set("type", opts.type === "photo" ? "photo" : "vector");
    const json = (await webGet(fp.toString(), cookie)) as {
      items?: RawResource[];
      data?: RawResource[];
      lastPage?: number;
      total?: number;
    };
    const rawList = json.items || json.data || [];
    const items = rawList.map((r) => mapResource(r, opts.type)).filter(Boolean) as AssetItem[];
    return {
      items,
      page: opts.page,
      lastPage: json.lastPage || opts.page,
      total: json.total || items.length,
    };
  }
}

type DownloadJson = {
  filename?: string;
  url?: string;
  signedUrl?: string;
  signed_url?: string;
};

async function requestDownloadUrl(
  opts: {
    resourceId: string;
    file: string;
    option?: string | number;
    referer?: string;
  },
  cookie?: string
): Promise<{ filename: string; url: string }> {
  const q = new URLSearchParams({
    resource: opts.resourceId,
    file: opts.file,
    action: "download",
    locale: "en",
  });
  if (opts.option != null) q.set("option", String(opts.option));

  const json = (await webGet(
    `${WEB}/api/regular/download?${q.toString()}`,
    cookie,
    opts.referer
  )) as DownloadJson;

  const url = json.url;
  if (!url) throw new Error(`No download URL for format ${opts.file}`);
  return { filename: json.filename || `${opts.resourceId}.${opts.file}`, url };
}

async function fetchBinary(url: string, referer?: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      Referer: referer || `${WEB}/`,
    },
  });
  if (!res.ok) throw new Error(`CDN download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.subarray(0, 80).toString("utf8");
  if (head.includes("bm-verify") || head.includes("<!DOCTYPE")) {
    throw new Error("CDN returned HTML challenge — retry after syncing cookies");
  }
  return buf;
}

function pickFileTypeOption(
  fileTypes: FileTypes | undefined,
  format: string
): string | number | undefined {
  const items = fileTypes?.[format]?.items;
  return items?.[0]?.id;
}

const VECTOR_PREF = ["svg", "eps", "ai", "zip"] as const;
const RASTER_ONLY = ["jpg", "jpeg", "png", "webp"] as const;

/**
 * Download the real Magnific package (SVG/EPS/ZIP), never the preview thumbnail.
 * Prefer SVG → EPS → AI → ZIP(extract) → raster only if that is what the package contains.
 */
export async function downloadAssetPackage(
  item: { id: string; kind: AssetKind; name: string; thumbnailUrl?: string; info?: AssetItem["info"] },
  cookie?: string
): Promise<ConvertResult & { filename?: string }> {
  const referer = item.info?.moreInfoUrl || `${WEB}/`;

  if (item.kind === "icon") {
    // Prefer free SVG endpoints, then regular download if available
    const iconTries = [
      `${WEB}/api/icons/${item.id}/download?format=svg`,
      `${WEB}/xhr/svg/${item.id}`,
    ];
    for (const cand of iconTries) {
      try {
        const res = await fetch(cand, { headers: headers(cookie, referer), redirect: "follow" });
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("json")) {
          const j = (await res.json()) as DownloadJson & { data?: DownloadJson };
          const u = j.url || j.data?.url;
          if (u) {
            const bytes = await fetchBinary(u, referer);
            return { ...(await convertBytes(bytes, j.filename || `${item.id}.svg`)), filename: j.filename };
          }
        } else {
          const text = await res.text();
          if (text.includes("<svg")) {
            return { kind: "svg", svg: text, source: "svg", filename: `${item.id}.svg` };
          }
        }
      } catch {
        /* next */
      }
    }
    throw new Error("Could not download icon SVG — sync cookies / check free SVG availability");
  }

  const detail = (await webGet(`${WEB}/api/resources/${item.id}`, cookie, referer)) as ResourceDetail;
  const fileTypes = detail.fileTypes || {};
  const pageReferer = detail.url || referer;

  // Try preferred vector formats first (never start with jpg preview)
  for (const format of VECTOR_PREF) {
    const option = pickFileTypeOption(fileTypes, format);
    if (format !== "zip" && option == null && !fileTypes[format]) continue;
    if (format !== "zip" && option == null) continue;

    try {
      const dl = await requestDownloadUrl(
        {
          resourceId: String(item.id),
          file: format,
          option: format === "zip" ? undefined : option,
          referer: pageReferer,
        },
        cookie
      );
      const bytes = await fetchBinary(dl.url, pageReferer);

      if (format === "zip" || dl.filename.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
        const picked = await pickBestFromZip(bytes);
        const converted = await convertBytes(picked.bytes, picked.name);
        return { ...converted, filename: picked.name };
      }

      const converted = await convertBytes(bytes, dl.filename);
      return { ...converted, filename: dl.filename };
    } catch (err) {
      console.warn(`download ${format} failed:`, err instanceof Error ? err.message : err);
      continue;
    }
  }

  // Only if package formats are raster-only
  for (const format of RASTER_ONLY) {
    const option = pickFileTypeOption(fileTypes, format === "jpeg" ? "jpg" : format);
    if (option == null && !fileTypes[format] && !fileTypes.jpg) continue;
    try {
      const dl = await requestDownloadUrl(
        {
          resourceId: String(item.id),
          file: format === "jpeg" ? "jpg" : format,
          option: option ?? pickFileTypeOption(fileTypes, "jpg"),
          referer: pageReferer,
        },
        cookie
      );
      const bytes = await fetchBinary(dl.url, pageReferer);
      return { ...(await convertBytes(bytes, dl.filename)), filename: dl.filename };
    } catch {
      continue;
    }
  }

  throw new Error(
    "Could not download Magnific package (SVG/EPS/ZIP). Sync Chrome cookies while logged in, then retry."
  );
}

