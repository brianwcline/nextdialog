import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useSessionContext } from "../context/SessionContext";
import type { SessionStatus } from "../lib/types";

export function useStatus(sessionIds: string[]) {
  const { sessions, dispatch } = useSessionContext();
  const notifPermissionRef = useRef<boolean | null>(null);

  // Check notification permission on mount
  useEffect(() => {
    isPermissionGranted().then((granted) => {
      if (granted) {
        notifPermissionRef.current = true;
      } else {
        requestPermission().then((perm) => {
          notifPermissionRef.current = perm === "granted";
        });
      }
    });
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    for (const id of sessionIds) {
      listen<string>(`session-status-${id}`, (event) => {
        const newStatus = event.payload as SessionStatus;
        dispatch({ type: "UPDATE_STATUS", id, status: newStatus });

        // Fire notification on "waiting" transition
        if (newStatus === "waiting" && notifPermissionRef.current) {
          const session = sessions.find((s) => s.id === id);
          sendNotification({
            title: "NextDialog",
            body: `${session?.name ?? "Session"} is waiting for input`,
          });
        }
      }).then((unlisten) => {
        unlisteners.push(unlisten);
      });
    }

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [sessionIds.join(","), dispatch, sessions]);
}
