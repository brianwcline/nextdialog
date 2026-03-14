import type { Session } from "./types";

export interface SessionGroup {
  directory: string;
  sessions: Session[];
}

export function groupByDirectory(sessions: Session[]): SessionGroup[] {
  const map = new Map<string, Session[]>();

  for (const session of sessions) {
    const dir = session.working_directory;
    if (!map.has(dir)) {
      map.set(dir, []);
    }
    map.get(dir)!.push(session);
  }

  return Array.from(map.entries())
    .map(([directory, sessions]) => ({ directory, sessions }))
    .sort((a, b) => b.sessions.length - a.sessions.length);
}

export function abbreviateDirectory(dir: string): string {
  const home = "/Users/";
  if (dir.startsWith(home)) {
    const rest = dir.slice(home.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx !== -1) return "~" + rest.slice(slashIdx);
    return "~";
  }
  return dir;
}
