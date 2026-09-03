/** Shared message protocol between UI and main thread */

export type AssetKind = "icon" | "vector" | "photo";

export type PlaceMode = "beside" | "replace" | "into";

export type UiPrefs = {
  maxSize: number;
  placeMode: PlaceMode;
  lastTab?: SearchTab;
  searchHistory?: string[];
};

export type UiToMainMessage =
  | {
      type: "insert-svg";
      svg: string;
      name: string;
      maxSize?: number;
      placeMode?: PlaceMode;
      batchIndex?: number;
      batchTotal?: number;
      quiet?: boolean;
    }
  | {
      type: "insert-image";
      bytes: number[];
      name: string;
      width?: number;
      height?: number;
      maxSize?: number;
      placeMode?: PlaceMode;
      batchIndex?: number;
      batchTotal?: number;
      quiet?: boolean;
    }
  | { type: "notify"; message: string; error?: boolean }
  | { type: "resize"; width: number; height: number }
  | { type: "get-proxy-url" }
  | { type: "set-proxy-url"; url: string }
  | { type: "get-plugin-settings" }
  | {
      type: "set-plugin-settings";
      maxSize: number;
      placeMode?: PlaceMode;
      lastTab?: SearchTab;
      searchHistory?: string[];
    }
  | { type: "get-favorites" }
  | { type: "set-favorites"; items: AssetItem[] };

export type MainToUiMessage =
  | { type: "proxy-url"; url: string }
  | {
      type: "plugin-settings";
      maxSize: number;
      placeMode: PlaceMode;
      lastTab?: SearchTab;
      searchHistory?: string[];
    }
  | { type: "favorites"; items: AssetItem[] }
  | { type: "insert-done"; name: string; batchIndex?: number; batchTotal?: number }
  | { type: "insert-error"; message: string };

export type SearchTab = "all" | "icons" | "vectors" | "photos" | "recent" | "favorites";

export type AssetInfo = {
  license: string;
  dimension: string;
  format: string;
  attribution: string;
  moreInfoUrl?: string;
};

export type AssetItem = {
  id: string;
  kind: AssetKind;
  name: string;
  slug: string;
  thumbnailUrl: string;
  freeSvg?: boolean;
  premium?: boolean;
  info?: AssetInfo;
};

export type SearchResponse = {
  items: AssetItem[];
  page: number;
  lastPage: number;
  total: number;
};

export type InsertPayload =
  | {
      kind: "svg";
      svg: string;
      name: string;
      source: "svg" | "eps-converted";
      cached?: boolean;
      jobId?: string;
    }
  | {
      kind: "image";
      bytesBase64: string;
      name: string;
      mime: string;
      cached?: boolean;
      jobId?: string;
    };

export type JobStatusResponse = {
  id: string;
  stage: "queued" | "downloading" | "converting" | "ready" | "error";
  message?: string;
  cached?: boolean;
  payload?: InsertPayload;
  error?: string;
};
