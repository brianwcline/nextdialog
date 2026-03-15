import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session, SessionType } from "../lib/types";
import { StatusDot } from "./StatusDot";
import { TokenBurnBar } from "./TokenBurnBar";
import { SessionTypeIcon } from "./SessionTypeIcon";

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
  starting: "Starting...",
  idle: "Idle",
  working: "Working...",
  planning: "Planning...",
  waiting: "Waiting for input",
  error: "Error",
};

export function SessionCard({
  session,
  index,
  onClick,
  onContextMenu,
  sessionType,
  companionCount = 0,
}: SessionCardProps) {
  const accentColor = sessionType?.color ?? "#6366f1";
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

  const renderStatusLabel = () => {
    if (session.status === "working") {
      return <span className="text-xs text-slate-600 min-w-0">Working...</span>;
    }
    if (annotation === "__analyzing__") {
      return (
        <span className="text-[11px] text-slate-500 animate-pulse min-w-0">
          Analyzing...
        </span>
      );
    }
    if (annotation) {
      return (
        <span className="text-[11px] text-slate-600 truncate min-w-0" title={annotation}>
          {annotation}
        </span>
      );
    }
    return (
      <span className="text-xs text-slate-600 min-w-0">
        {statusLabels[session.status] ?? session.status}
      </span>
    );
  };

  return (
    <div className="relative" onMouseLeave={handleMouseLeave}>
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.06, duration: 0.3 }}
        whileHover={{ y: -3 }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={handleMouseEnter}
        className="w-[168px] h-[140px] rounded-2xl backdrop-blur-xl bg-white/10 border border-white/15 ring-1 ring-white/10 shadow-sm hover:shadow-md transition-shadow cursor-pointer text-left p-4 flex flex-col justify-between overflow-hidden"
        style={{
          borderColor: accentColor ? `${accentColor}30` : undefined,
        }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 min-w-0">
            {sessionType && (
              <span className="text-base shrink-0" style={{ color: accentColor }}>
                <SessionTypeIcon icon={sessionType.icon} color={accentColor} />
              </span>
            )}
            <h3 className="text-sm font-semibold text-slate-800 truncate">
              {session.name}
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 truncate font-mono">
            {session.working_directory.replace(/^\/Users\/[^/]+/, "~")}
          </p>
        </div>

        {/* Token burn bar */}
        {contextUsage !== null && <TokenBurnBar usage={contextUsage} />}

        <div className="flex items-center gap-2 min-w-0">
          <StatusDot status={session.status} />
          {renderStatusLabel()}
        </div>
        {companionCount > 0 && (
          <span className="absolute bottom-2 right-2 text-[10px] bg-slate-600/40 text-slate-300 rounded-full px-1.5 py-0.5 font-mono">
            +{companionCount}
          </span>
        )}
      </motion.button>

      {/* Hover preview tooltip */}
      <AnimatePresence>
        {showPreview && preview && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
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
