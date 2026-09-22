import type { Session } from "./types";

/** One home-view section: a named group, or `null` for ungrouped sessions. */
export interface SessionSection {
  group: string | null;
  sessions: Session[];
}

/** Whether any session has been put in a group (turns on sectioned rendering). */
export function hasAnyGroup(sessions: Session[]): boolean {
  return sessions.some((s) => Boolean(s.group));
}

/** Distinct group names in display order (case-insensitive alphabetical). */
export function listGroupNames(sessions: Session[]): string[] {
  const names = new Set<string>();
  for (const s of sessions) {
    if (s.group) names.add(s.group);
  }
  return [...names].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/**
 * Split sessions into sections: named groups alphabetically, then ungrouped
 * last. Session order within a section is preserved; the smart layout sorts
 * each section by attention anyway.
 */
export function partitionIntoSections(sessions: Session[]): SessionSection[] {
  const sections: SessionSection[] = listGroupNames(sessions).map((group) => ({
    group,
    sessions: sessions.filter((s) => s.group === group),
  }));
  const ungrouped = sessions.filter((s) => !s.group);
  if (ungrouped.length > 0) {
    sections.push({ group: null, sessions: ungrouped });
  }
  return sections;
}
