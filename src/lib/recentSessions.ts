import type { SessionTuning } from "./types";

const STORAGE_KEY = "nextdialog:recent-sessions";
const MAX_RECENT = 25;

export interface RecentSession {
  name: string;
  working_directory: string;
  skip_permissions: boolean;
  initial_prompt?: string;
  session_type: string;
  tuning?: SessionTuning;
  last_active: string;
}

/** Migrate legacy entries missing session_type */
function migrateEntry(raw: Partial<RecentSession>): RecentSession {
  return {
    name: raw.name ?? "",
    working_directory: raw.working_directory ?? "",
    skip_permissions: raw.skip_permissions ?? false,
    initial_prompt: raw.initial_prompt,
    session_type: raw.session_type || "claude-code",
    tuning: raw.tuning,
    last_active: raw.last_active ?? new Date().toISOString(),
  };
}

export function getRecentSessions(): RecentSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<RecentSession>[];
    return parsed.map(migrateEntry);
  } catch {
    return [];
  }
}

export function addRecentSession(session: RecentSession): void {
  const existing = getRecentSessions();

  // Deduplicate by name + working_directory + session_type (keep the newer one)
  const filtered = existing.filter(
    (s) =>
      !(
        s.name === session.name &&
        s.working_directory === session.working_directory &&
        s.session_type === session.session_type
      ),
  );

  const updated = [session, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
