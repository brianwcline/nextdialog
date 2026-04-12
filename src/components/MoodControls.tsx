import { useState, useRef, useEffect } from "react";
import { useMoodTheme } from "../hooks/useMoodTheme";
import { THEMES, THEME_LABELS, THEME_DESCRIPTIONS } from "../themes";

/**
 * Compact dropdown in the app header that lets the user switch between the
 * six mood themes. Zen is the default. The selection is persisted to both
 * `Settings.mood_theme` (source of truth) and `localStorage` (FOUC cache).
 *
 * Keeping this component small and header-local so it doesn't force itself
 * into the user's attention — you find it when you want it and otherwise
 * it blends into the trailing button group.
 */
export function MoodControls() {
  const { theme, setTheme } = useMoodTheme();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-white/40 hover:text-slate-700 transition-colors"
        title="Mood theme"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        Mood
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 w-44 rounded-xl bg-white/90 backdrop-blur-xl border border-white/60 shadow-lg overflow-hidden z-50"
        >
          {THEMES.map((name) => {
            const active = name === theme;
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  setTheme(name);
                  setOpen(false);
                }}
                className={`w-full flex items-baseline justify-between px-3 py-2 text-left text-xs transition-colors ${
                  active
                    ? "bg-slate-900/5 text-slate-800"
                    : "text-slate-600 hover:bg-slate-900/5 hover:text-slate-800"
                }`}
              >
                <span className="font-medium">{THEME_LABELS[name]}</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  {THEME_DESCRIPTIONS[name]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
