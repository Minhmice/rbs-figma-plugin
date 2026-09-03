import { useEffect, useRef } from "react";
import type { AssetItem } from "../../shared/messages";
import { AssetCard } from "./AssetCard";

type Props = {
  items: AssetItem[];
  focusIndex: number;
  insertingId: string | null;
  selectedKeys: Set<string>;
  favoriteKeys: Set<string>;
  onInsert: (item: AssetItem) => void;
  onFocusIndex: (index: number) => void;
  onToggleSelect: (item: AssetItem, additive: boolean) => void;
  onToggleFavorite: (item: AssetItem) => void;
};

function itemKey(item: AssetItem): string {
  return `${item.kind}:${item.id}`;
}

export function AssetGrid({
  items,
  focusIndex,
  insertingId,
  selectedKeys,
  favoriteKeys,
  onInsert,
  onFocusIndex,
  onToggleSelect,
  onToggleFavorite,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapRef.current?.querySelector(`[data-index="${focusIndex}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [focusIndex]);

  return (
    <div className="grid" role="listbox" aria-label="Assets" aria-multiselectable="true" ref={wrapRef}>
      {items.map((item, index) => {
        const key = itemKey(item);
        return (
          <div key={key} data-index={index}>
            <AssetCard
              item={item}
              focused={index === focusIndex}
              busy={insertingId === key}
              selected={selectedKeys.has(key)}
              favorited={favoriteKeys.has(key)}
              onInsert={onInsert}
              onFocus={() => onFocusIndex(index)}
              onToggleSelect={onToggleSelect}
              onToggleFavorite={onToggleFavorite}
            />
          </div>
        );
      })}
    </div>
  );
}
