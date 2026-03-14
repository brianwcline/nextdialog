import { motion } from "framer-motion";
import type { Session } from "../lib/types";
import { SessionCard } from "./SessionCard";

interface HomeViewProps {
  sessions: Session[];
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  onOpenSettings: () => void;
}

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="text-5xl opacity-30"
      >
        ◇
      </motion.div>
      <p className="text-slate-500 text-center max-w-xs">
        No sessions yet. Create one to start a Claude Code conversation.
      </p>
      <button
        onClick={onNewSession}
        className="mt-2 px-5 py-2.5 rounded-full bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors shadow-md"
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
}: HomeViewProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 pt-5 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">
            NextDialog
          </h1>
          {sessions.length > 0 && (
            <span className="text-xs bg-white/30 backdrop-blur-sm rounded-full px-2.5 py-0.5 text-slate-600 font-medium">
              {sessions.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-lg text-slate-500 hover:bg-white/30 transition-colors text-sm"
            title="Settings"
          >
            ⚙
          </button>
          {sessions.length > 0 && (
            <button
              onClick={onNewSession}
              className="px-4 py-2 rounded-full bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors shadow-md"
            >
              + New Session
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      {sessions.length === 0 ? (
        <EmptyState onNewSession={onNewSession} />
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="flex flex-wrap gap-5 justify-center">
            {sessions.map((session, i) => (
              <SessionCard
                key={session.id}
                session={session}
                index={i}
                onClick={() => onSelectSession(session.id)}
                onContextMenu={(e) => onSessionContextMenu(session.id, e)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
