const PRESETS = [48, 128, 256, 512, 800];

type Props = {
  value: number;
  onChange: (n: number) => void;
};

export function SizePresets({ value, onChange }: Props) {
  return (
    <div className="size-presets" role="group" aria-label="Max insert size">
      <span className="size-label">Size</span>
      {PRESETS.map((n) => (
        <button
          key={n}
          type="button"
          className={`chip${value === n ? " active" : ""}`}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
