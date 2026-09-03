type Props = {
  proxyUrl: string;
  onProxyUrl: (url: string) => void;
  maxSize: number;
  onMaxSize: (n: number) => void;
  onSave: () => void;
  onClose: () => void;
  health: string;
  onSyncCookies: () => void;
  syncing?: boolean;
};

export function SettingsPanel({
  proxyUrl,
  onProxyUrl,
  maxSize,
  onMaxSize,
  onSave,
  onClose,
  health,
  onSyncCookies,
  syncing,
}: Props) {
  return (
    <div className="settings">
      <strong>Settings</strong>
      <label>
        Proxy URL
        <input
          value={proxyUrl}
          onChange={(e) => onProxyUrl(e.target.value)}
          placeholder="http://localhost:8787"
        />
      </label>
      <label>
        Max insert size (px)
        <input
          type="number"
          min={64}
          max={4096}
          step={16}
          value={maxSize}
          onChange={(e) => onMaxSize(Math.max(64, Number(e.target.value) || 800))}
        />
      </label>
      <p className="hint">
        Placement: use <strong>Beside / Replace / Into</strong> above the grid. Shortcuts:{" "}
        <code>/</code> search, <code>Space</code> select, <code>Enter</code> insert, <code>F</code>{" "}
        favorite, <code>Esc</code> clear.
      </p>
      <p className="hint">
        Cookies: use the <strong>Magnific Cookie Sync</strong> extension (
        <code>extension/</code>) → Send to proxy. CDP Sync is fallback only.
      </p>
      <p className="hint">{health}</p>
      <div className="actions">
        <button type="button" className="primary" onClick={onSave}>
          Save
        </button>
        <button type="button" className="ghost" onClick={onSyncCookies} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync Chrome cookies (CDP)"}
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
