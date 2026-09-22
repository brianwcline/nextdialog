import type { Session, SessionStatus } from "./types";
import { getAttentionScore, type AttentionSession } from "./attention";
import { deriveProject } from "./project";
import { toAttentionSession } from "../hooks/useAttentionScore";

/** Layout ids for stacks are prefixed so they never collide with session ids. */
const STACK_ID_PREFIX = "stack:";

/** Default name when two sessions from different projects are stacked. */
export const DEFAULT_STACK_NAME = "New Stack";

/** A session group shown as one stack tile (iOS-folder style, #12 / #17). */
export interface StackInfo {
  name: string;
  /** Members, busiest (highest attention) first. */
  members: Session[];
  /** Members that are waiting on the user or in error. */
  attentionCount: number;
  /** Most urgent status among members, for the badge color. */
  status: SessionStatus;
}

// Most urgent first: this is what a stack "shows" when members differ.
const STATUS_URGENCY: SessionStatus[] = [
  "waiting",
  "error",
  "planning",
  "working",
  "starting",
  "idle",
  "ready",
  "stopped",
];

export function stackId(name: string): string {
  return `${STACK_ID_PREFIX}${name}`;
}

export function stackNameFromId(id: string): string | null {
  return id.startsWith(STACK_ID_PREFIX) ? id.slice(STACK_ID_PREFIX.length) : null;
}

/** A session a stack must surface with its badge. */
export function needsAttention(session: Session): boolean {
  return session.status === "waiting" || session.status === "error";
}

export function mostUrgentStatus(statuses: SessionStatus[]): SessionStatus {
  let best = STATUS_URGENCY.length - 1;
  for (const status of statuses) {
    const rank = STATUS_URGENCY.indexOf(status);
    if (rank !== -1 && rank < best) best = rank;
  }
  return STATUS_URGENCY[best];
}

/** Distinct group names, case-insensitive alphabetical. */
export function listGroupNames(sessions: Session[]): string[] {
  const names = new Set<string>();
  for (const s of sessions) {
    if (s.group) names.add(s.group);
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Split sessions into loose cards and stacks (one per group). */
export function buildStacks(
  sessions: Session[],
  timelineCounts: Record<string, number>,
): { loose: Session[]; stacks: StackInfo[] } {
  const loose: Session[] = [];
  const byGroup = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.group) {
      loose.push(session);
      continue;
    }
    const members = byGroup.get(session.group) ?? [];
    members.push(session);
    byGroup.set(session.group, members);
  }

  const score = (s: Session) => getAttentionScore(toAttentionSession(s, timelineCounts[s.id] ?? 0));
  const stacks = listGroupNames(sessions).map((name): StackInfo => {
    const members = [...(byGroup.get(name) ?? [])].sort((a, b) => score(b) - score(a));
    return {
      name,
      members,
      attentionCount: members.filter(needsAttention).length,
      status: mostUrgentStatus(members.map((m) => m.status)),
    };
  });
  return { loose, stacks };
}

/** The synthetic entry the layout engine scores and places for a stack. */
export function stackAttentionEntry(
  stack: StackInfo,
  timelineCounts: Record<string, number>,
): AttentionSession {
  return {
    id: stackId(stack.name),
    status: stack.status,
    lastInteraction: Math.max(...stack.members.map((m) => new Date(m.last_active).getTime())),
    interactionCount: stack.members.reduce((sum, m) => sum + (timelineCounts[m.id] ?? 0), 0),
    // Stacks are never "related" to a focused card.
    project: null,
    isStack: true,
  };
}

/** `base`, or `base 2`, `base 3`… if that name is taken (case-insensitive). */
export function uniqueStackName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Name for a stack made by dropping `a` onto `b`: their shared project, else a default. */
export function newStackName(a: Session, b: Session, existing: string[]): string {
  const projectA = deriveProject(a.working_directory);
  const projectB = deriveProject(b.working_directory);
  const base = projectA && projectA === projectB ? projectA : DEFAULT_STACK_NAME;
  return uniqueStackName(base, existing);
}
