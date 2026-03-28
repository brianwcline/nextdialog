import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import type { Session, SessionType, TimelineEntry } from "../lib/types";
import { StatusDot } from "./StatusDot";
import { TokenBurnBar } from "./TokenBurnBar";
import { SessionTypeIcon } from "./SessionTypeIcon";

interface SessionCardProps {
  session: Session;
  index: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  sessionType?: SessionType;
}

const statusLabels: Record<string, string> = {
  ready: "Ready",
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
  sessionType,
}: SessionCardProps) {
  const [contextUsage, setContextUsage] = useState<number | null>(null);
  const [annotation, setAnnotation] = useState<string | null>(null);
  const [lastTimelineEvent, setLastTimelineEvent] = useState<string | null>(null);

  const brandColor = sessionType?.color;

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

  // Listen for timeline events (for "last action" preview)
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    listen<TimelineEntry>(`session-timeline-${session.id}`, (event) => {
      setLastTimelineEvent(event.payload.summary);
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

  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
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

      {/* Brand icon — top right */}
      {sessionType && (
        <span className="absolute top-6 right-7 opacity-30 group-hover:opacity-50 transition-opacity">
          <SessionTypeIcon
            id={sessionType.id}
            icon={sessionType.icon}
            color={brandColor}
            className="!w-5 !h-5"
          />
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

      {/* Hook notification */}
      {session.hookNotification && (
        <p className="text-xs text-amber-600/70 mt-1.5 line-clamp-2 leading-snug">
          {session.hookNotification}
        </p>
      )}

      {/* Last timeline event */}
      {lastTimelineEvent && (
        <p className="text-[11px] text-slate-400/70 font-mono truncate mt-1">
          {lastTimelineEvent}
        </p>
      )}

      {/* Token burn bar — pushed to bottom */}
      <div className="mt-auto pt-4">
        {contextUsage !== null && <TokenBurnBar usage={contextUsage} />}
      </div>
    </motion.button>
  );
}
