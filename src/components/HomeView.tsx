import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import type { Session, SessionType } from "../lib/types";
import { SessionCard } from "./SessionCard";
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
  const renderCards = (cards: Session[], startIndex: number) =>
    cards.map((session, i) => (
      <SessionCard
        key={session.id}
        session={session}
        index={startIndex + i}
        onClick={() => onSelectSession(session.id)}
        onContextMenu={(e) => onSessionContextMenu(session.id, e)}
        sessionType={sessionTypeMap[session.session_type]}
      />
    ));

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
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-8 pb-20">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: isTerminalOpen ? 0 : 1, y: isTerminalOpen ? -20 : 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl w-full justify-items-center"
          >
            {renderCards(sessions, 0)}
          </motion.div>
        </div>
      )}

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
