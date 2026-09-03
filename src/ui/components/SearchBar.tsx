import { forwardRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear?: () => void;
};

export const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { value, onChange, onSubmit, onClear },
  ref
) {
  return (
    <div className="search-wrap">
      <svg className="search-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        value={value}
        placeholder="Search…  (/ to focus)"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onClear?.();
          }
        }}
        aria-label="Search"
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          title="Clear"
          onClick={() => onClear?.()}
        >
          ×
        </button>
      ) : null}
    </div>
  );
});
