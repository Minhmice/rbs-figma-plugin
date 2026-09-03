# Magnific Stock → Figma Plugin

Search Magnific from Figma, prefer real SVG, convert EPS → SVG locally, insert onto the canvas.

**No API keys.** Project is internal. Keep repository private. Session cookies stay local in `%LOCALAPPDATA%\MagnificStock\cookies`; never commit or upload them.

## Designer setup (Windows)

1. Build release on developer machine with `npm run build:exe`, then distribute `dist/MagnificStock.exe`, `manifest.json`, `dist/code.js`, and `dist/index.html` as one ZIP.

2. Designer imports `manifest.json` once through **Figma Desktop → Plugins → Development → Import plugin from manifest...**.
3. Designer double-clicks `MagnificStock.exe`; it runs in the system tray and starts local server.
4. Designer opens any Chrome profile and logs in to `magnific.com`.
5. Designer runs **Magnific Stock** in Figma.
6. Open **Settings → Show advanced settings → Connect Magnific**.
7. Close Chrome when prompted, wait for **Magnific connected**, then reopen Chrome. All Chrome profiles with Magnific cookies are imported.

Figma does not expose supported API for EXE to auto-import local plugin manifest. For zero-manual-install distribution, publish plugin as a private organization plugin; designers install it from Figma once. No Chrome extension, terminal, `npm`, Proxy URL, or CDP command needed for designer.

## Developer quick start

```bash
npm install
npm run server
npm run build
```

Import `manifest.json` in Figma only for local development. See [`INSTALL-TEST.md`](INSTALL-TEST.md) for short test steps.

## Cookies (internal only)

- Cookie jars live in `%LOCALAPPDATA%\MagnificStock\cookies\*.json`.
- Cookie data belongs to each designer's Windows user profile and never enters project files.
- Never commit, upload, or paste cookie values into issues, chat, logs, or pull requests.
- Connect Magnific reads cookies from local Chrome profile through CDP.
- Cookie data sends only to local proxy: `http://localhost:8787`.
- CDP sync never force-closes Chrome; designer closes Chrome first.
- If cookie leaks, log out of Magnific on all devices and rotate the session immediately.

### Browser extension (Magnific Cookie Sync)

Extension stays internal. Do not publish it to Chrome Web Store.

1. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
2. Log into [magnific.com](https://www.magnific.com/).
3. Keep Magnific open. Extension pushes cookie data to local proxy automatically.
4. Use popup → **Advanced** only for fallback/debugging.

Proxy endpoint: `POST /cookies/import` with local CookieJar JSON body.

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
