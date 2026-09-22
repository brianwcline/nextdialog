import { useMemo } from "react";
import type { Session } from "../lib/types";
import {
  computeLayout,
  sortSessions,
  type AttentionSession,
  type LayoutMode,
  type LayoutResult,
} from "../lib/attention";
import { toAttentionSession } from "./useAttentionScore";
import { stackAttentionEntry, type StackInfo } from "../lib/stacks";

/**
 * Memoized wrapper around `sortSessions` + `computeLayout`. Feeds real
 * `Session` objects plus per-session timeline counts and returns the layout
 * the grid renders. The layout re-computes when session identity, status,
 * last_active, container width, focus state, or timeline counts change.
 *
 * Phase 1 hardcodes `layout = "hybrid"`. Phase 2 (deferred) would make this
 * read from Settings.
 */
export function useSmartLayout(
  sessions: Session[],
  stacks: StackInfo[],
  timelineCounts: Record<string, number>,
  focusedSessionId: string | null,
  containerWidth: number,
  layout: LayoutMode = "hybrid",
): LayoutResult {
  // Build the AttentionSession array once per render.
  const attentionSessions = useMemo<AttentionSession[]>(
    () => [
      ...sessions.map((s) => toAttentionSession(s, timelineCounts[s.id] ?? 0)),
      // Each stack is placed as one synthetic entry scored from its members.
      ...stacks.map((stack) => stackAttentionEntry(stack, timelineCounts)),
    ],
    [sessions, stacks, timelineCounts],
  );

  const focusedSession = useMemo<AttentionSession | null>(
    () =>
      focusedSessionId
        ? attentionSessions.find((s) => s.id === focusedSessionId) ?? null
        : null,
    [attentionSessions, focusedSessionId],
  );

  return useMemo(() => {
    if (attentionSessions.length === 0 || containerWidth <= 0) {
      return {
        positions: [],
        totalHeight: 0,
        showDockDivider: false,
        dockDividerY: null,
      };
    }
    const sorted = sortSessions(attentionSessions, layout, focusedSession);
    return computeLayout(sorted, layout, focusedSession, containerWidth);
  }, [attentionSessions, layout, focusedSession, containerWidth]);
}
