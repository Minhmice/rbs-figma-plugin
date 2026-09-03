# Magnific Cookie Sync (Internal Chrome / Edge extension)

Internal-only extension. Exports Magnific / Freepik / Flaticon cookies into the local jar format used by `server/cookies/`. Never publish or distribute outside approved team members.

## Install

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** → choose this `extension/` folder
4. Sign in to Chrome with the approved Google account, then keep [magnific.com](https://www.magnific.com/) open and logged in

## Use

No button needed. Extension sends cookies to `http://localhost:8787/cookies/import` when a Magnific tab opens or every 15 minutes. Proxy must be running.

Popup buttons remain under **Advanced** for fallback and debugging:

- **Collect**: read cookies into memory
- **Send to proxy**: manually push cookie jar
- **Download JSON jar**: manual file export
