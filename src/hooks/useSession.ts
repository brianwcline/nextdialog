import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionContext } from "../context/SessionContext";
import type { Session } from "../lib/types";

export function useSession() {
  const { sessions, dispatch } = useSessionContext();

  const loadSessions = useCallback(async () => {
    const list = await invoke<Session[]>("list_sessions");
    dispatch({ type: "SET_SESSIONS", sessions: list });
  }, [dispatch]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const createSession = useCallback(
    async (params: {
      name: string;
      working_directory: string;
      skip_permissions: boolean;
      initial_prompt?: string;
    }) => {
      const session = await invoke<Session>("create_session", {
        name: params.name,
        workingDirectory: params.working_directory,
        skipPermissions: params.skip_permissions,
        initialPrompt: params.initial_prompt ?? null,
      });
      dispatch({ type: "ADD_SESSION", session });
      return session;
    },
    [dispatch],
  );

  const removeSession = useCallback(
    async (id: string) => {
      await invoke("remove_session", { id });
      dispatch({ type: "REMOVE_SESSION", id });
    },
    [dispatch],
  );

  return { sessions, createSession, removeSession, loadSessions };
}
