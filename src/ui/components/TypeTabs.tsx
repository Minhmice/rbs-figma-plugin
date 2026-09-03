import type { SearchTab } from "../../shared/messages";

const TABS: { id: SearchTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "icons", label: "Icons" },
  { id: "vectors", label: "Vectors" },
  { id: "photos", label: "Photos" },
  { id: "recent", label: "Recent" },
  { id: "favorites", label: "★" },
];

type Props = {
  value: SearchTab;
  onChange: (tab: SearchTab) => void;
};

export function TypeTabs({ value, onChange }: Props) {
  return (
    <div className="tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          title={tab.id === "favorites" ? "Favorites" : tab.label}
          className={`tab${value === tab.id ? " active" : ""}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
