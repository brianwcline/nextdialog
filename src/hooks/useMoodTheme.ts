import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MoodTheme } from "../lib/types";
import { MOOD_STORAGE_KEY, isMoodTheme } from "../themes";
import { trackEvent } from "../lib/telemetry";

/** Partial shape of the Settings object — only the field we care about. */
interface SettingsWithMood {
  mood_theme?: string;
}

/**
 * Read and write the app's mood theme.
 *
 * Source of truth: `Settings.mood_theme` persisted by the Rust side.
 * localStorage is a cache used by the FOUC-prevention script in
 * `index.html` so the correct theme is applied synchronously on boot
 * before React mounts and can read Settings.
 *
 * Flow:
 *   1. Initial state reads from localStorage (already applied to body)
 *   2. On mount, load Settings from Tauri and reconcile
 *   3. `setTheme` writes to both localStorage (cache) and Settings (truth),
 *      and updates `document.body.dataset.theme` for immediate visual effect
 */
export function useMoodTheme(): {
  theme: MoodTheme;
  setTheme: (next: MoodTheme) => void;
} {
  const [theme, setThemeState] = useState<MoodTheme>(() => {
    // Read the cache the FOUC script used. Falls back to zen.
    try {
      const stored = localStorage.getItem(MOOD_STORAGE_KEY);
      if (isMoodTheme(stored)) return stored;
    } catch {
      /* ignore */
    }
    return "zen";
  });

  // On mount, reconcile against the persisted Settings. If Settings disagrees
  // with localStorage (e.g., user edited settings.json directly, or this is
  // their first session on a new device), Settings wins.
  useEffect(() => {
    let cancelled = false;
    invoke<SettingsWithMood>("get_settings")
      .then((settings) => {
        if (cancelled) return;
        const fromSettings = isMoodTheme(settings.mood_theme)
          ? settings.mood_theme
          : "zen";
        if (fromSettings !== theme) {
          applyTheme(fromSettings);
          setThemeState(fromSettings);
        }
      })
      .catch(() => {
        /* Settings unavailable — keep whatever the FOUC script set */
      });
    return () => {
      cancelled = true;
    };
    // Runs once on mount — deliberate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tracks the theme at the moment setTheme was called, without making
  // setTheme re-create on every theme change.
  const previousThemeRef = useRef<MoodTheme>(theme);
  useEffect(() => {
    previousThemeRef.current = theme;
  }, [theme]);

  const setTheme = useCallback((next: MoodTheme) => {
    const previous = previousThemeRef.current;
    if (previous === next) return;
    applyTheme(next);
    setThemeState(next);
    trackEvent("mood_theme.changed", "mood-themes", { theme: next, previous });
    // Persist to localStorage cache synchronously for next boot.
    try {
      localStorage.setItem(MOOD_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    // Persist to Settings (source of truth). Requires reading the full
    // Settings first because `save_settings` takes the whole struct.
    invoke<SettingsWithMood & Record<string, unknown>>("get_settings")
      .then((settings) => {
        return invoke("save_settings", {
          settings: { ...settings, mood_theme: next },
        });
      })
      .catch((err) => {
        console.error("[useMoodTheme] Failed to persist theme:", err);
      });
  }, []);

  return { theme, setTheme };
}

function applyTheme(next: MoodTheme) {
  if (next === "zen") {
    delete document.body.dataset.theme;
  } else {
    document.body.dataset.theme = next;
  }
}
