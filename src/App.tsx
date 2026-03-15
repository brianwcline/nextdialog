import { useState, useCallback, useMemo, useEffect, useRef, Component, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./lib/types";
import { SessionProvider } from "./context/SessionContext";
import { ShiftingGradient } from "./components/ShiftingGradient";
import { HomeView } from "./components/HomeView";
import { NewSessionModal } from "./components/NewSessionModal";
import { TerminalOverlay } from "./components/TerminalOverlay";
import { ContextMenu } from "./components/ContextMenu";
import { SettingsView } from "./components/SettingsView";
import { AttentionIndicator } from "./components/AttentionIndicator";
import { SessionDock } from "./components/SessionDock";
import { useSession } from "./hooks/useSession";
import { useStatus } from "./hooks/useStatus";
import { useSessionTypes } from "./hooks/useSessionTypes";
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
  const { sessions, createSession, removeSession, loadSessions } = useSession();
  const sessionIds = useMemo(() => sessions.map((s) => s.id), [sessions]);
  useStatus(sessionIds);
  const { sessionTypes, updateType, createType, deleteType } = useSessionTypes();

  const activeSessions = useMemo(
    () => sessions.filter((s) => !s.parked && !s.parent_id),
    [sessions],
  );
  const parkedSessions = useMemo(
    () => sessions.filter((s) => s.parked),
    [sessions],
  );
  const companionMap = useMemo(() => {
    const map: Record<string, typeof sessions> = {};
    for (const s of sessions) {
      if (s.parent_id) {
        (map[s.parent_id] ??= []).push(s);
      }
    }
    return map;
  }, [sessions]);

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
      session_type?: string;
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
        // Cascade kill companions
        const companions = companionMap[id] ?? [];
        for (const c of companions) {
          await invoke("kill_pty_session", { id: c.id }).catch(() => {});
          spawningRef.current.delete(c.id);
        }
        setSpawnedIds((prev) => prev.filter((s) => s !== id && !companions.some((c) => c.id === s)));

        await invoke("kill_pty_session", { id });
        spawningRef.current.delete(id);
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      } catch (err) {
        console.error("Failed to kill session:", err);
      }
    },
    [activeSessionId, companionMap],
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

        // Cascade kill + remove companions
        const companions = companionMap[id] ?? [];
        for (const c of companions) {
          await invoke("kill_pty_session", { id: c.id }).catch(() => {});
          spawningRef.current.delete(c.id);
          await removeSession(c.id).catch(() => {});
        }
        setSpawnedIds((prev) => prev.filter((s) => s !== id && !companions.some((c) => c.id === s)));

        await invoke("kill_pty_session", { id }).catch(() => {});
        spawningRef.current.delete(id);
        await removeSession(id);
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      } catch (err) {
        console.error("Failed to remove session:", err);
      }
    },
    [activeSessionId, removeSession, sessions, companionMap],
  );

  const handleParkSession = useCallback(
    async (id: string) => {
      try {
        await invoke("park_session", { id });
        await loadSessions();
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      } catch (err) {
        console.error("Failed to park session:", err);
      }
    },
    [activeSessionId, loadSessions],
  );

  const handleUnparkSession = useCallback(
    async (id: string) => {
      try {
        await invoke("unpark_session", { id });
        await loadSessions();
        await handleSelectSession(id);
      } catch (err) {
        console.error("Failed to unpark session:", err);
      }
    },
    [loadSessions, handleSelectSession],
  );

  const handleAddCompanion = useCallback(async (parentId: string) => {
    try {
      const companion = await invoke<Session>("create_companion", { parentId });
      await loadSessions();
      await invoke("spawn_pty_session", { id: companion.id, rows: null, cols: null });
      setSpawnedIds((prev) => [...prev, companion.id]);
    } catch (err) {
      console.error("Failed to create companion:", err);
    }
  }, [loadSessions]);

  const handleRemoveCompanion = useCallback(async (id: string) => {
    try {
      await invoke("kill_pty_session", { id }).catch(() => {});
      spawningRef.current.delete(id);
      setSpawnedIds((prev) => prev.filter((s) => s !== id));
      await removeSession(id);
    } catch (err) {
      console.error("Failed to remove companion:", err);
    }
  }, [removeSession]);

  // Auto-spawn companion PTYs when a session is opened
  useEffect(() => {
    if (!activeSessionId) return;
    const companions = sessions.filter((s) => s.parent_id === activeSessionId);
    for (const c of companions) {
      if (!spawningRef.current.has(c.id)) {
        spawningRef.current.add(c.id);
        invoke("spawn_pty_session", { id: c.id, rows: null, cols: null })
          .then(() => {
            setSpawnedIds((prev) => (prev.includes(c.id) ? prev : [...prev, c.id]));
          })
          .catch(() => {
            spawningRef.current.delete(c.id);
          });
      }
    }
  }, [activeSessionId, sessions]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeSessionId) return;

      if (e.metaKey && e.key === "n") {
        e.preventDefault();
        setShowNewSession(true);
      }

      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < activeSessions.length) {
          handleSelectSession(activeSessions[idx].id);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSessionId, activeSessions, handleSelectSession]);

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
          label: sessions.find((s) => s.id === contextMenu.id)?.parked
            ? "Unpark"
            : "Park",
          onClick: () => {
            const s = sessions.find((s) => s.id === contextMenu.id);
            if (s?.parked) {
              handleUnparkSession(contextMenu.id);
            } else {
              handleParkSession(contextMenu.id);
            }
          },
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

  const companionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [parentId, companions] of Object.entries(companionMap)) {
      counts[parentId] = companions.length;
    }
    return counts;
  }, [companionMap]);

  const typeMap = useMemo(() => {
    const map: Record<string, typeof sessionTypes[0]> = {};
    for (const t of sessionTypes) {
      map[t.id] = t;
    }
    return map;
  }, [sessionTypes]);

  return (
    <>
      <ShiftingGradient sessionStatuses={sessions.map((s) => s.status)} />
      <HomeView
        sessions={activeSessions}
        onNewSession={() => setShowNewSession(true)}
        onSelectSession={handleSelectSession}
        onSessionContextMenu={handleContextMenu}
        onOpenSettings={() => setShowSettings(true)}
        sessionTypeMap={typeMap}
        companionCounts={companionCounts}
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
          });
        }}
        sessionTypes={sessionTypes}
      />
      <SettingsView
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        sessionTypes={sessionTypes}
        onUpdateType={updateType}
        onCreateType={createType}
        onDeleteType={deleteType}
      />
      {spawnedIds.map((id) => {
        const session = sessions.find((s) => s.id === id);
        if (!session || session.parent_id) return null;
        return (
          <TerminalOverlay
            key={id}
            session={session}
            companions={companionMap[id] ?? []}
            isOpen={activeSessionId === id}
            onClose={() => setActiveSessionId(null)}
            onEnd={handleEndSession}
            onRestart={handleRestartSession}
            onRemove={handleRemoveSession}
            onAddCompanion={handleAddCompanion}
            onRemoveCompanion={handleRemoveCompanion}
          />
        );
      })}
      <SessionDock
        sessions={parkedSessions}
        onUnpark={handleUnparkSession}
        sessionTypeMap={typeMap}
      />
      <AttentionIndicator
        sessions={sessions}
        onSelect={handleSelectSession}
      />
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
