# Magnific Stock → Figma Plugin

Search Magnific from Figma, prefer real SVG, convert EPS → SVG locally, insert onto the canvas.

**No API keys.** Project is internal. Keep repository private. Cookies sync automatically from Chrome into local `server/cookies/`; cookie files never belong in GitHub.

## Designer setup (Windows)

1. Run `setup-windows.ps1` once:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-windows.ps1
```

2. In Chrome, enable **Developer mode** → **Load unpacked** → select `extension/`.
3. Sign in to Chrome with the approved Google account.
4. Open `magnific.com` and log in.
4. Open Figma and run **Magnific Stock**.

After first setup, server starts with Windows and extension syncs cookies automatically when Magnific is open. Designer needs no terminal, `npm`, Proxy URL, or CDP sync.

## Developer quick start

```bash
npm install
npm run server
npm run build
```

Import `manifest.json` in Figma only for local development. See [`INSTALL-TEST.md`](INSTALL-TEST.md) for short test steps.

## Cookies (internal only)

- Cookie jars live in `server/cookies/*.json` and are gitignored.
- `server/cookies/active.json` is local runtime state and is gitignored.
- Never commit, upload, or paste cookie values into issues, chat, logs, or pull requests.
- Extension checks Chrome Google sign-in first via `chrome.identity`; without sign-in it does not read or send Magnific cookies.
- Extension sends cookies only to local proxy: `http://localhost:8787/cookies/import`.
- CDP fallback never force-closes Chrome; close Chrome yourself first.
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
