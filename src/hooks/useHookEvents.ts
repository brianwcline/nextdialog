import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSessionContext } from "../context/SessionContext";

interface HookBash {
  command: string;
  activity: string;
}

/**
 * Listen to Claude Code hook events (file writes, bash commands, notifications)
 * and dispatch updates to SessionContext.
 * Follows the same pattern as useStatus.ts.
 */
export function useHookEvents(sessionIds: string[]) {
  const { dispatch } = useSessionContext();
  const sessionIdsKey = sessionIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    for (const id of sessionIds) {
      // Clear hook notification when session starts working again
      listen<string>(`session-status-${id}`, (event) => {
        if (cancelled) return;
        if (event.payload === "working") {
          dispatch({
            type: "UPDATE_SESSION",
            id,
            updates: { hookNotification: undefined, lastToolUse: undefined },
          });
        }
      }).then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      });

      // Hook notification events (faster than regex for waiting detection)
      listen<string>(`session-hook-notification-${id}`, (event) => {
        if (cancelled) return;
        dispatch({
          type: "UPDATE_SESSION",
          id,
          updates: { hookNotification: event.payload },
        });
      }).then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      });

      // File write events
      listen<string>(`session-hook-file-write-${id}`, (event) => {
        if (cancelled) return;
        dispatch({
          type: "UPDATE_SESSION",
          id,
          updates: {
            lastToolUse: `Write: ${basename(event.payload)}`,
          },
        });
      }).then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      });

      // Bash command events
      listen<HookBash>(`session-hook-bash-${id}`, (event) => {
        if (cancelled) return;
        const { activity } = event.payload;
        dispatch({
          type: "UPDATE_SESSION",
          id,
          updates: { lastToolUse: activity },
        });
      }).then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      });

      // Generic tool use events
      listen<string>(`session-hook-tool-${id}`, (event) => {
        if (cancelled) return;
        dispatch({
          type: "UPDATE_SESSION",
          id,
          updates: { lastToolUse: event.payload },
        });
      }).then((unlisten) => {
        if (cancelled) unlisten();
        else unlisteners.push(unlisten);
      });
    }

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [sessionIdsKey, dispatch]);
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}
