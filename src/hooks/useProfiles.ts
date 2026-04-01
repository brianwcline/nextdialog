import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TuningProfile, SessionTuning } from "../lib/types";

export function useProfiles(agentType: string) {
  const [profiles, setProfiles] = useState<TuningProfile[]>([]);

  const refresh = useCallback(() => {
    invoke<TuningProfile[]>("list_tuning_profiles", { agentType })
      .then(setProfiles)
      .catch(console.error);
  }, [agentType]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveProfile = useCallback(
    async (name: string, tuning: SessionTuning, description?: string) => {
      const profile = await invoke<TuningProfile>("create_tuning_profile", {
        name,
        description: description ?? null,
        agentType,
        tuning,
        tags: null,
      });
      refresh();
      return profile;
    },
    [agentType, refresh],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      await invoke("delete_tuning_profile", { id });
      refresh();
    },
    [refresh],
  );

  return { profiles, saveProfile, deleteProfile, refresh };
}
