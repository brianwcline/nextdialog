import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionType } from "../lib/types";

export function useSessionTypes() {
  const [sessionTypes, setSessionTypes] = useState<SessionType[]>([]);

  const load = useCallback(async () => {
    try {
      const types = await invoke<SessionType[]>("list_session_types");
      setSessionTypes(types);
    } catch (err) {
      console.error("Failed to load session types:", err);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createType = useCallback(
    async (sessionType: SessionType) => {
      const created = await invoke<SessionType>("create_session_type", {
        sessionType,
      });
      await load();
      return created;
    },
    [load],
  );

  const updateType = useCallback(
    async (sessionType: SessionType) => {
      const updated = await invoke<SessionType>("update_session_type", {
        sessionType,
      });
      await load();
      return updated;
    },
    [load],
  );

  const deleteType = useCallback(
    async (id: string) => {
      await invoke("delete_session_type", { id });
      await load();
    },
    [load],
  );

  return { sessionTypes, createType, updateType, deleteType, reload: load };
}
