# Magnific Stock → Figma Plugin

Search Magnific from Figma, prefer real SVG, convert EPS → SVG locally, insert onto the canvas.

**No API keys.** Cookies sync automatically from your Chrome account into `server/cookies/`.

## Quick start

```bash
npm install
npm run cookies:sync    # pulls Magnific cookies from Chrome (trantueminh35 / Default)
npm run server          # proxy on :8787 — auto-loads cookies
npm run build           # or npm run watch
```

Import `manifest.json` in Figma → run **Magnific Stock**.

## Cookies (auto)

- Jars live in `server/cookies/*.json` (gitignored)
- Active jar: `server/cookies/active.json`
- **Default:** Chrome extension in [`extension/`](extension/) → **Send to proxy**
- Fallback CDP: `npm run cookies:sync` or Settings → **Sync Chrome cookies (CDP)**
- Later: drop more jars as `server/cookies/<id>.json` and point `active.json` — proxy rotates on 401/403

Sync briefly restarts Chrome with a CDP profile copy (Chrome 136+ blocks debugging the default profile path). Windows-oriented; prefer the extension on Linux.

### Browser extension (Magnific Cookie Sync)

Collects `magnific.com` / `freepik.com` / `flaticon.com` cookies into the same jar format the proxy reads.

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
2. Log into [magnific.com](https://www.magnific.com/)
3. Open the extension popup → **Send to proxy** (proxy must be running on `:8787`)
   - Or **Download JSON jar** and save as `server/cookies/browser-extension.json`, set `active.json` → `"activeId": "browser-extension"`

Proxy endpoint: `POST /cookies/import` with the jar JSON body.

## Local convert / insert

1. Call Magnific `/api/regular/download` for **SVG → EPS → ZIP** (real package, not preview)
2. If ZIP → extract and pick SVG/EPS/AI first; raster only if that is what is inside
3. EPS / AI → **Ghostscript** (→ PDF) → **pdftocairo** (Poppler) → SVG; fallbacks: Inkscape, mutool, `gs -sDEVICE=svg`
4. PNG/JPG **from the package** → insert as image (never auto-trace)

Drop local `.svg` / `.eps` / `.ai` / `.zip` / `.png` / `.jpg` into the plugin.

### Linux (recommended for servers)

```bash
sudo apt install ghostscript poppler-utils
# optional better PDF→SVG quality / alternatives:
# sudo apt install inkscape
# sudo apt install mupdf-tools
```

Env overrides (optional): `GS_PATH`, `PDFTOCAIRO_PATH`, `INKSCAPE_PATH`, `MUTOOL_PATH`.

### Windows

```bash
winget install Inkscape.Inkscape
# Ghostscript: https://ghostscript.com/releases/gsdnld.html
```

Proxy discovers `gs` / `pdftocairo` / `inkscape` / `mutool` on PATH first, then common Windows install dirs.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run cookies:sync` | Import Magnific cookies from Chrome |
| `npm run server` | Proxy + convert |
| `npm run build` / `watch` | Build plugin |
