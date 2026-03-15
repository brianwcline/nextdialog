import { motion } from "framer-motion";
import type { Session, SessionType } from "../lib/types";
import { SessionCard } from "./SessionCard";

interface HomeViewProps {
  sessions: Session[];
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  onOpenSettings: () => void;
  sessionTypeMap?: Record<string, SessionType>;
  companionCounts?: Record<string, number>;
}

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
      <motion.img
        src="/icons/nextdialog.png"
        alt="NextDialog"
        className="w-14 h-14 opacity-20"
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
      <p className="text-slate-500 text-center max-w-xs">
        No sessions yet. Create one to start a Claude Code conversation.
      </p>
      <button
        onClick={onNewSession}
        className="mt-2 px-5 py-2.5 rounded-full bg-white/20 backdrop-blur-md border border-white/20 text-slate-700 text-sm font-medium hover:bg-white/30 transition-colors shadow-md"
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
  sessionTypeMap = {},
  companionCounts = {},
}: HomeViewProps) {
  const renderCards = (cards: Session[], startIndex: number) =>
    cards.map((session, i) => (
      <SessionCard
        key={session.id}
        session={session}
        index={startIndex + i}
        onClick={() => onSelectSession(session.id)}
        onContextMenu={(e) => onSessionContextMenu(session.id, e)}
        sessionType={sessionTypeMap[session.session_type]}
        companionCount={companionCounts[session.id] ?? 0}
      />
    ));

  return (
    <div className="flex flex-col h-full">
      {/* Top bar — draggable region for window movement */}
      <header
        data-tauri-drag-region
        className="flex items-center justify-between pl-20 pr-6 pt-5 pb-3"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/icons/nextdialog.png" alt="NextDialog" className="w-6 h-6 pointer-events-none" />
            <h1 className="text-xl font-bold text-slate-800 tracking-tight select-none">
              NextDialog
            </h1>
          </div>
          {sessions.length > 0 && (
            <span className="text-xs bg-white/30 backdrop-blur-sm rounded-full px-2.5 py-0.5 text-slate-600 font-medium select-none">
              {sessions.length}
            </span>
          )}
        </div>
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg text-slate-500 hover:bg-white/30 transition-colors text-sm"
          title="Settings"
        >
          ⚙
        </button>
      </header>

      {/* Content */}
      {sessions.length === 0 ? (
        <EmptyState onNewSession={onNewSession} />
      ) : (
        <div className="flex-1 overflow-y-auto flex items-center justify-center px-8">
          <div className="flex flex-wrap gap-4 justify-center content-center max-w-3xl">
            {renderCards(sessions, 0)}
          </div>
        </div>
      )}

      {/* Floating action button */}
      {sessions.length > 0 && (
        <button
          onClick={onNewSession}
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-white/20 backdrop-blur-md border border-white/20 shadow-lg hover:bg-white/30 transition-colors flex items-center justify-center text-slate-700 text-xl font-light"
          title="New Session"
        >
          +
        </button>
      )}
    </div>
  );
}
