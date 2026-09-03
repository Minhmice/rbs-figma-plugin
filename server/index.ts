import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  downloadAssetPackage,
  searchWebIcons,
  searchWebResources,
} from "./magnific.js";
import { convertBytes } from "./convert.js";
import {
  getActiveCookieHeader,
  getActiveJarMeta,
  getCookieRotation,
  loadCookieJars,
  saveCookieJar,
  syncCookiesFromChrome,
  type CookieJar,
} from "./sync-cookies.js";
import {
  getCachedPayload,
  listRecent,
  pruneExpired,
  saveRecent,
} from "./recent-assets.js";
import { createJob, getJob, updateJob } from "./jobs.js";
import type {
  AssetItem,
  InsertPayload,
  SearchResponse,
  SearchTab,
} from "../src/shared/messages.js";

const PORT = Number(process.env.PORT || 8787);
const AUTO_SYNC = process.env.COOKIES_AUTO_SYNC === "1";
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 45_000;

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

type SearchCacheEntry = { at: number; body: SearchResponse };
const searchCache = new Map<string, SearchCacheEntry>();

function cookieExpiry(cookie: string): { expiresAt: number | null; stale: boolean } {
  try {
    const m = cookie.match(/(?:^|;\s*)GR_TOKEN=([^;]+)/);
    if (!m) return { expiresAt: null, stale: false };
    const jwt = decodeURIComponent(m[1]);
    const payload = jwt.split(".")[1];
    if (!payload) return { expiresAt: null, stale: false };
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { exp?: number };
    if (!json.exp) return { expiresAt: null, stale: false };
    const expiresAt = json.exp * 1000;
    const stale = expiresAt - Date.now() < 5 * 60 * 1000;
    return { expiresAt, stale };
  } catch {
    return { expiresAt: null, stale: false };
  }
}

app.get("/health", async (c) => {
  const jars = await loadCookieJars();
  const active = await getActiveJarMeta();
  const cookie = await getActiveCookieHeader();
  const { expiresAt, stale } = cookie ? cookieExpiry(cookie) : { expiresAt: null, stale: false };
  return c.json({
    ok: true,
    mode: "web-no-api-key",
    localConvert: true,
    cookieJars: jars.length,
    activeJar: active?.label || null,
    hasCookie: Boolean(cookie),
    cookieExpiresAt: expiresAt,
    cookieStale: stale || (!cookie && jars.length === 0),
  });
});

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function withCookieRotation<T>(
  run: (cookie: string | undefined) => Promise<T>
): Promise<T> {
  const rotation = await getCookieRotation();
  if (!rotation.length) return run(undefined);

  let lastErr: unknown;
  for (const cookie of rotation) {
    try {
      return await run(cookie);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 403 || status === 401) continue;
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function toInsertPayload(
  result: Awaited<ReturnType<typeof convertBytes>>,
  name: string,
  extra?: { cached?: boolean; jobId?: string }
): InsertPayload {
  if (result.kind === "svg") {
    return {
      kind: "svg",
      svg: result.svg,
      name,
      source: result.source,
      cached: extra?.cached,
      jobId: extra?.jobId,
    };
  }
  return {
    kind: "image",
    bytesBase64: result.bytes.toString("base64"),
    name,
    mime: result.mime,
    cached: extra?.cached,
    jobId: extra?.jobId,
  };
}

function friendlyAuthError(err: unknown): Error {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  if (status === 403 || /403|premium|forbidden/i.test(message)) {
    return new HttpError(
      403,
      "Premium / login required — open magnific.com, then click Connect Magnific"
    );
  }
  if (status === 401 || /401|unauthorized/i.test(message)) {
    return new HttpError(401, "Cookie expired — open magnific.com, then click Connect Magnific");
  }
  return err instanceof Error ? err : new Error(message);
}

app.get("/search", async (c) => {
  try {
    const term = c.req.query("term") || "";
    const tab = (c.req.query("tab") || "all") as SearchTab;
    const page = Math.max(1, Number(c.req.query("page") || 1));
    const iconType = c.req.query("iconType") || "";
    const freeSvg = c.req.query("freeSvg") || "";

    if (tab === "recent" || tab === "favorites") {
      if (tab === "recent") return c.json(await listRecent({ page }));
      return c.json({ items: [], page: 1, lastPage: 1, total: 0 } satisfies SearchResponse);
    }

    const cacheKey = `${tab}|${term}|${page}|${iconType}|${freeSvg}`;
    const hit = searchCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL_MS) {
      return c.json(hit.body);
    }

    const body = await withCookieRotation(async (cookie) => {
      if (tab === "all") {
        const [icons, vectors, photos] = await Promise.all([
          searchWebIcons(
            { term, page, iconType: iconType || undefined, freeSvg: freeSvg || undefined },
            cookie
          ),
          searchWebResources({ term, page, type: "vector" }, cookie),
          searchWebResources({ term, page, type: "photo" }, cookie),
        ]);
        return {
          items: [...icons.items, ...vectors.items, ...photos.items],
          page,
          lastPage: Math.max(icons.lastPage, vectors.lastPage, photos.lastPage),
          total: icons.total + vectors.total + photos.total,
        } satisfies SearchResponse;
      }

      const items: AssetItem[] = [];
      let lastPage = 1;
      let total = 0;

      if (tab === "icons") {
        const icons = await searchWebIcons(
          { term, page, iconType: iconType || undefined, freeSvg: freeSvg || undefined },
          cookie
        );
        items.push(...icons.items);
        lastPage = Math.max(lastPage, icons.lastPage);
        total += icons.total;
      }

      if (tab === "vectors") {
        const vectors = await searchWebResources({ term, page, type: "vector" }, cookie);
        items.push(...vectors.items);
        lastPage = Math.max(lastPage, vectors.lastPage);
        total += vectors.total;
      }

      if (tab === "photos") {
        const photos = await searchWebResources({ term, page, type: "photo" }, cookie);
        items.push(...photos.items);
        lastPage = Math.max(lastPage, photos.lastPage);
        total += photos.total;
      }

      return { items, page, lastPage, total } satisfies SearchResponse;
    });

    searchCache.set(cacheKey, { at: Date.now(), body });
    return c.json(body);
  } catch (err) {
    return handleError(c, friendlyAuthError(err));
  }
});

app.get("/recent", async (c) => {
  try {
    const page = Math.max(1, Number(c.req.query("page") || 1));
    return c.json(await listRecent({ page }));
  } catch (err) {
    return handleError(c, err);
  }
});

app.get("/jobs/:id", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ error: "Job not found" }, 404);
  return c.json({
    id: job.id,
    stage: job.stage,
    message: job.message,
    cached: job.cached,
    payload: job.payload,
    error: job.error,
  });
});

async function runInsertJob(
  jobId: string,
  body: {
    id: string;
    kind: AssetItem["kind"];
    name: string;
    slug?: string;
    thumbnailUrl?: string;
    freeSvg?: boolean;
    premium?: boolean;
  }
): Promise<InsertPayload> {
  const name = body.name || `Magnific ${body.kind} ${body.id}`;
  const meta = {
    id: body.id,
    kind: body.kind,
    name,
    slug: body.slug || body.id,
    thumbnailUrl: body.thumbnailUrl || "",
    freeSvg: body.freeSvg,
    premium: body.premium,
  };

  const cached = await getCachedPayload(body.kind, body.id);
  if (cached) {
    const payload =
      cached.kind === "svg"
        ? { ...cached, name, cached: true, jobId }
        : { ...cached, name, cached: true, jobId };
    await saveRecent(meta, payload);
    updateJob(jobId, { stage: "ready", cached: true, message: "From cache", payload });
    return payload;
  }

  updateJob(jobId, { stage: "downloading", message: "Downloading package…" });

  try {
    const payload = await withCookieRotation(async (cookie) => {
      const pageUrl =
        body.kind === "vector"
          ? `https://www.magnific.com/free-vector/${body.slug || body.id}.htm`
          : body.kind === "photo"
            ? `https://www.magnific.com/free-photo/${body.slug || body.id}.htm`
            : `https://www.magnific.com/`;
      updateJob(jobId, { stage: "converting", message: "Converting package…" });
      const got = await downloadAssetPackage(
        {
          id: body.id,
          kind: body.kind,
          name,
          thumbnailUrl: body.thumbnailUrl || "",
          info: {
            license: "",
            dimension: "",
            format: "",
            attribution: "",
            moreInfoUrl: pageUrl,
          },
        },
        cookie
      );
      return toInsertPayload(got, name, { jobId });
    });

    await saveRecent(meta, payload);
    updateJob(jobId, { stage: "ready", message: "Ready", payload });
    return payload;
  } catch (err) {
    const friendly = friendlyAuthError(err);
    updateJob(jobId, {
      stage: "error",
      error: friendly.message,
      message: friendly.message,
    });
    throw friendly;
  }
}

app.post("/insert", async (c) => {
  try {
    const body = await c.req.json<{
      id: string;
      kind: AssetItem["kind"];
      name?: string;
      slug?: string;
      thumbnailUrl?: string;
      freeSvg?: boolean;
      premium?: boolean;
      async?: boolean;
    }>();
    if (!body?.id || !body?.kind) throw new HttpError(400, "id and kind are required");

    const job = createJob();
    const name = body.name || `Magnific ${body.kind} ${body.id}`;

    if (body.async) {
      void runInsertJob(job.id, { ...body, name }).catch(() => undefined);
      return c.json({ jobId: job.id, stage: job.stage });
    }

    const payload = await runInsertJob(job.id, { ...body, name });
    return c.json(payload);
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/convert", async (c) => {
  try {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!file || typeof file === "string") {
      throw new HttpError(400, "multipart field `file` is required");
    }
    const asyncMode = String(form.async || "") === "1" || form.async === "true";
    const bytes = Buffer.from(await file.arrayBuffer());
    const name = file.name || "asset";
    const job = createJob();

    const run = async () => {
      updateJob(job.id, { stage: "converting", message: `Converting ${name}…` });
      try {
        const got = await convertBytes(bytes, name);
        const payload = toInsertPayload(
          got,
          name.replace(/\.[^.]+$/, "") || "Converted",
          { jobId: job.id }
        );
        updateJob(job.id, { stage: "ready", payload, message: "Ready" });
        return payload;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateJob(job.id, { stage: "error", error: message, message });
        throw err;
      }
    };

    if (asyncMode) {
      void run().catch(() => undefined);
      return c.json({ jobId: job.id, stage: job.stage });
    }

    return c.json(await run());
  } catch (err) {
    return handleError(c, err);
  }
});

app.post("/cookies/sync", async (c) => {
  try {
    const jars = await syncCookiesFromChrome();
    return c.json({
      ok: true,
      jars: jars.map((j) => ({ id: j.id, label: j.label, cookieCount: j.cookieCount })),
    });
  } catch (err) {
    return handleError(c, err);
  }
});

/** Accept CookieJar JSON from the Magnific Cookie Sync browser extension. */
app.post("/cookies/import", async (c) => {
  try {
    const body = await c.req.json<Partial<CookieJar>>();
    if (!body?.cookie?.trim()) throw new HttpError(400, "cookie string is required");
    const jar = await saveCookieJar({
      id: body.id || "browser-extension",
      profile: body.profile || "extension",
      browser: body.browser || "chrome",
      label: body.label || "browser extension",
      email: body.email,
      cookie: body.cookie,
      updatedAt: body.updatedAt || new Date().toISOString(),
      cookieCount: body.cookieCount || 0,
    });
    return c.json({
      ok: true,
      activeId: jar.id,
      jar: { id: jar.id, label: jar.label, cookieCount: jar.cookieCount },
    });
  } catch (err) {
    return handleError(c, err);
  }
});

function handleError(c: { json: (data: unknown, status?: number) => Response }, err: unknown) {
  if (err instanceof HttpError) {
    return c.json({ error: err.message }, err.status);
  }
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);
  console.error(err);
  if (status && status >= 400 && status < 600) {
    return c.json({ error: message }, status);
  }
  return c.json({ error: message }, 500);
}

async function boot() {
  const jars = await loadCookieJars();
  console.log(`Magnific proxy (no API key) on http://localhost:${PORT}`);
  console.log(
    "Local convert: package SVG/EPS/ZIP · EPS→SVG via gs+pdftocairo (Inkscape/mutool fallback) · no trace"
  );
  if (jars.length) {
    console.log(`Cookie jars: ${jars.length} loaded from local app data`);
  } else {
    console.warn("No cookie jars — open magnific.com, then click Connect Magnific in Figma Settings");
  }
  try {
    const removed = await pruneExpired();
    if (removed > 0) console.log(`Recent assets: pruned ${removed} expired`);
  } catch (err) {
    console.warn("Recent prune failed:", err instanceof Error ? err.message : err);
  }
  setInterval(() => {
    void pruneExpired().catch((err) =>
      console.warn("Recent prune failed:", err instanceof Error ? err.message : err)
    );
  }, PRUNE_INTERVAL_MS);
  if (AUTO_SYNC) {
    console.log("COOKIES_AUTO_SYNC=1 — syncing from Chrome...");
    try {
      await syncCookiesFromChrome();
    } catch (err) {
      console.warn("Auto cookie sync failed:", err instanceof Error ? err.message : err);
    }
  }
  serve({ fetch: app.fetch, port: PORT });
}

boot();
