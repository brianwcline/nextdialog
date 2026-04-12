import { useMemo } from "react";
import type { Session } from "../lib/types";
import { deriveProject } from "../lib/project";
import { getAttentionScore, type AttentionSession } from "../lib/attention";

/**
 * Convert a production `Session` plus a timeline count into the minimal
 * `AttentionSession` shape the scoring engine needs. Keeping this conversion
 * centralized means the attention module stays free of UI types.
 */
export function toAttentionSession(
  session: Session,
  interactionCount: number,
): AttentionSession {
  return {
    id: session.id,
    status: session.status,
    lastInteraction: new Date(session.last_active).getTime(),
    interactionCount,
    project: deriveProject(session.working_directory),
  };
}

/**
 * Compute the attention score for a single session. Memoized on the inputs.
 * Used by SessionCard for any per-card attention-based UX (e.g., footer
 * labels, subtle visual weight). Not required by SmartGrid — the grid uses
 * the raw `AttentionSession` array directly.
 */
export function useAttentionScore(
  session: Session,
  interactionCount: number,
): number {
  return useMemo(
    () => getAttentionScore(toAttentionSession(session, interactionCount)),
    [
      session.id,
      session.status,
      session.last_active,
      session.working_directory,
      interactionCount,
    ],
  );
}
