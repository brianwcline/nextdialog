import { useState, useCallback, useMemo, useEffect, useRef, Component, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SessionProvider } from "./context/SessionContext";
import { ShiftingGradient } from "./components/ShiftingGradient";
import { HomeView } from "./components/HomeView";
import { NewSessionModal } from "./components/NewSessionModal";
import { TerminalOverlay } from "./components/TerminalOverlay";
import { ContextMenu } from "./components/ContextMenu";
import { SettingsView } from "./components/SettingsView";
import { useSession } from "./hooks/useSession";
import { useStatus } from "./hooks/useStatus";
import {
  getRecentSessions,
  addRecentSession,
  type RecentSession,
} from "./lib/recentSessions";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", color: "#c00" }}>
          <h2>App crashed</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}
          >
            Try to recover
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const { sessions, createSession, removeSession } = useSession();
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  useStatus(sessionIds);

  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() =>
    getRecentSessions(),
  );

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [spawnedIds, setSpawnedIds] = useState<string[]>([]);
  // Ref guards against double-spawn from StrictMode or rapid clicks
  const spawningRef = useRef<Set<string>>(new Set());

  const handleSelectSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    if (spawningRef.current.has(id)) return;
    spawningRef.current.add(id);
    try {
      await invoke("spawn_pty_session", { id, rows: null, cols: null });
      setSpawnedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } catch (err) {
      console.error("Failed to spawn PTY:", err);
      spawningRef.current.delete(id);
    }
  }, []);

  const handleCreateSession = useCallback(
    async (params: {
      name: string;
      working_directory: string;
      skip_permissions: boolean;
      initial_prompt?: string;
    }) => {
      const session = await createSession(params);
      await handleSelectSession(session.id);
    },
    [createSession, handleSelectSession],
  );

  const handleContextMenu = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ id, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleEndSession = useCallback(
    async (id: string) => {
      try {
        await invoke("kill_pty_session", { id });
        spawningRef.current.delete(id);
        setSpawnedIds((prev) => prev.filter((s) => s !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      } catch (err) {
        console.error("Failed to kill session:", err);
      }
    },
    [activeSessionId],
  );

  const handleRestartSession = useCallback(async (id: string) => {
    try {
      await invoke("restart_pty_session", { id, rows: null, cols: null });
      setSpawnedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } catch (err) {
      console.error("Failed to restart session:", err);
    }
  }, []);

  const handleRemoveSession = useCallback(
    async (id: string) => {
      try {
        // Stash session config for "recent sessions" before removing
        const session = sessions.find((s) => s.id === id);
        if (session) {
          addRecentSession({
            name: session.name,
            working_directory: session.working_directory,
            skip_permissions: session.skip_permissions,
            initial_prompt: session.initial_prompt,
            last_active: session.last_active,
          });
          setRecentSessions(getRecentSessions());
        }

        await invoke("kill_pty_session", { id }).catch(() => {});
        spawningRef.current.delete(id);
        setSpawnedIds((prev) => prev.filter((s) => s !== id));
        await removeSession(id);
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      } catch (err) {
        console.error("Failed to remove session:", err);
      }
    },
    [activeSessionId, removeSession, sessions],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when modals are open or terminal is focused
      if (activeSessionId) return;

      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        setShowNewSession(true);
      }

      // Cmd+1-9: jump to nth session
      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < sessions.length) {
          handleSelectSession(sessions[idx].id);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionId, sessions, handleSelectSession]);

  const contextMenuItems = contextMenu
    ? [
        {
          label: "Open",
          onClick: () => handleSelectSession(contextMenu.id),
        },
        {
          label: "Restart",
          onClick: () => handleRestartSession(contextMenu.id),
        },
        {
          label: "End Session",
          onClick: () => handleEndSession(contextMenu.id),
        },
        {
          label: "Remove",
          variant: "danger" as const,
          onClick: () => handleRemoveSession(contextMenu.id),
        },
      ]
    : [];

  return (
    <>
      <ShiftingGradient />
      <HomeView
        sessions={sessions}
        onNewSession={() => setShowNewSession(true)}
        onSelectSession={handleSelectSession}
        onSessionContextMenu={handleContextMenu}
        onOpenSettings={() => setShowSettings(true)}
      />
      <NewSessionModal
        isOpen={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreate={handleCreateSession}
        recentSessions={recentSessions}
        onReopenRecent={(recent) => {
          setShowNewSession(false);
          handleCreateSession({
            name: recent.name,
            working_directory: recent.working_directory,
            skip_permissions: recent.skip_permissions,
            initial_prompt: recent.initial_prompt,
          });
        }}
      />
      <SettingsView
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
      {spawnedIds.map((id) => {
        const session = sessions.find((s) => s.id === id);
        if (!session) return null;
        return (
          <TerminalOverlay
            key={id}
            session={session}
            isOpen={activeSessionId === id}
            onClose={() => setActiveSessionId(null)}
            onEnd={handleEndSession}
            onRestart={handleRestartSession}
            onRemove={handleRemoveSession}
          />
        );
      })}
      <ContextMenu
        isOpen={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenuItems}
        onClose={() => setContextMenu(null)}
      />
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <AppContent />
      </SessionProvider>
    </ErrorBoundary>
  );
}

export default App;
