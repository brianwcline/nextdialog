const STORAGE_KEY = "nextdialog:recent-sessions";
const MAX_RECENT = 25;

export interface RecentSession {
  name: string;
  working_directory: string;
  skip_permissions: boolean;
  initial_prompt?: string;
  session_type?: string;
  last_active: string;
}

export function getRecentSessions(): RecentSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RecentSession[];
  } catch {
    return [];
  }
}

export function addRecentSession(session: RecentSession): void {
  const existing = getRecentSessions();

  // Deduplicate by name + working_directory (keep the newer one)
  const filtered = existing.filter(
    (s) =>
      !(
        s.name === session.name &&
        s.working_directory === session.working_directory
      ),
  );

  const updated = [session, ...filtered].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}
