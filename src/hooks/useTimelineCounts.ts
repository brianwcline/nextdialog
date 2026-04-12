import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../lib/types";

/**
 * Batch-fetches the timeline entry count per session and returns a map keyed
 * by session id. Used by the smart layout engine as the frequency signal in
 * the attention score. Refetches when the session list changes (add/remove),
 * not on every render — timeline counts are stable between refreshes.
 *
 * Sessions with no timeline file (brand new, no events yet) get count=0,
 * which degrades the attention score's frequency term to 0 and lets the
 * recency term dominate — the correct behavior for fresh sessions.
 */
export function useTimelineCounts(sessions: Session[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const refetch = useCallback(async () => {
    const ids = sessions.map((s) => s.id);
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const n = await invoke<number>("get_timeline_count", { id });
          return [id, n] as const;
        } catch {
          return [id, 0] as const;
        }
      }),
    );
    setCounts(Object.fromEntries(results));
  }, [sessions]);

  // Re-fetch when the set of session ids changes (add/remove).
  // Using a join of ids as the dep so reordering doesn't trigger a refetch.
  const idKey = sessions
    .map((s) => s.id)
    .sort()
    .join("|");

  useEffect(() => {
    void refetch();
    // idKey is the effective dependency; refetch is stable enough for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  return counts;
}
