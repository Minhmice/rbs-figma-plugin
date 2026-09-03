import type {
  InsertPayload,
  JobStatusResponse,
  SearchResponse,
  SearchTab,
} from "../shared/messages";

export async function searchAssets(
  proxyBase: string,
  opts: {
    term: string;
    tab: SearchTab;
    page: number;
    iconType?: string;
    freeSvg?: string;
  },
  signal?: AbortSignal
): Promise<SearchResponse> {
  const url = new URL("/search", proxyBase);
  url.searchParams.set("term", opts.term);
  url.searchParams.set("tab", opts.tab);
  url.searchParams.set("page", String(opts.page));
  if (opts.iconType) url.searchParams.set("iconType", opts.iconType);
  if (opts.freeSvg) url.searchParams.set("freeSvg", opts.freeSvg);

  const res = await fetch(url.toString(), { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
  return json as SearchResponse;
}

export async function listRecent(
  proxyBase: string,
  page = 1,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const url = new URL("/recent", proxyBase);
  url.searchParams.set("page", String(page));
  const res = await fetch(url.toString(), { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Recent failed (${res.status})`);
  return json as SearchResponse;
}

async function pollJob(
  proxyBase: string,
  jobId: string,
  onStage?: (stage: string, message?: string) => void
): Promise<InsertPayload> {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    const res = await fetch(new URL(`/jobs/${jobId}`, proxyBase).toString());
    const json = (await res.json()) as JobStatusResponse & { error?: string };
    if (!res.ok) throw new Error(json.error || `Job failed (${res.status})`);
    onStage?.(json.stage, json.message);
    if (json.stage === "ready" && json.payload) return json.payload;
    if (json.stage === "error") throw new Error(json.error || json.message || "Job failed");
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("Timed out waiting for convert/download job");
}

export async function requestInsert(
  proxyBase: string,
  opts: {
    id: string;
    kind: string;
    name: string;
    slug?: string;
    thumbnailUrl?: string;
    freeSvg?: boolean;
    premium?: boolean;
  },
  onStage?: (stage: string, message?: string) => void
): Promise<InsertPayload> {
  const res = await fetch(new URL("/insert", proxyBase).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: opts.id,
      kind: opts.kind,
      name: opts.name,
      slug: opts.slug,
      thumbnailUrl: opts.thumbnailUrl,
      freeSvg: opts.freeSvg,
      premium: opts.premium,
      async: true,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Insert failed (${res.status})`);
  if (json.jobId) {
    onStage?.(json.stage || "queued", "Queued…");
    return pollJob(proxyBase, json.jobId, onStage);
  }
  return json as InsertPayload;
}

export async function convertLocalFile(
  proxyBase: string,
  file: File,
  onStage?: (stage: string, message?: string) => void
): Promise<InsertPayload> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("async", "1");
  const res = await fetch(new URL("/convert", proxyBase).toString(), {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Convert failed (${res.status})`);
  if (json.jobId) {
    onStage?.(json.stage || "queued", "Queued…");
    return pollJob(proxyBase, json.jobId, onStage);
  }
  return json as InsertPayload;
}

export async function checkHealth(proxyBase: string): Promise<{
  ok: boolean;
  mode?: string;
  localConvert?: boolean;
  cookieJars?: number;
  activeJar?: string | null;
  hasCookie?: boolean;
  cookieExpiresAt?: number | null;
  cookieStale?: boolean;
}> {
  const res = await fetch(new URL("/health", proxyBase).toString());
  if (!res.ok) throw new Error(`Proxy unreachable (${res.status})`);
  return res.json();
}

export async function syncCookies(proxyBase: string): Promise<void> {
  const res = await fetch(new URL("/cookies/sync", proxyBase).toString(), { method: "POST" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Cookie sync failed (${res.status})`);
}
