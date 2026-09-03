import { useState } from "react";

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
  const [advanced, setAdvanced] = useState(false);
  const connected = /Proxy up/i.test(health) && !/no cookies|unreachable/i.test(health);

  return (
    <div className="settings">
      <div className="settings-heading">
        <strong>Settings</strong>
        <span className={`connection-state ${connected ? "connected" : ""}`}>
          <span className="connection-dot" aria-hidden />
          {connected ? "Connected" : "Check connection"}
        </span>
      </div>
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
        Placement: use <strong>Beside / Replace / Into</strong> above the grid. Shortcuts: {" "}
        <code>/</code> search, <code>Space</code> select, <code>Enter</code> insert, <code>F</code>{" "}
        favorite, <code>Esc</code> clear.
      </p>
      <p className="hint">Click Connect Magnific once after logging into magnific.com.</p>
      <p className="hint">{health}</p>
      <button
        type="button"
        className="text-button"
        onClick={() => setAdvanced((value) => !value)}
        aria-expanded={advanced}
      >
        {advanced ? "Hide advanced settings" : "Show advanced settings"}
      </button>
      {advanced ? (
        <div className="advanced-settings">
          <label>
            Proxy URL
            <input
              value={proxyUrl}
              onChange={(e) => onProxyUrl(e.target.value)}
              placeholder="http://localhost:8787"
            />
          </label>
          <button type="button" className="ghost" onClick={onSyncCookies} disabled={syncing}>
            {syncing ? "Connecting…" : "Connect Magnific"}
          </button>
        </div>
      ) : null}
      <div className="actions">
        <button type="button" className="primary" onClick={onSave}>
          Save
        </button>
        <button type="button" className="ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
