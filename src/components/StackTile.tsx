import { motion } from "framer-motion";
import type { SessionSize, SessionType } from "../lib/types";
import type { StackInfo } from "../lib/stacks";
import { SessionCard } from "./SessionCard";

interface StackTileProps {
  stack: StackInfo;
  size: SessionSize;
  sessionTypeMap: Record<string, SessionType>;
  /** Hidden while this stack is open, so the panel appears to lift out of it. */
  isOpen: boolean;
  /** Highlighted as a drop target during a card drag. */
  isDropTarget: boolean;
  onOpen: (rect: DOMRect) => void;
}

// Cards peeking out behind the front card: [lift px, scale, opacity].
const BACK_LAYERS: Array<[number, number, number]> = [
  [-12, 0.92, 0.5],
  [-6, 0.96, 0.8],
];

/**
 * A closed session stack: the busiest member's card on top of a fanned pile,
 * the stack name on a tab, and an iOS-style badge counting members that
 * need the user.
 */
export function StackTile({
  stack,
  size,
  sessionTypeMap,
  isOpen,
  isDropTarget,
  onOpen,
}: StackTileProps) {
  const front = stack.members[0];
  if (!front) return null;
  const badgeColor = stack.members.some((m) => m.status === "error") ? "bg-red-500" : "bg-amber-500";

  return (
    // A div with button semantics: SessionCard renders its own <button>,
    // and buttons can't nest.
    <motion.div
      role="button"
      tabIndex={0}
      className="stack-tile relative w-full h-full text-left cursor-pointer"
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(e.currentTarget.getBoundingClientRect());
        }
      }}
      initial="rest"
      animate={isDropTarget ? "target" : "rest"}
      whileHover="hover"
      style={{ opacity: isOpen ? 0 : 1 }}
      aria-label={`Open stack ${stack.name}, ${stack.members.length} sessions`}
    >
      {BACK_LAYERS.map(([lift, scale, opacity], i) => (
        <motion.div
          key={i}
          aria-hidden
          className="stack-layer card glass-card absolute inset-0 rounded-2xl"
          variants={{
            rest: { y: lift, scale, opacity },
            // The pile spreads a little on hover, hinting that it opens.
            hover: { y: lift * 1.6, scale, opacity },
            target: { y: lift * 2, scale: scale + 0.02, opacity },
          }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
        />
      ))}

      <motion.div
        className="absolute inset-0 pointer-events-none"
        variants={{ rest: { scale: 1 }, hover: { scale: 1.01 }, target: { scale: 1.04 } }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
      >
        <SessionCard
          session={front}
          index={0}
          size={size}
          sessionType={sessionTypeMap[front.session_type]}
          onClick={() => {}}
          onContextMenu={() => {}}
        />
      </motion.div>

      <span className="stack-name absolute -top-3 left-4 z-10 max-w-[70%] truncate px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-slate-700 bg-white/85 shadow-sm backdrop-blur">
        {stack.name}
        <span className="ml-1.5 font-normal text-slate-400">{stack.members.length}</span>
      </span>

      {stack.attentionCount > 0 && (
        <span
          className={`stack-badge absolute -top-2 -right-2 z-10 min-w-[22px] h-[22px] px-1.5 rounded-full ${badgeColor} text-white text-[11px] font-bold flex items-center justify-center shadow-md`}
          title={`${stack.attentionCount} session(s) need you`}
        >
          {stack.attentionCount}
        </span>
      )}

      {isDropTarget && (
        <span
          aria-hidden
          className="stack-drop-ring absolute -inset-1.5 rounded-[1.25rem] ring-2 ring-violet-400/70 pointer-events-none"
        />
      )}
    </motion.div>
  );
}
