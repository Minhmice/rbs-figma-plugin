/// <reference types="@figma/plugin-typings" />

import type {
  AssetItem,
  MainToUiMessage,
  PlaceMode,
  SearchTab,
  UiToMainMessage,
} from "./shared/messages";

const DEFAULT_PROXY = "http://localhost:8787";
const PROXY_KEY = "proxyBaseUrl";
const PREFS_KEY = "pluginPrefs";
const FAVORITES_KEY = "favoriteAssets";
const DEFAULT_MAX_SIZE = 800;
const DEFAULT_PLACE: PlaceMode = "beside";
const BATCH_GAP = 24;

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

function post(msg: MainToUiMessage): void {
  figma.ui.postMessage(msg);
}

let lastBatchOrigin: { x: number; y: number } | null = null;

function isFrameLike(node: BaseNode): node is FrameNode | ComponentNode | InstanceNode {
  return (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE" ||
    node.type === "GROUP" ||
    node.type === "SECTION"
  );
}

function placeNode(
  node: SceneNode,
  opts: {
    placeMode?: PlaceMode;
    batchIndex?: number;
    batchTotal?: number;
    quiet?: boolean;
  }
): void {
  const selection = figma.currentPage.selection;
  const gap = BATCH_GAP;
  const mode = opts.placeMode || DEFAULT_PLACE;
  const batchIndex = opts.batchIndex;
  const batchTotal = opts.batchTotal;
  const isBatch = typeof batchIndex === "number" && batchTotal && batchTotal > 1;
  const lastInBatch = isBatch && batchIndex === batchTotal - 1;

  if (mode === "replace" && selection.length > 0 && !isBatch) {
    const target = selection[0];
    const x = "x" in target ? target.x : 0;
    const y = "y" in target ? target.y : 0;
    const tw = "width" in target ? (target as LayoutMixin).width : node.width;
    const th = "height" in target ? (target as LayoutMixin).height : node.height;
    if ("resize" in node && typeof node.resize === "function" && tw > 0 && th > 0) {
      const scale = Math.min(tw / node.width, th / node.height);
      if (scale > 0 && Number.isFinite(scale)) {
        node.resize(Math.round(node.width * scale), Math.round(node.height * scale));
      }
    }
    node.x = x + (tw - node.width) / 2;
    node.y = y + (th - node.height) / 2;
    const parent = target.parent;
    if (parent && "appendChild" in parent) {
      parent.appendChild(node);
    } else {
      figma.currentPage.appendChild(node);
    }
    target.remove();
  } else if (mode === "into" && selection.length > 0 && isFrameLike(selection[0])) {
    const frame = selection[0] as FrameNode;
    if (isBatch) {
      if (batchIndex === 0) {
        lastBatchOrigin = { x: 24, y: 24 };
      }
      const origin = lastBatchOrigin || { x: 24, y: 24 };
      const col = (batchIndex || 0) % 4;
      const row = Math.floor((batchIndex || 0) / 4);
      node.x = origin.x + col * (node.width + gap);
      node.y = origin.y + row * (node.height + gap);
    } else {
      node.x = Math.max(0, (frame.width - node.width) / 2);
      node.y = Math.max(0, (frame.height - node.height) / 2);
    }
    frame.appendChild(node);
  } else if (isBatch) {
    if (batchIndex === 0) {
      if (selection.length > 0 && "x" in selection[0]) {
        const anchor = selection[0] as SceneNode & { x: number; y: number; width: number };
        lastBatchOrigin = { x: anchor.x + anchor.width + gap, y: anchor.y };
      } else {
        const center = figma.viewport.center;
        lastBatchOrigin = {
          x: center.x - node.width / 2,
          y: center.y - node.height / 2,
        };
      }
    }
    const origin = lastBatchOrigin || { x: 0, y: 0 };
    const col = (batchIndex || 0) % 4;
    const row = Math.floor((batchIndex || 0) / 4);
    node.x = origin.x + col * (node.width + gap);
    node.y = origin.y + row * (node.height + gap);
    figma.currentPage.appendChild(node);
  } else if (selection.length > 0 && "x" in selection[0]) {
    const anchor = selection[0] as SceneNode & { x: number; y: number; width: number };
    node.x = anchor.x + anchor.width + gap;
    node.y = anchor.y;
    figma.currentPage.appendChild(node);
  } else {
    const center = figma.viewport.center;
    node.x = center.x - node.width / 2;
    node.y = center.y - node.height / 2;
    figma.currentPage.appendChild(node);
  }

  figma.currentPage.selection = [node];
  if (!opts.quiet && (!isBatch || lastInBatch)) {
    figma.viewport.scrollAndZoomIntoView([node]);
  }
}

function fitMaxSize(
  node: SceneNode & { resize: (w: number, h: number) => void },
  maxSize: number
): void {
  const w = node.width;
  const h = node.height;
  if (!w || !h || !maxSize) return;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  if (scale < 1) node.resize(Math.round(w * scale), Math.round(h * scale));
}

function insertSvg(
  svg: string,
  name: string,
  maxSize = DEFAULT_MAX_SIZE,
  placeMode: PlaceMode = DEFAULT_PLACE,
  batchIndex?: number,
  batchTotal?: number,
  quiet?: boolean
): void {
  const node = figma.createNodeFromSvg(svg);
  node.name = name || "Magnific SVG";
  fitMaxSize(node, maxSize);
  placeNode(node, { placeMode, batchIndex, batchTotal, quiet });
  const isBatch = typeof batchIndex === "number" && batchTotal && batchTotal > 1;
  const last = !isBatch || batchIndex === batchTotal - 1;
  if (!quiet && last) figma.notify(`Inserted “${node.name}”`);
  post({ type: "insert-done", name: node.name, batchIndex, batchTotal });
}

async function insertImage(
  bytes: Uint8Array,
  name: string,
  width: number | undefined,
  height: number | undefined,
  maxSize = DEFAULT_MAX_SIZE,
  placeMode: PlaceMode = DEFAULT_PLACE,
  batchIndex?: number,
  batchTotal?: number,
  quiet?: boolean
): Promise<void> {
  const image = figma.createImage(bytes);
  const size = await image.getSizeAsync();
  const rect = figma.createRectangle();
  rect.name = name || "Magnific Image";
  const w = width || size.width;
  const h = height || size.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  rect.resize(Math.round(w * scale), Math.round(h * scale));
  rect.fills = [
    {
      type: "IMAGE",
      scaleMode: "FILL",
      imageHash: image.hash,
    },
  ];
  placeNode(rect, { placeMode, batchIndex, batchTotal, quiet });
  const isBatch = typeof batchIndex === "number" && batchTotal && batchTotal > 1;
  const last = !isBatch || batchIndex === batchTotal - 1;
  if (!quiet && last) figma.notify(`Inserted “${rect.name}”`);
  post({ type: "insert-done", name: rect.name, batchIndex, batchTotal });
}

type StoredPrefs = {
  maxSize?: number;
  placeMode?: PlaceMode;
  lastTab?: SearchTab;
  searchHistory?: string[];
};

figma.ui.onmessage = async (msg: UiToMainMessage) => {
  try {
    switch (msg.type) {
      case "get-proxy-url": {
        const stored = await figma.clientStorage.getAsync(PROXY_KEY);
        post({
          type: "proxy-url",
          url: typeof stored === "string" && stored ? stored : DEFAULT_PROXY,
        });
        break;
      }
      case "set-proxy-url": {
        await figma.clientStorage.setAsync(PROXY_KEY, msg.url);
        post({ type: "proxy-url", url: msg.url });
        break;
      }
      case "get-plugin-settings": {
        const raw = (await figma.clientStorage.getAsync(PREFS_KEY)) as StoredPrefs | number | undefined;
        // migrate old maxSize-only storage
        if (typeof raw === "number") {
          post({
            type: "plugin-settings",
            maxSize: raw > 0 ? raw : DEFAULT_MAX_SIZE,
            placeMode: DEFAULT_PLACE,
          });
          break;
        }
        const prefs = raw && typeof raw === "object" ? raw : {};
        post({
          type: "plugin-settings",
          maxSize: prefs.maxSize && prefs.maxSize > 0 ? prefs.maxSize : DEFAULT_MAX_SIZE,
          placeMode: prefs.placeMode || DEFAULT_PLACE,
          lastTab: prefs.lastTab,
          searchHistory: Array.isArray(prefs.searchHistory) ? prefs.searchHistory : [],
        });
        break;
      }
      case "set-plugin-settings": {
        const prefs: StoredPrefs = {
          maxSize: msg.maxSize,
          placeMode: msg.placeMode || DEFAULT_PLACE,
          lastTab: msg.lastTab,
          searchHistory: msg.searchHistory || [],
        };
        await figma.clientStorage.setAsync(PREFS_KEY, prefs);
        post({
          type: "plugin-settings",
          maxSize: prefs.maxSize!,
          placeMode: prefs.placeMode!,
          lastTab: prefs.lastTab,
          searchHistory: prefs.searchHistory,
        });
        break;
      }
      case "get-favorites": {
        const stored = await figma.clientStorage.getAsync(FAVORITES_KEY);
        const items = Array.isArray(stored) ? (stored as AssetItem[]) : [];
        post({ type: "favorites", items });
        break;
      }
      case "set-favorites": {
        await figma.clientStorage.setAsync(FAVORITES_KEY, msg.items);
        post({ type: "favorites", items: msg.items });
        break;
      }
      case "resize": {
        figma.ui.resize(msg.width, msg.height);
        break;
      }
      case "notify": {
        figma.notify(msg.message, { error: Boolean(msg.error) });
        break;
      }
      case "insert-svg": {
        insertSvg(
          msg.svg,
          msg.name,
          msg.maxSize,
          msg.placeMode,
          msg.batchIndex,
          msg.batchTotal,
          msg.quiet
        );
        break;
      }
      case "insert-image": {
        await insertImage(
          new Uint8Array(msg.bytes),
          msg.name,
          msg.width,
          msg.height,
          msg.maxSize,
          msg.placeMode,
          msg.batchIndex,
          msg.batchTotal,
          msg.quiet
        );
        break;
      }
      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.notify(message, { error: true });
    post({ type: "insert-error", message });
  }
};
