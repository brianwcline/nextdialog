import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { trackEvent } from "./telemetry";

/**
 * Global terminal font size shared by every xterm pane.
 *
 * Source of truth: `Settings.terminal_font_size` (Rust). localStorage is a
 * boot cache so the first terminal and the `app.launched` snapshot see the
 * right value before `get_settings` resolves. This mirrors how mood themes
 * are handled in `useMoodTheme`.
 *
 * It's a module-level store rather than React context because xterm
 * instances live outside React's render cycle; `useTerminal` subscribes
 * directly and mutates `term.options.fontSize`.
 */

export const TERMINAL_FONT_SIZE_MIN = 9;
export const TERMINAL_FONT_SIZE_MAX = 24;
export const TERMINAL_FONT_SIZE_DEFAULT = 13;

const STORAGE_KEY = "nd-terminal-font-size";

// Holding Cmd+= fires a burst of keydowns. Persist and report once the
// burst settles, not once per step.
const PERSIST_DEBOUNCE_MS = 400;

export type FontSizeChangeSource = "shortcut" | "settings" | "reset";

type Listener = () => void;

const listeners = new Set<Listener>();
let currentSize = readCachedSize();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let sizeBeforeBurst: number | null = null;
let loadedFromSettings = false;

export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return TERMINAL_FONT_SIZE_DEFAULT;
  return Math.min(
    TERMINAL_FONT_SIZE_MAX,
    Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)),
  );
}

function readCachedSize(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return clampTerminalFontSize(Number(raw));
  } catch {
    // Storage blocked (private mode, cleared site data) — use the default.
  }
  return TERMINAL_FONT_SIZE_DEFAULT;
}

function writeCachedSize(size: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // Cache only; Settings remains the source of truth.
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function getTerminalFontSize(): number {
  return currentSize;
}

export function subscribeTerminalFontSize(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reconcile with persisted Settings once per app run. Settings wins over
 * the localStorage cache (e.g. settings.json edited by hand).
 */
export function loadTerminalFontSize(): void {
  if (loadedFromSettings) return;
  loadedFromSettings = true;
  invoke<{ terminal_font_size?: number }>("get_settings")
    .then((settings) => {
      if (typeof settings.terminal_font_size !== "number") return;
      const persisted = clampTerminalFontSize(settings.terminal_font_size);
      writeCachedSize(persisted);
      if (persisted !== currentSize) {
        currentSize = persisted;
        notify();
      }
    })
    .catch((err) => {
      console.error("[terminalFontSize] Failed to load settings:", err);
    });
}

export function setTerminalFontSize(
  next: number,
  source: FontSizeChangeSource,
): void {
  const clamped = clampTerminalFontSize(next);
  if (clamped === currentSize) return;

  if (sizeBeforeBurst === null) sizeBeforeBurst = currentSize;
  currentSize = clamped;
  writeCachedSize(clamped);
  notify();

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const previous = sizeBeforeBurst;
    sizeBeforeBurst = null;
    const size = currentSize;
    if (previous === size) return;

    invoke<number>("set_terminal_font_size", { size }).catch((err) => {
      console.error("[terminalFontSize] Failed to persist font size:", err);
    });
    trackEvent("terminal.font_size_changed", "terminal-display", {
      size,
      previous: previous ?? TERMINAL_FONT_SIZE_DEFAULT,
      source,
    });
  }, PERSIST_DEBOUNCE_MS);
}

export function stepTerminalFontSize(delta: number): void {
  setTerminalFontSize(currentSize + delta, "shortcut");
}

export function resetTerminalFontSize(): void {
  setTerminalFontSize(TERMINAL_FONT_SIZE_DEFAULT, "reset");
}

export function useTerminalFontSize(): number {
  return useSyncExternalStore(subscribeTerminalFontSize, getTerminalFontSize);
}
