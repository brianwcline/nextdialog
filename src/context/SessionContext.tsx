import {
  createContext,
  useContext,
  useReducer,
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

interface SessionContextValue {
  sessions: Session[];
  dispatch: Dispatch<SessionAction>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, dispatch] = useReducer(sessionReducer, []);

  return (
    <SessionContext.Provider value={{ sessions, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSessionContext must be used within SessionProvider");
  }
  return ctx;
}
