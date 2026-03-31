import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultSessionTuning } from "../lib/types";
import type { SessionTuning, AgentConfigOverrides, HookEntry, PermissionRules, FileConfig } from "../lib/types";

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
      const current = tuning ?? { ...defaultSessionTuning };
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
      const current = tuning ?? { ...defaultSessionTuning };
      const merged: SessionTuning = { ...current, startup_commands: commands };
      await saveTuning(merged);
    },
    [tuning, saveTuning],
  );

  // Update hooks config
  const updateHooks = useCallback(
    async (hooks: HookEntry[]) => {
      const current = tuning ?? { ...defaultSessionTuning };
      const merged: SessionTuning = { ...current, hooks_config: hooks };
      await saveTuning(merged);
    },
    [tuning, saveTuning],
  );

  // Update permission rules
  const updatePermissions = useCallback(
    async (rules: PermissionRules) => {
      const current = tuning ?? { ...defaultSessionTuning };
      const merged: SessionTuning = { ...current, permission_rules: rules };
      await saveTuning(merged);
    },
    [tuning, saveTuning],
  );

  // Update file configs
  const updateFileConfigs = useCallback(
    async (files: FileConfig[]) => {
      const current = tuning ?? { ...defaultSessionTuning };
      const merged: SessionTuning = { ...current, file_configs: files };
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
    tuning.startup_commands.length > 0 ||
    tuning.hooks_config.length > 0 ||
    tuning.permission_rules.allow.length > 0 ||
    tuning.permission_rules.deny.length > 0
  );

  return {
    tuning,
    loading,
    hasTuning,
    saveTuning,
    updateOverrides,
    updateStartupCommands,
    updateHooks,
    updatePermissions,
    updateFileConfigs,
    clearTuning,
  };
}
