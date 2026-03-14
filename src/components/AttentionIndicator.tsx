import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Session } from "../lib/types";
import { StatusDot } from "./StatusDot";

interface AttentionIndicatorProps {
  sessions: Session[];
  onSelect: (id: string) => void;
}

export function AttentionIndicator({
  sessions,
  onSelect,
}: AttentionIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const needsAttention = sessions.filter(
    (s) => s.status === "waiting" || s.status === "error",
  );

  if (needsAttention.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full right-0 mb-2 min-w-[220px] rounded-xl bg-white/90 backdrop-blur-xl border border-white/40 shadow-2xl py-2 overflow-hidden"
          >
            {needsAttention.map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  setIsOpen(false);
                  onSelect(session.id);
                }}
                className="w-full text-left px-4 py-2 hover:bg-slate-100/80 transition-colors flex items-center gap-2.5"
              >
                <StatusDot status={session.status} size={6} />
                <span className="text-sm text-slate-700 truncate">
                  {session.name}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setIsOpen((v) => !v)}
        className="px-4 py-2 rounded-full bg-amber-500/90 text-white text-sm font-medium shadow-lg hover:bg-amber-500 transition-colors backdrop-blur-sm"
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        {needsAttention.length} session{needsAttention.length !== 1 ? "s" : ""}{" "}
        need{needsAttention.length === 1 ? "s" : ""} you
      </motion.button>
    </div>
  );
}
