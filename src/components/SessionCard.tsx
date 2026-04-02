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

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

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
  const [, setTick] = useState(0);

  const brandColor = sessionType?.color;

  // Refresh relative time every 30s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

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
      whileHover={{ y: -3, scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="relative w-full max-w-[400px] h-[200px] rounded-2xl glass-card cursor-pointer text-left px-5 py-4 flex flex-col overflow-hidden group"
    >
      {/* ── Top: Status row ── */}
      <div className="flex items-center gap-2">
        <StatusDot status={session.status} size={9} />
        <span className="text-[11px] font-medium text-slate-400 group-hover:text-slate-500 transition-colors">
          {annotation && annotation !== "__analyzing__"
            ? annotation
            : statusLabels[session.status] ?? session.status}
        </span>
        {session.tuning && (
          <span className="px-1.5 py-0.5 rounded text-[9px] bg-violet-100 text-violet-500 font-medium">
            Tuned
          </span>
        )}
        {sessionType && (
          <span className="ml-auto opacity-30 group-hover:opacity-50 transition-opacity">
            <SessionTypeIcon
              id={sessionType.id}
              icon={sessionType.icon}
              color={brandColor}
              className="!w-4 !h-4"
            />
          </span>
        )}
      </div>

      {/* ── Middle: Identity (grows to fill) ── */}
      <div className="flex-1 flex flex-col justify-center min-h-0">
        <h3 className="text-lg font-medium tracking-tight text-slate-800 group-hover:text-slate-900 transition-colors line-clamp-1 leading-snug">
          {session.name}
        </h3>
        <p className="text-xs text-slate-400 font-mono truncate mt-0.5 group-hover:text-slate-500 transition-colors">
          {session.working_directory.replace(/^\/Users\/[^/]+/, "~")}
        </p>
        {session.hookNotification && (
          <p className="text-[11px] text-amber-600/70 mt-1 line-clamp-1 leading-snug">
            {session.hookNotification}
          </p>
        )}
      </div>

      {/* ── Bottom: Activity footer (pinned) ── */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-200/30">
        <div className="flex items-baseline gap-2 min-h-[16px]">
          {lastTimelineEvent ? (
            <p className="text-[11px] text-slate-400/70 font-mono truncate flex-1 min-w-0">
              {lastTimelineEvent}
            </p>
          ) : (
            <span className="flex-1" />
          )}
          <span className="text-[10px] text-slate-400/50 whitespace-nowrap flex-shrink-0">
            {relativeTime(session.last_active)}
          </span>
        </div>
        {contextUsage !== null && <TokenBurnBar usage={contextUsage} />}
      </div>
    </motion.button>
  );
}
