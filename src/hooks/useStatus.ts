import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useSessionContext } from "../context/SessionContext";
import type { SessionStatus } from "../lib/types";
import { playChime, playAlert, playTone } from "../lib/sounds";

interface SoundSettings {
  sounds_enabled: boolean;
  sound_volume: number;
}

export function useStatus(sessionIds: string[]) {
  const { sessions, dispatch } = useSessionContext();
  const notifPermissionRef = useRef<boolean | null>(null);
  const soundSettingsRef = useRef<SoundSettings>({
    sounds_enabled: false,
    sound_volume: 0.5,
  });

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

  // Load sound settings
  useEffect(() => {
    invoke<SoundSettings>("get_settings")
      .then((settings) => {
        soundSettingsRef.current = {
          sounds_enabled: settings.sounds_enabled,
          sound_volume: settings.sound_volume,
        };
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    for (const id of sessionIds) {
      listen<string>(`session-status-${id}`, (event) => {
        const newStatus = event.payload as SessionStatus;
        const prevSession = sessions.find((s) => s.id === id);
        const prevStatus = prevSession?.status;

        dispatch({ type: "UPDATE_STATUS", id, status: newStatus });

        // Fire notification on "waiting" transition
        if (newStatus === "waiting" && notifPermissionRef.current) {
          const session = sessions.find((s) => s.id === id);
          sendNotification({
            title: "NextDialog",
            body: `${session?.name ?? "Session"} is waiting for input`,
          });
        }

        // Play sounds on status transitions
        if (
          soundSettingsRef.current.sounds_enabled &&
          prevStatus &&
          prevStatus !== newStatus
        ) {
          const vol = soundSettingsRef.current.sound_volume;
          if (newStatus === "idle" && prevStatus === "working") {
            playChime(vol);
          } else if (newStatus === "error") {
            playAlert(vol);
          } else if (newStatus === "waiting") {
            playTone(vol);
          }
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
