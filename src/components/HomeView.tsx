import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import type { Session, SessionType } from "../lib/types";
import { SessionCard } from "./SessionCard";
import {
  groupByDirectory,
  abbreviateDirectory,
} from "../lib/groupSessions";

interface HomeViewProps {
  sessions: Session[];
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  onOpenSettings: () => void;
  sessionTypeMap?: Record<string, SessionType>;
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
  sessionTypeMap = {},
}: HomeViewProps) {
  const [grouped, setGrouped] = useState(() => {
    try {
      return localStorage.getItem("nextdialog:grouped") === "true";
    } catch {
      return false;
    }
  });

  const toggleGrouped = () => {
    const next = !grouped;
    setGrouped(next);
    try {
      localStorage.setItem("nextdialog:grouped", String(next));
    } catch {
      // ignore
    }
  };

  const groups = useMemo(
    () => (grouped ? groupByDirectory(sessions) : null),
    [grouped, sessions],
  );

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
          {sessions.length > 1 && (
            <button
              onClick={toggleGrouped}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                grouped
                  ? "bg-indigo-100/60 text-indigo-600"
                  : "text-slate-500 hover:bg-white/30"
              }`}
              title="Group by project"
            >
              {grouped ? "Grouped" : "Group"}
            </button>
          )}
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
          {groups ? (
            <div className="space-y-6">
              {groups.map((group) => {
                const showHeader = groups.length > 1;
                const startIdx = sessions.findIndex(
                  (s) => s.id === group.sessions[0]?.id,
                );
                return (
                  <div key={group.directory}>
                    {showHeader && (
                      <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3 font-mono">
                        {abbreviateDirectory(group.directory)}
                      </h3>
                    )}
                    <div className="flex flex-wrap gap-5">
                      {renderCards(group.sessions, startIdx)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-5 justify-center">
              {renderCards(sessions, 0)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
