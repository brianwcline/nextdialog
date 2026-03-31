import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionTuning, AgentConfigOverrides } from "../lib/types";

export function useTuning(sessionId: string) {
  const [tuning, setTuning] = useState<SessionTuning | null>(null);
  const [loading, setLoading] = useState(true);

  // Load tuning from backend
  useEffect(() => {
    setLoading(true);
    invoke<SessionTuning | null>("get_session_tuning", { id: sessionId })
      .then((t) => setTuning(t))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Save tuning to backend and update local state
  const saveTuning = useCallback(
    async (updated: SessionTuning | null) => {
      await invoke("update_session_tuning", { id: sessionId, tuning: updated });
      setTuning(updated);
    },
    [sessionId],
  );

  // Update just the config overrides
  const updateOverrides = useCallback(
    async (overrides: Partial<AgentConfigOverrides>) => {
      const current = tuning ?? { config_overrides: {}, file_configs: [], startup_commands: [] };
      const merged: SessionTuning = {
        ...current,
        config_overrides: { ...current.config_overrides, ...overrides },
      };
      await saveTuning(merged);
    },
    [tuning, saveTuning],
  );

  // Update startup commands
  const updateStartupCommands = useCallback(
    async (commands: string[]) => {
      const current = tuning ?? { config_overrides: {}, file_configs: [], startup_commands: [] };
      const merged: SessionTuning = { ...current, startup_commands: commands };
      await saveTuning(merged);
    },
    [tuning, saveTuning],
  );

  // Clear all tuning
  const clearTuning = useCallback(async () => {
    await saveTuning(null);
  }, [saveTuning]);

  // Check if session has any tuning applied
  const hasTuning = tuning !== null && (
    Object.values(tuning.config_overrides).some((v) => v !== null && v !== undefined) ||
    tuning.file_configs.length > 0 ||
    tuning.startup_commands.length > 0
  );

  return {
    tuning,
    loading,
    hasTuning,
    saveTuning,
    updateOverrides,
    updateStartupCommands,
    clearTuning,
  };
}
