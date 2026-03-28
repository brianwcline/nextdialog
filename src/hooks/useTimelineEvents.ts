import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { TimelineEntry, GroupedTimelineEntry } from "../lib/types";

const GROUP_WINDOW_MS = 10_000;
const MAX_GROUP_SIZE = 20;
const PAGE_SIZE = 50;

/**
 * Build a meaningful summary for a group of entries instead of "Used N tools".
 * Breaks down by sub-type: "Read 3 files, searched 2 patterns, edited 1 file"
 */
function buildGroupSummary(entries: TimelineEntry[]): string {
  if (entries.length === 1) return entries[0].summary;

  const eventType = entries[0].event_type;

  // File writes: list basenames up to 3, then "+N more"
  if (eventType === "file_write") {
    const names = entries.map((e) => {
      const path = e.summary.replace(/^Edited /, "");
      return path;
    });
    if (names.length <= 3) return `Edited ${names.join(", ")}`;
    return `Edited ${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
  }

  // Bash: list unique activity types
  if (eventType === "bash") {
    const cmds = entries.map((e) => e.summary);
    if (cmds.length <= 3) return cmds.join("; ");
    return `${cmds.slice(0, 2).join("; ")} +${cmds.length - 2} more`;
  }

  // Tool uses: break down by tool type, preserving context
  if (eventType === "tool") {
    const categories: Record<string, TimelineEntry[]> = {};
    for (const e of entries) {
      const verb = e.summary.split(" ")[0] ?? "Used";
      if (!categories[verb]) categories[verb] = [];
      categories[verb].push(e);
    }
    const parts = Object.entries(categories)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3)
      .map(([verb, items]) => {
        if (items.length === 1) {
          return items[0].summary;
        }
        // For Read: "Read App.tsx, types.ts +1 more"
        if (verb === "Read") {
          const names = items.map((e) => e.summary.replace(/^Read /, ""));
          if (names.length <= 2) return `Read ${names.join(", ")}`;
          return `Read ${names[0]} +${names.length - 1} more`;
        }
        // For Searched: show first pattern
        if (verb === "Searched") {
          return `${items[0].summary} +${items.length - 1} more`;
        }
        return `${verb} ${items.length}×`;
      });
    return parts.join(", ");
  }

  return `${entries.length} events`;
}

function groupEntries(raw: TimelineEntry[]): GroupedTimelineEntry[] {
  const groups: GroupedTimelineEntry[] = [];

  // Types that should never be grouped — they're turn boundaries
  const NEVER_GROUP = new Set(["user_input", "status", "notification", "lifecycle"]);

  for (const entry of raw) {
    const last = groups[groups.length - 1];
    if (
      last &&
      !NEVER_GROUP.has(entry.event_type) &&
      last.event_type === entry.event_type &&
      last.count < MAX_GROUP_SIZE &&
      Math.abs(
        new Date(entry.timestamp).getTime() -
          new Date(last.timestamp).getTime(),
      ) < GROUP_WINDOW_MS
    ) {
      last.entries.push(entry);
      last.count = last.entries.length;
      last.timestamp = entry.timestamp;
      last.summary = buildGroupSummary(last.entries);
    } else {
      groups.push({
        id: entry.timestamp,
        timestamp: entry.timestamp,
        event_type: entry.event_type,
        summary: entry.summary,
        count: 1,
        entries: [entry],
      });
    }
  }

  return groups;
}

export function useTimelineEvents(sessionId: string, isOpen: boolean) {
  const [rawEntries, setRawEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadedRef = useRef(false);
  const totalLoadedRef = useRef(0);

  // Load historical entries on first open
  useEffect(() => {
    if (!isOpen || loadedRef.current) return;
    loadedRef.current = true;

    invoke<TimelineEntry[]>("get_timeline_entries", {
      id: sessionId,
      count: PAGE_SIZE,
    })
      .then((entries) => {
        setRawEntries(entries);
        totalLoadedRef.current = entries.length;
        setHasMore(entries.length >= PAGE_SIZE);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [sessionId, isOpen]);

  // Load older entries (infinite scroll)
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);

    invoke<TimelineEntry[]>("get_timeline_entries", {
      id: sessionId,
      count: PAGE_SIZE,
      offset: totalLoadedRef.current,
    })
      .then((olderEntries) => {
        if (olderEntries.length === 0) {
          setHasMore(false);
        } else {
          // Prepend older entries before the existing ones
          setRawEntries((prev) => [...olderEntries, ...prev]);
          totalLoadedRef.current += olderEntries.length;
          setHasMore(olderEntries.length >= PAGE_SIZE);
        }
        setLoadingMore(false);
      })
      .catch(() => {
        setLoadingMore(false);
      });
  }, [sessionId, loadingMore, hasMore]);

  // Subscribe to real-time timeline events
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    listen<TimelineEntry>(
      `session-timeline-${sessionId}`,
      (event) => {
        if (cancelled) return;
        setRawEntries((prev) => [...prev, event.payload]);
        totalLoadedRef.current += 1;
      },
    ).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [sessionId]);

  const entries = groupEntries(rawEntries);

  return { entries, loading, loadingMore, hasMore, loadMore };
}
