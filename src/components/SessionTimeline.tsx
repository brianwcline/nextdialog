import { motion } from "framer-motion";
import { useTimelineEvents } from "../hooks/useTimelineEvents";
import type { GroupedTimelineEntry } from "../lib/types";

interface SessionTimelineProps {
  sessionId: string;
  isOpen: boolean;
  onDismiss: () => void;
}

const DOT_COLORS: Record<string, string> = {
  file_write: "bg-[#E8845C]",
  bash: "bg-[#5BA7A7]",
  tool: "bg-slate-400",
  notification: "bg-amber-400",
  status: "bg-slate-500",
  lifecycle: "bg-[#8B3A62]",
  compact: "bg-indigo-400",
};

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

function TimelineEntryRow({
  entry,
  isFirst,
}: {
  entry: GroupedTimelineEntry;
  isFirst: boolean;
}) {
  const dotColor = DOT_COLORS[entry.event_type] ?? "bg-slate-500";

  return (
    <motion.div
      initial={isFirst ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] }}
      className="flex items-start gap-4 px-6 py-3 hover:bg-white/[0.03] transition-colors"
    >
      {/* Dot + line */}
      <div className="flex flex-col items-center pt-1 shrink-0 w-3">
        <div className={`w-[8px] h-[8px] rounded-full ${dotColor}`} />
        <div className="w-px flex-1 bg-slate-700/40 min-h-[8px] mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 leading-relaxed">
          {entry.summary}
        </p>
        {entry.count > 1 && (
          <p className="text-[11px] text-slate-500 mt-0.5">
            {entry.count} events grouped
          </p>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[11px] text-slate-600 font-mono shrink-0 pt-0.5">
        {formatRelativeTime(entry.timestamp)}
      </span>
    </motion.div>
  );
}

export function SessionTimeline({
  sessionId,
  isOpen,
  onDismiss,
}: SessionTimelineProps) {
  const { entries, loading } = useTimelineEvents(sessionId, isOpen);

  // Reverse for newest-at-top
  const reversedEntries = [...entries].reverse();

  return (
    <div className="flex flex-col h-full bg-[#1E1E2E]/95 backdrop-blur-sm">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b border-white/[0.06] shrink-0"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Timeline
          </span>
          {entries.length > 0 && (
            <span className="text-[11px] text-slate-600">
              {entries.reduce((sum, e) => sum + e.count, 0)} events
            </span>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Timeline entries — scrollable, newest at top */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-slate-600">Loading timeline...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-600 text-center leading-relaxed">
              Events will appear here
              <br />
              as this session works.
            </p>
          </div>
        ) : (
          <div className="py-2">
            {reversedEntries.map((entry, i) => (
              <TimelineEntryRow
                key={entry.id}
                entry={entry}
                isFirst={i === 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom edge affordance */}
      <div className="h-px bg-gradient-to-r from-transparent via-slate-700/30 to-transparent" />
    </div>
  );
}
