import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSessionContext } from "../context/SessionContext";
import { listGroupNames, newStackName } from "../lib/stacks";
import { trackEvent } from "../lib/telemetry";

/** How a stack change was made, for adoption telemetry. */
export type GroupChangeSource = "drag" | "menu";

const FEATURE_ID = "session-groups";

/**
 * Session stack (group) operations: persist through Tauri, update the store,
 * and emit telemetry. Group names are never sent in telemetry: they can be
 * client names. Each operation logs and returns null on failure.
 */
export function useSessionGroups() {
  const { sessions, dispatch } = useSessionContext();
  const groupNames = useMemo(() => listGroupNames(sessions), [sessions]);

  /** Persist one session's group and mirror it into the store. */
  const persistGroup = useCallback(
    async (id: string, group: string | null): Promise<string | null> => {
      const stored = await invoke<string | null>("set_session_group", { id, group });
      dispatch({ type: "UPDATE_SESSION", id, updates: { group: stored ?? undefined } });
      return stored;
    },
    [dispatch],
  );

  const setSessionGroup = useCallback(
    async (id: string, group: string | null, via: GroupChangeSource): Promise<string | null> => {
      try {
        const stored = await persistGroup(id, group);
        if (stored === null) {
          trackEvent("session_group.removed", FEATURE_ID, { via }, id);
          return null;
        }
        const isNewGroup = !groupNames.includes(stored);
        const groupCount = groupNames.length + (isNewGroup ? 1 : 0);
        trackEvent("session_group.assigned", FEATURE_ID, { via, is_new_group: isNewGroup, group_count: groupCount }, id);
        if (isNewGroup) trackEvent("stack.created", FEATURE_ID, { via });
        return stored;
      } catch (err) {
        console.error("Failed to set session group:", err);
        return null;
      }
    },
    [persistGroup, groupNames],
  );

  /** Drop `sourceId` onto `targetId`: both go into a new stack. Returns its name. */
  const createStack = useCallback(
    async (sourceId: string, targetId: string): Promise<string | null> => {
      const source = sessions.find((s) => s.id === sourceId);
      const target = sessions.find((s) => s.id === targetId);
      if (!source || !target) return null;
      try {
        const name = newStackName(source, target, groupNames);
        const stored = await persistGroup(targetId, name);
        if (stored === null) return null;
        await persistGroup(sourceId, stored);
        const groupCount = groupNames.length + 1;
        trackEvent("stack.created", FEATURE_ID, { via: "drag" });
        trackEvent("session_group.assigned", FEATURE_ID, { via: "drag", is_new_group: true, group_count: groupCount }, targetId);
        trackEvent("session_group.assigned", FEATURE_ID, { via: "drag", is_new_group: false, group_count: groupCount }, sourceId);
        return stored;
      } catch (err) {
        console.error("Failed to create stack:", err);
        return null;
      }
    },
    [sessions, groupNames, persistGroup],
  );

  /** Rename a stack across all its members. Returns the stored name. */
  const renameStack = useCallback(
    async (from: string, to: string): Promise<string | null> => {
      try {
        const stored = await invoke<string>("rename_session_group", { from, to });
        for (const s of sessions) {
          if (s.group === from) {
            dispatch({ type: "UPDATE_SESSION", id: s.id, updates: { group: stored } });
          }
        }
        trackEvent("stack.renamed", FEATURE_ID);
        return stored;
      } catch (err) {
        console.error("Failed to rename stack:", err);
        return null;
      }
    },
    [dispatch, sessions],
  );

  return { groupNames, setSessionGroup, createStack, renameStack };
}
