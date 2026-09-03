import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssetItem,
  MainToUiMessage,
  PlaceMode,
  SearchTab,
  UiToMainMessage,
} from "../shared/messages";
import {
  checkHealth,
  convertLocalFile,
  listRecent,
  requestInsert,
  searchAssets,
  syncCookies,
} from "./api";
import { AssetGrid } from "./components/AssetGrid";
import { FilterBar } from "./components/FilterBar";
import { PlaceModeBar } from "./components/PlaceModeBar";
import { SearchBar } from "./components/SearchBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { SizePresets } from "./components/SizePresets";
import { StatusBar } from "./components/StatusBar";
import { TypeTabs } from "./components/TypeTabs";

function postToMain(msg: UiToMainMessage): void {
  parent.postMessage({ pluginMessage: msg }, "*");
}

function base64ToBytes(base64: string): number[] {
  const bin = atob(base64);
  const out = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function itemKey(item: AssetItem): string {
  return `${item.kind}:${item.id}`;
}

function stageLabel(stage: string, message?: string): string {
  if (message?.toLowerCase().includes("cache")) return "From cache · inserting…";
  if (message) return message;
  switch (stage) {
    case "queued":
      return "Queued…";
    case "downloading":
      return "Downloading package…";
    case "converting":
      return "Converting…";
    case "ready":
      return "Ready · inserting…";
    default:
      return stage;
  }
}

function pushHistory(prev: string[], term: string): string[] {
  const t = term.trim();
  if (!t) return prev;
  return [t, ...prev.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6);
}

export function App() {
  const [proxyUrl, setProxyUrl] = useState("http://localhost:8787");
  const [draftProxy, setDraftProxy] = useState("http://localhost:8787");
  const [maxSize, setMaxSize] = useState(800);
  const [draftMaxSize, setDraftMaxSize] = useState(800);
  const [placeMode, setPlaceMode] = useState<PlaceMode>("beside");
  const [showSettings, setShowSettings] = useState(false);
  const [health, setHealth] = useState("Checking proxy…");
  const [cookieStale, setCookieStale] = useState(false);
  const [syncingCookies, setSyncingCookies] = useState(false);

  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [tab, setTab] = useState<SearchTab>("all");
  const [prefsReady, setPrefsReady] = useState(false);
  const [iconType, setIconType] = useState("");
  const [freeSvg, setFreeSvg] = useState("");

  const [items, setItems] = useState<AssetItem[]>([]);
  const [favorites, setFavorites] = useState<AssetItem[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [focusIndex, setFocusIndex] = useState(0);
  const [status, setStatus] = useState("Ready · / search · Space select · Enter insert");
  const [tone, setTone] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [dragOver, setDragOver] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingBatch = useRef(0);
  const prefsRef = useRef({ maxSize: 800, placeMode: "beside" as PlaceMode, lastTab: "all" as SearchTab, searchHistory: [] as string[] });

  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => itemKey(f))),
    [favorites]
  );

  const persistPrefs = useCallback(
    (patch: Partial<{ maxSize: number; placeMode: PlaceMode; lastTab: SearchTab; searchHistory: string[] }>) => {
      const next = { ...prefsRef.current, ...patch };
      prefsRef.current = next;
      postToMain({
        type: "set-plugin-settings",
        maxSize: next.maxSize,
        placeMode: next.placeMode,
        lastTab: next.lastTab,
        searchHistory: next.searchHistory,
      });
    },
    []
  );

  useEffect(() => {
    postToMain({ type: "get-proxy-url" });
    postToMain({ type: "get-plugin-settings" });
    postToMain({ type: "get-favorites" });
    const onMessage = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage as MainToUiMessage | undefined;
      if (!msg) return;
      if (msg.type === "proxy-url") {
        setProxyUrl(msg.url);
        setDraftProxy(msg.url);
      }
      if (msg.type === "plugin-settings") {
        setMaxSize(msg.maxSize);
        setDraftMaxSize(msg.maxSize);
        setPlaceMode(msg.placeMode || "beside");
        if (msg.lastTab) setTab(msg.lastTab);
        if (msg.searchHistory) setSearchHistory(msg.searchHistory);
        prefsRef.current = {
          maxSize: msg.maxSize,
          placeMode: msg.placeMode || "beside",
          lastTab: msg.lastTab || "all",
          searchHistory: msg.searchHistory || [],
        };
        setPrefsReady(true);
      }
      if (msg.type === "favorites") {
        setFavorites(msg.items);
      }
      if (msg.type === "insert-done") {
        pendingBatch.current = Math.max(0, pendingBatch.current - 1);
        if (pendingBatch.current === 0) setInsertingId(null);
        setTone("success");
        setStatus(
          typeof msg.batchTotal === "number" && msg.batchTotal > 1
            ? `Inserted ${(msg.batchIndex ?? 0) + 1}/${msg.batchTotal} · “${msg.name}”`
            : `Inserted “${msg.name}”`
        );
      }
      if (msg.type === "insert-error") {
        pendingBatch.current = 0;
        setInsertingId(null);
        setTone("error");
        setStatus(msg.message);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const refreshHealth = useCallback(async (base: string) => {
    try {
      const h = await checkHealth(base);
      setCookieStale(Boolean(h.cookieStale));
      if (!h.hasCookie) {
        setHealth("Proxy up — no cookies. Use Magnific Cookie Sync extension → Send to proxy");
      } else {
        const exp =
          h.cookieExpiresAt != null
            ? ` · token ${h.cookieStale ? "expiring soon" : "ok"}`
            : "";
        setHealth(
          `Proxy up — ${h.cookieJars || 1} jar(s)` +
            (h.activeJar ? ` · ${h.activeJar}` : "") +
            exp +
            " · convert ready"
        );
      }
    } catch {
      setCookieStale(false);
      setHealth("Proxy unreachable — run `npm run server`");
    }
  }, []);

  useEffect(() => {
    void refreshHealth(proxyUrl);
    const t = setInterval(() => void refreshHealth(proxyUrl), 60_000);
    return () => clearInterval(t);
  }, [proxyUrl, refreshHealth]);

  const runSearch = useCallback(
    async (opts: { term: string; tab: SearchTab; page: number; append: boolean }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const id = ++requestId.current;
      setLoading(true);
      setTone("loading");
      setStatus(
        opts.tab === "recent"
          ? opts.page > 1
            ? "Loading more…"
            : "Loading recent…"
          : opts.tab === "favorites"
            ? "Loading favorites…"
            : opts.page > 1
              ? "Loading more…"
              : "Searching…"
      );
      try {
        if (opts.tab === "favorites") {
          if (id !== requestId.current) return;
          setItems(favorites);
          setPage(1);
          setLastPage(1);
          setFocusIndex(0);
          setTone("idle");
          setStatus(favorites.length ? `${favorites.length} favorites` : "No favorites yet — star an asset");
          return;
        }
        const res =
          opts.tab === "recent"
            ? await listRecent(proxyUrl, opts.page, ac.signal)
            : await searchAssets(
                proxyUrl,
                {
                  term: opts.term,
                  tab: opts.tab,
                  page: opts.page,
                  iconType: iconType || undefined,
                  freeSvg: freeSvg || undefined,
                },
                ac.signal
              );
        if (id !== requestId.current) return;
        setItems((prev) => (opts.append ? [...prev, ...res.items] : res.items));
        setPage(res.page);
        setLastPage(res.lastPage);
        setFocusIndex(0);
        setTone("idle");
        setStatus(
          res.items.length
            ? opts.tab === "recent"
              ? `${res.total} recent`
              : `${res.total || res.items.length} results`
            : opts.tab === "recent"
              ? "No recent assets — insert from search first"
              : "No results — try another query"
        );
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (id !== requestId.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setTone("error");
        setStatus(message);
        if (!opts.append) setItems([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [proxyUrl, iconType, freeSvg, favorites]
  );

  useEffect(() => {
    if (!prefsReady) return;
    if (tab !== "recent" && tab !== "favorites") return;
    void runSearch({ term: "", tab, page: 1, append: false });
  }, [tab, runSearch, prefsReady]);

  useEffect(() => {
    if (!prefsReady) return;
    if (tab === "recent" || tab === "favorites") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCommittedQuery(query);
      void runSearch({ term: query, tab, page: 1, append: false });
      if (query.trim()) {
        setSearchHistory((prev) => {
          const next = pushHistory(prev, query);
          persistPrefs({ searchHistory: next, lastTab: tab });
          return next;
        });
      } else {
        persistPrefs({ lastTab: tab });
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tab, iconType, freeSvg, runSearch, prefsReady, persistPrefs]);

  const pushInsertPayload = useCallback(
    async (
      payload: Awaited<ReturnType<typeof requestInsert>>,
      batchIndex?: number,
      batchTotal?: number
    ) => {
      const quiet =
        typeof batchIndex === "number" &&
        typeof batchTotal === "number" &&
        batchTotal > 1 &&
        batchIndex < batchTotal - 1;
      if (payload.kind === "svg") {
        setStatus(
          payload.cached
            ? "From cache · inserting SVG…"
            : payload.source === "eps-converted"
              ? "EPS→SVG converted → inserting…"
              : "Inserting SVG…"
        );
        postToMain({
          type: "insert-svg",
          svg: payload.svg,
          name: payload.name,
          maxSize,
          placeMode,
          batchIndex,
          batchTotal,
          quiet,
        });
      } else {
        setStatus(payload.cached ? "From cache · inserting image…" : "Inserting image…");
        postToMain({
          type: "insert-image",
          bytes: base64ToBytes(payload.bytesBase64),
          name: payload.name,
          maxSize,
          placeMode,
          batchIndex,
          batchTotal,
          quiet,
        });
      }
    },
    [maxSize, placeMode]
  );

  const handleInsert = useCallback(
    async (item: AssetItem, batchIndex?: number, batchTotal?: number) => {
      const key = itemKey(item);
      setInsertingId(key);
      setTone("loading");
      setStatus(`Downloading package ${item.name}…`);
      try {
        const payload = await requestInsert(
          proxyUrl,
          {
            id: item.id,
            kind: item.kind,
            name: item.name,
            slug: item.slug,
            thumbnailUrl: item.thumbnailUrl,
            freeSvg: item.freeSvg,
            premium: item.premium,
          },
          (stage, message) => setStatus(stageLabel(stage, message))
        );
        await pushInsertPayload(payload, batchIndex, batchTotal);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setInsertingId(null);
        pendingBatch.current = 0;
        setTone("error");
        setStatus(message);
        throw err;
      }
    },
    [proxyUrl, pushInsertPayload]
  );

  const handleBatchInsert = useCallback(async () => {
    const selected = items.filter((it) => selectedKeys.has(itemKey(it)));
    if (!selected.length) return;
    pendingBatch.current = selected.length;
    setTone("loading");
    setStatus(`Inserting ${selected.length} assets…`);
    for (let i = 0; i < selected.length; i++) {
      try {
        await handleInsert(selected[i], i, selected.length);
        await new Promise((r) => setTimeout(r, 200));
      } catch {
        break;
      }
    }
    setSelectedKeys(new Set());
  }, [items, selectedKeys, handleInsert]);

  const handleToggleSelect = useCallback((item: AssetItem, additive: boolean) => {
    const key = itemKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(additive ? prev : []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleFavorite = useCallback((item: AssetItem) => {
    const key = itemKey(item);
    setFavorites((prev) => {
      const exists = prev.some((f) => itemKey(f) === key);
      const next = exists ? prev.filter((f) => itemKey(f) !== key) : [...prev, item];
      postToMain({ type: "set-favorites", items: next });
      return next;
    });
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const file = files[0];
      if (!file) return;
      setInsertingId(`file:${file.name}`);
      setTone("loading");
      setStatus(`Converting ${file.name}…`);
      try {
        const payload = await convertLocalFile(proxyUrl, file, (stage, message) =>
          setStatus(stageLabel(stage, message))
        );
        await pushInsertPayload(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setInsertingId(null);
        setTone("error");
        setStatus(message);
      }
    },
    [proxyUrl, pushInsertPayload]
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setCommittedQuery("");
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (e.key === "Escape") {
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (selectedKeys.size) {
          setSelectedKeys(new Set());
          return;
        }
        if (document.activeElement === searchRef.current && query) {
          clearSearch();
        }
        return;
      }

      if (typing || showSettings || !items.length) return;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((i) => Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 2 : 1)));
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, i - (e.key === "ArrowUp" ? 2 : 1)));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = items[focusIndex];
        if (item) void handleInsert(item);
      } else if (e.key === " ") {
        e.preventDefault();
        const item = items[focusIndex];
        if (item) handleToggleSelect(item, true);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        const item = items[focusIndex];
        if (item) handleToggleFavorite(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    items,
    focusIndex,
    showSettings,
    handleInsert,
    handleToggleSelect,
    handleToggleFavorite,
    selectedKeys.size,
    query,
    clearSearch,
  ]);

  const changePlaceMode = (mode: PlaceMode) => {
    setPlaceMode(mode);
    persistPrefs({ placeMode: mode });
    setStatus(
      mode === "replace"
        ? "Place: Replace selection"
        : mode === "into"
          ? "Place: Into selected frame"
          : "Place: Beside selection"
    );
    setTone("idle");
  };

  const changeMaxSize = (n: number) => {
    setMaxSize(n);
    setDraftMaxSize(n);
    persistPrefs({ maxSize: n });
    setStatus(`Max size ${n}px`);
    setTone("idle");
  };

  return (
    <div
      className={`app${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="top">
        {cookieStale ? (
          <div className="banner warn">
            Cookie missing or expiring — Magnific Cookie Sync → Collect → Send to proxy
          </div>
        ) : null}
        <div className="row">
          <SearchBar
            ref={searchRef}
            value={query}
            onChange={setQuery}
            onClear={clearSearch}
            onSubmit={() => {
              setCommittedQuery(query);
              void runSearch({ term: query, tab, page: 1, append: false });
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Import file"
            title="Import SVG / EPS / AI / ZIP / PNG"
            onClick={() => fileRef.current?.click()}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 2v8m0 0 3-3M8 10 5 7M3 12.5h10"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Settings"
            onClick={() => setShowSettings((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M6.5 2.5h3l.4 1.6a4.5 4.5 0 0 1 1.1.6l1.5-.6 1.5 2.6-1.2 1a4.6 4.6 0 0 1 0 1.3l1.2 1-1.5 2.6-1.5-.6a4.5 4.5 0 0 1-1.1.6L9.5 13.5h-3l-.4-1.6a4.5 4.5 0 0 1-1.1-.6l-1.5.6L1.9 9.3l1.2-1a4.6 4.6 0 0 1 0-1.3l-1.2-1L3.5 3.4l1.5.6a4.5 4.5 0 0 1 1.1-.6L6.5 2.5Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".svg,.eps,.esp,.ps,.ai,.zip,.png,.jpg,.jpeg"
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {searchHistory.length && !query ? (
          <div className="history-row">
            {searchHistory.map((h) => (
              <button
                key={h}
                type="button"
                className="chip"
                onClick={() => {
                  setQuery(h);
                  setCommittedQuery(h);
                  void runSearch({ term: h, tab: tab === "recent" || tab === "favorites" ? "all" : tab, page: 1, append: false });
                }}
              >
                {h}
              </button>
            ))}
          </div>
        ) : null}
        <TypeTabs
          value={tab}
          onChange={(t) => {
            setTab(t);
            persistPrefs({ lastTab: t });
          }}
        />
        <div className="toolbar-row">
          <PlaceModeBar value={placeMode} onChange={changePlaceMode} />
          <SizePresets value={maxSize} onChange={changeMaxSize} />
        </div>
        <FilterBar
          tab={tab}
          iconType={iconType}
          freeSvg={freeSvg}
          onIconType={setIconType}
          onFreeSvg={setFreeSvg}
        />
        {selectedKeys.size > 0 ? (
          <div className="batch-bar">
            <span>{selectedKeys.size} selected</span>
            <button type="button" className="primary sm" onClick={() => void handleBatchInsert()}>
              Insert {selectedKeys.size}
            </button>
            <button type="button" className="ghost sm" onClick={() => setSelectedKeys(new Set())}>
              Clear
            </button>
          </div>
        ) : null}
        {showSettings ? (
          <SettingsPanel
            proxyUrl={draftProxy}
            onProxyUrl={setDraftProxy}
            maxSize={draftMaxSize}
            onMaxSize={setDraftMaxSize}
            health={health}
            syncing={syncingCookies}
            onClose={() => setShowSettings(false)}
            onSyncCookies={() => {
              void (async () => {
                setSyncingCookies(true);
                setTone("loading");
                setStatus("Syncing Chrome cookies (CDP)…");
                try {
                  await syncCookies(proxyUrl);
                  await refreshHealth(proxyUrl);
                  setTone("success");
                  setStatus("Chrome cookies synced");
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  setTone("error");
                  setStatus(message);
                } finally {
                  setSyncingCookies(false);
                }
              })();
            }}
            onSave={() => {
              const url = draftProxy.replace(/\/$/, "");
              setProxyUrl(url);
              setMaxSize(draftMaxSize);
              postToMain({ type: "set-proxy-url", url });
              persistPrefs({ maxSize: draftMaxSize, placeMode });
              void refreshHealth(url);
              setShowSettings(false);
              setTone("success");
              setStatus("Settings saved");
            }}
          />
        ) : null}
      </div>

      <div className="main">
        {dragOver ? (
          <div className="drop-hint">Drop SVG / EPS / AI / ZIP (→ vector) or PNG / JPG (→ image)</div>
        ) : null}
        {loading && items.length === 0 ? (
          <div className="skeleton-grid" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
        ) : !loading && items.length === 0 ? (
          <div className={tone === "error" ? "error-box" : "empty"}>
            {tone === "error"
              ? status
              : tab === "recent"
                ? "No recent assets — insert from search first"
                : tab === "favorites"
                  ? "No favorites yet — star an asset (or press F)"
                  : "Search Magnific, drop a file, or pick a recent query above"}
          </div>
        ) : (
          <>
            <AssetGrid
              items={items}
              focusIndex={focusIndex}
              insertingId={insertingId}
              selectedKeys={selectedKeys}
              favoriteKeys={favoriteKeys}
              onInsert={handleInsert}
              onFocusIndex={setFocusIndex}
              onToggleSelect={handleToggleSelect}
              onToggleFavorite={handleToggleFavorite}
            />
            {tab !== "favorites" && page < lastPage ? (
              <button
                type="button"
                className="load-more"
                disabled={loading}
                onClick={() =>
                  void runSearch({
                    term: committedQuery,
                    tab,
                    page: page + 1,
                    append: true,
                  })
                }
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </>
        )}
      </div>

      <StatusBar message={status} tone={insertingId || loading ? "loading" : tone} />
    </div>
  );
}
