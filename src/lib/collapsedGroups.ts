// Per-viewer UI preference, not a Setting: which home-view groups are
// collapsed. Stored as a JSON array of group names.
const STORAGE_KEY = "nd-collapsed-groups";

export function readCollapsedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function writeCollapsedGroups(groups: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...groups]));
  } catch {
    // Collapsed state just won't survive a relaunch.
  }
}
