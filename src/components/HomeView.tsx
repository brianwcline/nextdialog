import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Session, SessionType } from "../lib/types";
import { SmartGrid } from "./SmartGrid";
import { StackOverlay } from "./StackOverlay";
import { useSessionContext } from "../context/SessionContext";
import { useSessionGroups } from "../hooks/useSessionGroups";
import { buildStacks, stackId } from "../lib/stacks";
import { trackEvent } from "../lib/telemetry";
import { MoodControls } from "./MoodControls";
import { useUpdateCheck } from "../hooks/useUpdateCheck";

interface HomeViewProps {
  sessions: Session[];
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
  sessionTypeMap?: Record<string, SessionType>;
  activeSessionId?: string | null;
}

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-slate-500 text-center max-w-xs">
        No sessions yet. Create one to get started.
      </p>
      <button
        onClick={onNewSession}
        className="mt-2 px-5 py-2.5 rounded-full bg-white/20 backdrop-blur-md border border-white/20 text-slate-700 text-sm font-medium hover:bg-white/40 transition-colors shadow-md"
      >
        New Session
      </button>
    </div>
  );
}

export function HomeView({
  sessions,
  onNewSession,
  onSelectSession,
  onSessionContextMenu,
  onOpenSettings,
  onOpenFeedback,
  sessionTypeMap = {},
  activeSessionId = null,
}: HomeViewProps) {
  const { update } = useUpdateCheck();
  const isTerminalOpen = activeSessionId !== null;
  const { focusedSessionId, setFocusedSessionId } = useSessionContext();

  // Escape unfocuses. Registered here once rather than per grid, since the
  // grouped view stacks several. When the terminal is open, TerminalOverlay
  // owns Escape (it stops propagation).
  useEffect(() => {
    if (isTerminalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusedSessionId !== null) {
        setFocusedSessionId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isTerminalOpen, focusedSessionId, setFocusedSessionId]);

  // ── Stacks (iOS-folder style groups) ──
  const { setSessionGroup, createStack, renameStack } = useSessionGroups();
  const [openStack, setOpenStack] = useState<{
    name: string;
    originRect: DOMRect;
    autoEditTitle: boolean;
  } | null>(null);
  // Stays set until the close animation finishes, so the tile doesn't
  // reappear while the panel is still flying back into it.
  const [hiddenStackName, setHiddenStackName] = useState<string | null>(null);

  // Members only; ordering here doesn't need timeline counts.
  const stacksByName = useMemo(
    () => Object.fromEntries(buildStacks(sessions, {}).stacks.map((st) => [st.name, st])),
    [sessions],
  );
  const openStackInfo = openStack ? stacksByName[openStack.name] : undefined;

  // The last card left the stack (or it was renamed away): close it.
  useEffect(() => {
    if (openStack && !openStackInfo) setOpenStack(null);
  }, [openStack, openStackInfo]);

  const handleOpenStack = useCallback(
    (name: string, rect: DOMRect) => {
      setOpenStack({ name, originRect: rect, autoEditTitle: false });
      setHiddenStackName(name);
      trackEvent("stack.opened", "session-groups", {
        members: stacksByName[name]?.members.length ?? 0,
      });
    },
    [stacksByName],
  );

  const handleDropOnSession = useCallback(
    async (sourceId: string, targetId: string, targetRect: DOMRect) => {
      const name = await createStack(sourceId, targetId);
      if (!name) return;
      // Open the new stack with its name selected, like a fresh iOS folder.
      setOpenStack({ name, originRect: targetRect, autoEditTitle: true });
      setHiddenStackName(name);
    },
    [createStack],
  );

  const handleDropOnStack = useCallback(
    (sourceId: string, stackName: string) => {
      void setSessionGroup(sourceId, stackName, "drag");
    },
    [setSessionGroup],
  );

  const handleRenameStack = useCallback(
    async (to: string) => {
      if (!openStack) return;
      const stored = await renameStack(openStack.name, to);
      if (!stored) return;
      setOpenStack((current) => (current ? { ...current, name: stored } : current));
      setHiddenStackName(stored);
    },
    [openStack, renameStack],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Top bar — draggable region for window movement */}
      <motion.header
        data-tauri-drag-region
        className="relative flex items-center justify-center px-6 pt-5 pb-3"
        animate={{ opacity: isTerminalOpen ? 0 : 1 }}
        transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] }}
      >
        {/* Center — intentionally empty for clean canvas */}
        <div />

        {/* Right — actions (absolute so they don't shift the center) */}
        <div className="absolute right-6 flex items-center gap-1">
          {update && (
            <button
              onClick={() => invoke("plugin:opener|open_url", { url: update.downloadUrl }).catch(() => {})}
              className="px-2.5 py-1.5 rounded-lg text-xs text-indigo-500 hover:bg-indigo-50/50 hover:text-indigo-600 transition-colors"
              title={`Update available: v${update.latestVersion} (current: v${update.currentVersion})`}
            >
              v{update.latestVersion} available
            </button>
          )}
          <MoodControls />
          <button
            onClick={onOpenFeedback}
            className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-white/40 hover:text-slate-700 transition-colors"
            title="Send Feedback"
          >
            Feedback
          </button>
          <button
            onClick={onOpenSettings}
            className="px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-white/40 hover:text-slate-700 transition-colors"
            title="Settings"
          >
            Settings
          </button>
        </div>
      </motion.header>

      {/* Content */}
      {sessions.length === 0 ? (
        <EmptyState onNewSession={onNewSession} />
      ) : (
        <div className="flex-1 overflow-y-auto flex items-start justify-center p-8 pb-20">
          <SmartGrid
            sessions={sessions}
            isTerminalOpen={isTerminalOpen}
            onOpenSession={onSelectSession}
            onSessionContextMenu={onSessionContextMenu}
            sessionTypeMap={sessionTypeMap}
            openStackName={hiddenStackName}
            onOpenStack={handleOpenStack}
            onDropOnSession={(sourceId, targetId, rect) => void handleDropOnSession(sourceId, targetId, rect)}
            onDropOnStack={handleDropOnStack}
          />
        </div>
      )}

      <AnimatePresence onExitComplete={() => setHiddenStackName(null)}>
        {openStack && openStackInfo && (
          <StackOverlay
            // Stable key: a rename must not remount (and replay) the panel.
            key="stack-overlay"
            stack={openStackInfo}
            originRect={openStack.originRect}
            originDropId={stackId(openStack.name)}
            autoEditTitle={openStack.autoEditTitle}
            sessionTypeMap={sessionTypeMap}
            onClose={() => setOpenStack(null)}
            onOpenSession={(id) => {
              setOpenStack(null);
              onSelectSession(id);
            }}
            onSessionContextMenu={onSessionContextMenu}
            onRename={(to) => void handleRenameStack(to)}
            onRemoveMember={(id) => void setSessionGroup(id, null, "drag")}
          />
        )}
      </AnimatePresence>

      {/* Floating action button */}
      {sessions.length > 0 && !isTerminalOpen && (
        <button
          onClick={onNewSession}
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-white/40 backdrop-blur-xl border border-white/50 shadow-lg hover:bg-white/55 hover:scale-105 transition-all duration-300 flex items-center justify-center text-slate-700 text-xl font-light"
          title="New Session"
        >
          +
        </button>
      )}
    </div>
  );
}
