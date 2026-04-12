/**
 * Mood theme registry.
 *
 * Zen is the default — no `data-theme` attribute is set on the body. The
 * other five themes are scoped to `body[data-theme="<name>"]` in themes.css.
 *
 * To add a new theme:
 *   1. Add the name to THEMES below
 *   2. Add a matching `body[data-theme="<name>"] { ... }` block in themes.css
 *   3. Add an entry to THEME_LABELS for the display name
 */
import type { MoodTheme } from "../lib/types";

export const THEMES: readonly MoodTheme[] = [
  "zen",
  "bauhaus",
  "memphis",
  "bento",
  "risograph",
  "synthwave",
] as const;

export const THEME_LABELS: Record<MoodTheme, string> = {
  zen: "Zen",
  bauhaus: "Bauhaus",
  memphis: "Memphis",
  bento: "Bento",
  risograph: "Risograph",
  synthwave: "Synthwave",
};

/**
 * Short one-word description shown alongside each theme in the selector.
 * Aim for vibe, not feature list.
 */
export const THEME_DESCRIPTIONS: Record<MoodTheme, string> = {
  zen: "Calm",
  bauhaus: "Bold",
  memphis: "Playful",
  bento: "Clean",
  risograph: "Inked",
  synthwave: "Neon",
};

/** localStorage key used by the FOUC-prevention script in index.html. */
export const MOOD_STORAGE_KEY = "nd-mood";

export function isMoodTheme(value: unknown): value is MoodTheme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}
