import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session, SessionType } from "../lib/types";
import { StatusDot } from "./StatusDot";
import { TokenBurnBar } from "./TokenBurnBar";
interface SessionCardProps {
  session: Session;
  index: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  sessionType?: SessionType;
  companionCount?: number;
}

const statusLabels: Record<string, string> = {
  stopped: "Stopped",
  starting: "Starting",
  idle: "Idle",
  working: "Working",
  planning: "Planning",
  waiting: "Waiting for input",
  error: "Error",
};

export function SessionCard({
  session,
  index,
  onClick,
  onContextMenu,
  companionCount = 0,
}: SessionCardProps) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextUsage, setContextUsage] = useState<number | null>(null);
  const [annotation, setAnnotation] = useState<string | null>(null);

  // Listen for context usage events
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    listen<number>(`session-context-${session.id}`, (event) => {
      setContextUsage(event.payload);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [session.id]);

  // Listen for intelligence annotation events
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    listen<string>(`session-annotation-${session.id}`, (event) => {
      setAnnotation(event.payload || null);
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [session.id]);

  // Clear annotation when session enters working status
  useEffect(() => {
    if (session.status === "working") {
      setAnnotation(null);
    }
  }, [session.status]);

  const handleMouseEnter = useCallback(() => {
    hoverTimer.current = setTimeout(async () => {
      try {
        const lines = await invoke<string[]>("get_session_preview", {
          id: session.id,
        });
        if (lines.length > 0) {
          setPreview(lines);
          setShowPreview(true);
        }
      } catch {
        // Session may not be spawned yet
      }
    }, 150);
  }, [session.id]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setShowPreview(false);
  }, []);

  return (
    <div className="relative" onMouseLeave={handleMouseLeave}>
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.08, duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
        whileHover={{ y: -4, scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={handleMouseEnter}
        className="relative w-[280px] h-[280px] rounded-[2rem] glass-card cursor-pointer text-left px-7 py-7 flex flex-col overflow-hidden group"
      >
        {/* Status dot — top left */}
        <div className="flex items-center gap-2 mb-4">
          <StatusDot status={session.status} size={10} />
          <span className="text-xs font-medium text-slate-400 group-hover:text-slate-500 transition-colors">
            {annotation && annotation !== "__analyzing__"
              ? annotation
              : statusLabels[session.status] ?? session.status}
          </span>
        </div>

        {/* Companion count — top right badge */}
        {companionCount > 0 && (
          <span className="absolute top-7 right-7 bg-white/40 backdrop-blur-md px-2.5 py-0.5 rounded-full text-[11px] font-medium text-slate-500 border border-white/30">
            +{companionCount}
          </span>
        )}

        {/* Title */}
        <h3 className="text-2xl font-medium tracking-tight text-slate-800 group-hover:text-slate-900 transition-colors line-clamp-2 leading-tight mb-2">
          {session.name}
        </h3>

        {/* Path */}
        <p className="text-sm text-slate-400 font-mono truncate group-hover:text-slate-500 transition-colors">
          {session.working_directory.replace(/^\/Users\/[^/]+/, "~")}
        </p>

        {/* Token burn bar — pushed to bottom */}
        <div className="mt-auto pt-4">
          {contextUsage !== null && <TokenBurnBar usage={contextUsage} />}
        </div>
      </motion.button>

      {/* Hover preview tooltip */}
      <AnimatePresence>
        {showPreview && preview && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
            className="absolute left-0 right-0 top-full mt-2 z-30 rounded-lg bg-slate-900/90 backdrop-blur-md border border-slate-700/50 shadow-xl p-3 pointer-events-none"
          >
            <div className="space-y-0.5 font-mono text-[11px] text-slate-300 leading-relaxed">
              {preview.map((line, i) => (
                <div key={i} className="truncate">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
