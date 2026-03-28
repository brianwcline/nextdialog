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
  user_input: "bg-indigo-400",
};

// High-priority events get a subtle background highlight
const HIGH_PRIORITY_TYPES = new Set(["notification", "lifecycle"]);

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}

/** A turn is a user prompt followed by Claude's actions until the next prompt or end. */
interface Turn {
  userPrompt?: GroupedTimelineEntry;
  actions: GroupedTimelineEntry[];
  outcome?: GroupedTimelineEntry; // The Stop/status entry that ends the turn
}

/** Split a reversed (newest-first) entry list into turns. */
function splitIntoTurns(entries: GroupedTimelineEntry[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn = { actions: [] };

  for (const entry of entries) {
    if (entry.event_type === "user_input") {
      // User prompt starts a new turn — save current and start fresh
      current.userPrompt = entry;
      turns.push(current);
      current = { actions: [] };
    } else if (entry.event_type === "status") {
      // Stop/idle event — this is the outcome of the current turn
      current.outcome = entry;
    } else {
      current.actions.push(entry);
    }
  }

  // Push remaining turn
  if (current.actions.length > 0 || current.outcome || current.userPrompt) {
    turns.push(current);
  }

  return turns;
}

function ActionRow({ entry }: { entry: GroupedTimelineEntry }) {
  const dotColor = DOT_COLORS[entry.event_type] ?? "bg-slate-500";
  const isHighPriority = HIGH_PRIORITY_TYPES.has(entry.event_type);

  return (
    <div
      className={`flex items-start gap-3 py-1.5 pl-5 ${
        isHighPriority ? "text-slate-200" : "text-slate-400"
      }`}
    >
      <div className={`w-[6px] h-[6px] rounded-full ${dotColor} mt-1.5 shrink-0 ${
        isHighPriority ? "ring-2 ring-amber-400/20" : ""
      }`} />
      <p className="text-[13px] leading-relaxed truncate flex-1 min-w-0">
        {entry.summary}
      </p>
      {entry.count > 1 && (
        <span className="text-[10px] text-slate-600 shrink-0">
          {entry.count}×
        </span>
      )}
      <span className="text-[10px] text-slate-600 font-mono shrink-0">
        {formatRelativeTime(entry.timestamp)}
      </span>
    </div>
  );
}

function TurnSection({
  turn,
  isFirst,
}: {
  turn: Turn;
  isFirst: boolean;
}) {
  const hasPrompt = !!turn.userPrompt;

  return (
    <motion.div
      initial={isFirst ? { opacity: 0, y: -8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] }}
      className="px-6 py-3"
    >
      {/* User prompt — turn header */}
      {hasPrompt && (
        <div className="flex items-start gap-3 mb-2">
          <div className="w-[6px] h-[6px] rounded-full bg-indigo-400 mt-2 shrink-0 ring-2 ring-indigo-400/20" />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] text-indigo-400/70 uppercase tracking-wider">
              You
            </span>
            <p className="text-sm text-slate-100 leading-relaxed mt-0.5 line-clamp-2">
              {turn.userPrompt!.summary}
            </p>
          </div>
          <span className="text-[10px] text-slate-600 font-mono shrink-0 pt-1.5">
            {formatRelativeTime(turn.userPrompt!.timestamp)}
          </span>
        </div>
      )}

      {/* Claude's actions */}
      {turn.actions.length > 0 && (
        <div className={`${hasPrompt ? "ml-2 border-l border-slate-700/30 pl-2" : ""}`}>
          {turn.actions.map((entry) => (
            <ActionRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Outcome — what Claude concluded */}
      {turn.outcome && (
        <div className={`mt-2 ${hasPrompt ? "ml-2 pl-2" : ""}`}>
          <div className="flex items-start gap-3 py-1.5 px-3 rounded-lg bg-white/[0.02]">
            <div className="w-[6px] h-[6px] rounded-full bg-slate-500 mt-1.5 shrink-0" />
            <p className="text-[13px] text-slate-400 leading-relaxed flex-1 min-w-0 line-clamp-2">
              {turn.outcome.summary}
            </p>
            <span className="text-[10px] text-slate-600 font-mono shrink-0">
              {formatRelativeTime(turn.outcome.timestamp)}
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export function SessionTimeline({
  sessionId,
  isOpen,
  onDismiss,
}: SessionTimelineProps) {
  const { entries, loading } = useTimelineEvents(sessionId, isOpen);

  const reversedEntries = [...entries].reverse();
  const turns = splitIntoTurns(reversedEntries);

  return (
    <div className="flex flex-col h-full bg-[#181825] relative">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.06] shrink-0"
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Timeline
          </span>
          {entries.length > 0 && (
            <span className="text-[11px] text-slate-600 font-mono">
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

      {/* Timeline turns — scrollable, newest at top */}
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
          <div className="py-1 divide-y divide-white/[0.04]">
            {turns.map((turn, i) => (
              <TurnSection
                key={turn.userPrompt?.id ?? turn.actions[0]?.id ?? `turn-${i}`}
                turn={turn}
                isFirst={i === 0}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom glow edge — visual separation from terminal below */}
      <div className="absolute bottom-0 inset-x-0 h-16 pointer-events-none bg-gradient-to-t from-[#181825] via-[#181825]/80 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-indigo-500/20 via-indigo-400/30 to-indigo-500/20" />
    </div>
  );
}
