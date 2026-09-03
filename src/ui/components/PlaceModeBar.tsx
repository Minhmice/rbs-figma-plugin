import type { PlaceMode } from "../../shared/messages";

const MODES: { id: PlaceMode; label: string; title: string }[] = [
  { id: "beside", label: "Beside", title: "Place next to current selection" },
  { id: "replace", label: "Replace", title: "Replace selected layer (match size)" },
  { id: "into", label: "Into", title: "Place inside selected frame" },
];

type Props = {
  value: PlaceMode;
  onChange: (mode: PlaceMode) => void;
};

export function PlaceModeBar({ value, onChange }: Props) {
  return (
    <div className="place-bar" role="group" aria-label="Insert placement">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`place-btn${value === m.id ? " active" : ""}`}
          title={m.title}
          aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
