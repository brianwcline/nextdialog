import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { listen } from "@tauri-apps/api/event";
import type { Session, SessionSize, SessionType, TimelineEntry } from "../lib/types";
import { StatusDot } from "./StatusDot";
import { TokenBurnBar } from "./TokenBurnBar";
import { SessionTypeIcon } from "./SessionTypeIcon";

interface SessionCardProps {
  session: Session;
  index: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  sessionType?: SessionType;
  /**
   * Size category driven by the smart layout engine. When undefined, the card
   * renders with the legacy fixed `max-w-[400px] h-[200px]` sizing used by the
   * uniform grid. Phase 1 adds variant content rendering based on this prop.
   */
  size?: SessionSize;
  /**
   * Whether this card is currently the focused card in the smart layout.
   * Mood themes (Phase 3) style focused cards dramatically differently.
   */
  isFocused?: boolean;
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
  size,
  isFocused = false,
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

  // When `size` is undefined, keep the legacy uniform-grid sizing.
  // SmartGrid (Phase 1) passes a size and takes over dimensions externally.
  const legacySizing = size === undefined;

  // Size-aware content shaping:
  //   minimal — single compact row; no path, no footer
  //   small   — header + title + path; no footer
  //   medium  — header + title + path + compact footer (timestamp only)
  //   large   — full current layout
  //   legacy  — behaves like "large"
  const effectiveSize = size ?? "large";
  const showPath = effectiveSize !== "minimal";
  const showFooter = effectiveSize === "medium" || effectiveSize === "large" || legacySizing;
  const showTimelinePreview = effectiveSize === "large" || legacySizing;
  const showTokenBar = effectiveSize === "large" || legacySizing;
  const showHookNotification =
    (effectiveSize === "large" || effectiveSize === "medium" || legacySizing) &&
    Boolean(session.hookNotification);
  // Prompt subtitle only shows on the hero card — dock cards stay clean.
  const showPromptSubtitle =
    (effectiveSize === "large" || legacySizing) && Boolean(session.current_prompt);

  // Title size scales with card size. Minimal cards use a single compact row.
  const titleClass =
    effectiveSize === "minimal"
      ? "text-sm font-medium tracking-tight text-slate-800 truncate"
      : effectiveSize === "small"
      ? "text-base font-medium tracking-tight text-slate-800 group-hover:text-slate-900 transition-colors line-clamp-1 leading-snug"
      : "text-lg font-medium tracking-tight text-slate-800 group-hover:text-slate-900 transition-colors line-clamp-1 leading-snug";

  const cardPadding = effectiveSize === "minimal" ? "px-4 py-3" : "px-5 py-4";

  const rootClasses = [
    "card",
    isFocused ? "focused" : "",
    "relative rounded-2xl glass-card cursor-pointer text-left",
    cardPadding,
    "flex flex-col overflow-hidden group",
    legacySizing ? "w-full max-w-[400px] h-[200px]" : "w-full h-full",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.button
      data-status={session.status}
      data-size={size ?? "legacy"}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      whileHover={effectiveSize === "minimal" ? { scale: 1.01 } : { y: -3, scale: 1.015 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={rootClasses}
    >
      {effectiveSize === "minimal" ? (
        /* ── Minimal: single compact row ── */
        <div className="card-body flex w-full items-center gap-2.5 h-full min-w-0">
          <StatusDot status={session.status} size={8} />
          <h3 className={`card-name ${titleClass} flex-1 min-w-0`}>{session.name}</h3>
          {session.tuning && (
            <span className="badge px-1 py-0.5 rounded text-[8px] bg-violet-100 text-violet-500 font-medium flex-shrink-0">
              T
            </span>
          )}
          {sessionType && (
            <span className="agent-icon flex items-center justify-center w-5 h-5 rounded bg-slate-100/60 flex-shrink-0">
              <SessionTypeIcon
                id={sessionType.id}
                icon={sessionType.icon}
                color={brandColor}
                className="!w-[12px] !h-[12px]"
              />
            </span>
          )}
        </div>
      ) : (
        <>
          {/* ── Top: Status row ── */}
          <div className="card-header flex w-full items-center justify-between">
            <div className="status-row flex items-center gap-2 min-w-0">
              <StatusDot status={session.status} size={9} />
              <span className="status-label text-[11px] font-medium text-slate-400 group-hover:text-slate-500 transition-colors truncate">
                {annotation && annotation !== "__analyzing__"
                  ? annotation
                  : statusLabels[session.status] ?? session.status}
              </span>
              {session.tuning && (
                <span className="badge px-1.5 py-0.5 rounded text-[9px] bg-violet-100 text-violet-500 font-medium flex-shrink-0">
                  Tuned
                </span>
              )}
            </div>
            {sessionType && (
              <span className="agent-icon flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100/60 group-hover:bg-slate-100/80 transition-all flex-shrink-0">
                <SessionTypeIcon
                  id={sessionType.id}
                  icon={sessionType.icon}
                  color={brandColor}
                  className="!w-[18px] !h-[18px]"
                />
              </span>
            )}
          </div>

          {/* ── Middle: Identity (grows to fill) ── */}
          <div className="card-body flex-1 flex flex-col justify-center min-h-0">
            <h3 className={`card-name ${titleClass}`}>{session.name}</h3>
            {showPath && (
              <p className="card-path text-xs text-slate-400 font-mono truncate mt-0.5 group-hover:text-slate-500 transition-colors">
                {session.working_directory.replace(/^\/Users\/[^/]+/, "~")}
              </p>
            )}
            {showPromptSubtitle && (
              <p className="card-subtitle text-sm text-slate-500/90 mt-2 line-clamp-2 leading-snug">
                {session.current_prompt}
              </p>
            )}
            {showHookNotification && (
              <p className="card-notification text-[11px] text-amber-600/70 mt-1 line-clamp-1 leading-snug">
                {session.hookNotification}
              </p>
            )}
          </div>

          {/* ── Bottom: Activity footer (pinned, omitted on small) ── */}
          {showFooter && (
            <div className="card-footer flex flex-col gap-1.5 pt-2 border-t border-slate-200/30">
              <div className="flex items-baseline gap-2 min-h-[16px]">
                {showTimelinePreview && lastTimelineEvent ? (
                  <p className="card-preview text-[11px] text-slate-400/70 font-mono truncate flex-1 min-w-0">
                    {lastTimelineEvent}
                  </p>
                ) : (
                  <span className="flex-1" />
                )}
                <span className="card-time text-[10px] text-slate-400/50 whitespace-nowrap flex-shrink-0">
                  {relativeTime(session.last_active)}
                </span>
              </div>
              {showTokenBar && contextUsage !== null && <TokenBurnBar usage={contextUsage} />}
            </div>
          )}
        </>
      )}
    </motion.button>
  );
}
