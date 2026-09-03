import type { SearchTab } from "../../shared/messages";

type Props = {
  tab: SearchTab;
  iconType: string;
  freeSvg: string;
  onIconType: (v: string) => void;
  onFreeSvg: (v: string) => void;
};

export function FilterBar({ tab, iconType, freeSvg, onIconType, onFreeSvg }: Props) {
  if (tab !== "icons" && tab !== "all") return null;

  return (
    <div className="filters">
      <label className="filter">
        <select value={iconType} onChange={(e) => onIconType(e.target.value)} aria-label="Icon type">
          <option value="">All icon types</option>
          <option value="standard">Standard</option>
          <option value="uicon">UI</option>
          <option value="sticker">Sticker</option>
          <option value="animated">Animated</option>
        </select>
      </label>
      <label className="filter">
        <select value={freeSvg} onChange={(e) => onFreeSvg(e.target.value)} aria-label="SVG license">
          <option value="">SVG: all</option>
          <option value="free">Free SVG</option>
          <option value="premium">Premium</option>
        </select>
      </label>
    </div>
  );
}
