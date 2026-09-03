# Magnific Cookie Sync (Chrome / Edge)

Exports Magnific / Freepik / Flaticon cookies into the jar format used by `server/cookies/`.

## Install

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** → choose this `extension/` folder
4. Keep [magnific.com](https://www.magnific.com/) open and logged in

## Use

| Button | Action |
|--------|--------|
| **Collect** | Read cookies into memory |
| **Send to proxy** | `POST http://localhost:8787/cookies/import` (writes `server/cookies/browser-extension.json` + sets active) |
| **Download JSON jar** | Save file manually into `server/cookies/` |

Proxy must be running (`npm run server`) for **Send to proxy**.
