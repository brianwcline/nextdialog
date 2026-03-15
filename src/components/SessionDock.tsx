import { motion, AnimatePresence } from "framer-motion";
import type { Session, SessionType } from "../lib/types";
import { StatusDot } from "./StatusDot";
import { SessionTypeIcon } from "./SessionTypeIcon";

interface SessionDockProps {
  sessions: Session[];
  onUnpark: (id: string) => void;
  sessionTypeMap?: Record<string, SessionType>;
}

export function SessionDock({
  sessions,
  onUnpark,
  sessionTypeMap = {},
}: SessionDockProps) {
  if (sessions.length === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30">
      <div className="flex items-center justify-center gap-2 px-6 py-3 bg-white/30 backdrop-blur-xl border-t border-white/40">
        <span className="text-xs text-slate-500 mr-2">Parked</span>
        <AnimatePresence>
          {sessions.map((session) => {
            const st = sessionTypeMap[session.session_type];
            return (
              <motion.button
                key={session.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] }}
                onClick={() => onUnpark(session.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/40 backdrop-blur-md border border-white/50 hover:bg-white/55 shadow-sm transition-all duration-300 text-sm"
                title={`Unpark ${session.name}`}
              >
                {st && (
                  <SessionTypeIcon icon={st.icon} color={st.color} />
                )}
                <span className="text-slate-700 truncate max-w-[100px]">
                  {session.name}
                </span>
                <StatusDot status={session.status} size={6} />
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
