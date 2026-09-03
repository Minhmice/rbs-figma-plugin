import { memo, useEffect, useId, useRef, useState } from "react";
import type { AssetItem } from "../../shared/messages";

type Props = {
  item: AssetItem;
  focused: boolean;
  busy: boolean;
  selected?: boolean;
  favorited?: boolean;
  onInsert: (item: AssetItem) => void;
  onFocus: () => void;
  onToggleSelect?: (item: AssetItem, additive: boolean) => void;
  onToggleFavorite?: (item: AssetItem) => void;
};

export const AssetCard = memo(function AssetCard({
  item,
  focused,
  busy,
  selected,
  favorited,
  onInsert,
  onFocus,
  onToggleSelect,
  onToggleFavorite,
}: Props) {
  const [infoOpen, setInfoOpen] = useState(false);
  const tipId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!infoOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setInfoOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInfoOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [infoOpen]);

  const info = item.info;
  const premium = item.premium || item.freeSvg === false;

  return (
    <div
      className={`card-wrap${focused ? " focused" : ""}${selected ? " selected" : ""}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className={`card${focused ? " focused" : ""}${selected ? " selected" : ""}`}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            onToggleSelect?.(item, true);
            return;
          }
          onInsert(item);
        }}
        onFocus={onFocus}
        disabled={busy}
        title={`Insert ${item.name} (Ctrl+click to multi-select)`}
      >
        <div className="card-thumb">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="hint">No preview</span>
          )}
        </div>
        {premium ? <span className="badge">Premium</span> : null}
        {selected ? <span className="badge select-badge">✓</span> : null}
        <div className="card-meta">
          <div className="card-name">{item.name}</div>
          <div className="card-kind">{item.kind}</div>
        </div>
      </button>

      {onToggleFavorite ? (
        <button
          type="button"
          className={`fav-btn${favorited ? " active" : ""}`}
          aria-label={favorited ? "Remove favorite" : "Add favorite"}
          title={favorited ? "Unfavorite" : "Favorite"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(item);
          }}
        >
          ★
        </button>
      ) : null}

      <button
        type="button"
        className={`info-btn${infoOpen ? " active" : ""}`}
        aria-label="Information"
        aria-expanded={infoOpen}
        aria-controls={tipId}
        onClick={(e) => {
          e.stopPropagation();
          setInfoOpen((v) => !v);
        }}
      >
        i
      </button>

      {infoOpen && info ? (
        <div className="info-tooltip" id={tipId} role="dialog" aria-label="Information">
          <div className="info-tooltip-title">Information</div>
          <div className="info-row">
            <span className="info-label">License</span>
            <span className="info-value">
              {info.license}
              {info.moreInfoUrl ? (
                <a
                  className="info-link"
                  href={info.moreInfoUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  More info
                </a>
              ) : null}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Dimension</span>
            <span className="info-value">{info.dimension}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Format</span>
            <span className="info-value">{info.format}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Attribution</span>
            <span className="info-value">
              {info.attribution}
              {info.attribution === "Required" ? (
                <a
                  className="info-link"
                  href="https://www.magnific.com/legal/terms-of-use"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  How to attribute?
                </a>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
});
