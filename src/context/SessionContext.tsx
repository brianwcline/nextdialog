import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
  type Dispatch,
} from "react";
import type { Session, SessionStatus } from "../lib/types";

type SessionAction =
  | { type: "SET_SESSIONS"; sessions: Session[] }
  | { type: "ADD_SESSION"; session: Session }
  | { type: "REMOVE_SESSION"; id: string }
  | { type: "UPDATE_STATUS"; id: string; status: SessionStatus }
  | { type: "UPDATE_SESSION"; id: string; updates: Partial<Session> };

function sessionReducer(state: Session[], action: SessionAction): Session[] {
  switch (action.type) {
    case "SET_SESSIONS":
      return action.sessions;
    case "ADD_SESSION":
      return [...state, action.session];
    case "REMOVE_SESSION":
      return state.filter((s) => s.id !== action.id);
    case "UPDATE_STATUS":
      return state.map((s) =>
        s.id === action.id ? { ...s, status: action.status } : s,
      );
    case "UPDATE_SESSION":
      return state.map((s) =>
        s.id === action.id ? { ...s, ...action.updates } : s,
      );
    default:
      return state;
  }
}

type SetFocusedSessionId = (
  next: string | null | ((prev: string | null) => string | null),
) => void;

interface SessionContextValue {
  sessions: Session[];
  dispatch: Dispatch<SessionAction>;
  /** ID of the card currently focused in the smart layout, or null. */
  focusedSessionId: string | null;
  /**
   * Set the focused session. Accepts either a direct value or a functional
   * updater (same shape as React's `useState` setter) so consumers can
   * toggle without closing over stale state.
   */
  setFocusedSessionId: SetFocusedSessionId;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, dispatch] = useReducer(sessionReducer, []);
  const [focusedSessionId, setFocusedSessionIdState] = useState<string | null>(
    null,
  );

  const setFocusedSessionId = useCallback<SetFocusedSessionId>((next) => {
    setFocusedSessionIdState((prev) =>
      typeof next === "function" ? next(prev) : next,
    );
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ sessions, dispatch, focusedSessionId, setFocusedSessionId }),
    [sessions, focusedSessionId, setFocusedSessionId],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return ctx;
}
