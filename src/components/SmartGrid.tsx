import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Session, SessionType } from "../lib/types";
import type { LayoutResult } from "../lib/attention";
import { SessionCard } from "./SessionCard";
import { StackTile } from "./StackTile";
import { useSessionContext } from "../context/SessionContext";
import { useSmartLayout } from "../hooks/useSmartLayout";
import { useTimelineCounts } from "../hooks/useTimelineCounts";
import { useCardDrag } from "../hooks/useCardDrag";
import { buildStacks, stackNameFromId } from "../lib/stacks";
import { trackEvent } from "../lib/telemetry";

/** Delay (ms) for distinguishing single-click (focus) from double-click (open terminal). */
const DOUBLE_CLICK_MS = 250;

interface SmartGridProps {
  sessions: Session[];
  isTerminalOpen: boolean;
  onOpenSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  sessionTypeMap: Record<string, SessionType>;
  /** Stack currently open in the overlay; its tile hides meanwhile. */
  openStackName: string | null;
  onOpenStack: (name: string, rect: DOMRect) => void;
  /** A card was dropped on another card: make a stack of the two. */
  onDropOnSession: (sourceId: string, targetId: string, targetRect: DOMRect) => void;
  /** A card was dropped on a stack: add it. */
  onDropOnStack: (sourceId: string, stackName: string) => void;
}

/**
 * Smart, attention-driven session grid.
 *
 * Layout engine lives in `src/lib/attention.ts`. This component:
 *   - Measures its container width via ResizeObserver
 *   - Calls `useSmartLayout` to compute absolute positions; grouped sessions
 *     are placed as one stack tile per group (iOS-folder style)
 *   - Renders each item as an absolutely-positioned motion.div whose x/y/w/h
 *     are animated explicitly
 *   - Handles click (focus) vs double-click (open terminal) with a 250ms
 *     pending-click ref that's per-card so fast clicks across cards don't
 *     false-positive as double-clicks
 *   - Lets cards be dragged onto cards (new stack) or stacks (add). The
 *     layout freezes during a drag so targets don't move under the pointer.
 *
 * The parent (HomeView) owns the scroll container and the Escape-to-unfocus
 * listener.
 */
export function SmartGrid({
  sessions,
  isTerminalOpen,
  onOpenSession,
  onSessionContextMenu,
  sessionTypeMap,
  openStackName,
  onOpenStack,
  onDropOnSession,
  onDropOnStack,
}: SmartGridProps) {
  const { focusedSessionId, setFocusedSessionId } = useSessionContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Timeline counts drive the frequency term in the attention score.
  const timelineCounts = useTimelineCounts(sessions);
  const { loose, stacks } = useMemo(
    () => buildStacks(sessions, timelineCounts),
    [sessions, timelineCounts],
  );
  const stackMap = useMemo(
    () => Object.fromEntries(stacks.map((stack) => [stack.name, stack])),
    [stacks],
  );

  const liveLayout = useSmartLayout(
    loose,
    stacks,
    timelineCounts,
    focusedSessionId,
    containerWidth,
    "hybrid",
  );

  const { dragState, beginPress, shouldSuppressClick } = useCardDrag({
    onDrop: (sourceId, target) => {
      if (!target) return;
      const stackName = stackNameFromId(target.id);
      if (target.kind === "stack" && stackName) {
        onDropOnStack(sourceId, stackName);
        return;
      }
      const targetEl = containerRef.current?.querySelector(
        `[data-drop-id="${CSS.escape(target.id)}"]`,
      );
      if (targetEl) onDropOnSession(sourceId, target.id, targetEl.getBoundingClientRect());
    },
  });

  // Freeze positions while dragging so drop targets stay put.
  const frozenLayoutRef = useRef<LayoutResult>(liveLayout);
  if (!dragState) frozenLayoutRef.current = liveLayout;
  const layout = dragState ? frozenLayoutRef.current : liveLayout;

  // Measure container width — re-measure on resize.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pending-click tracker for single-vs-double-click discrimination.
  // Tracks which session id has a pending single-click so that a rapid
  // click on a *different* card doesn't get mistaken for a double-click.
  const pendingClickRef = useRef<{
    id: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Mirror focusedSessionId in a ref so the click handler's setTimeout
  // callback reads fresh state without putting trackEvent inside a state
  // updater (updaters must be pure — Strict Mode double-invokes them).
  const focusedIdRef = useRef(focusedSessionId);
  useEffect(() => {
    focusedIdRef.current = focusedSessionId;
  }, [focusedSessionId]);

  // Clean up any pending timer on unmount.
  useEffect(() => {
    return () => {
      if (pendingClickRef.current) {
        clearTimeout(pendingClickRef.current.timer);
        pendingClickRef.current = null;
      }
    };
  }, []);

  const handleCardClick = useCallback(
    (id: string) => {
      // The click that ends a drag is not a focus or open.
      if (shouldSuppressClick()) return;
      const pending = pendingClickRef.current;

      // Same card clicked twice within the window → double click → open terminal
      if (pending && pending.id === id) {
        clearTimeout(pending.timer);
        pendingClickRef.current = null;
        onOpenSession(id);
        return;
      }

      // Different card (or no pending) → cancel any pending click, start a fresh timer
      if (pending) {
        clearTimeout(pending.timer);
      }

      const timer = setTimeout(() => {
        // Single click: toggle focus. Clicking an already-focused card unfocuses it.
        // Read latest focus via ref to avoid putting trackEvent inside a state
        // updater (Strict Mode double-invokes updaters).
        const next = focusedIdRef.current === id ? null : id;
        setFocusedSessionId(next);
        trackEvent(
          "layout.focus_toggled",
          "smart-layout",
          { focused: next !== null },
          id,
        );
        pendingClickRef.current = null;
      }, DOUBLE_CLICK_MS);

      pendingClickRef.current = { id, timer };
    },
    [onOpenSession, setFocusedSessionId, shouldSuppressClick],
  );

  const sessionMap = Object.fromEntries(sessions.map((s) => [s.id, s]));

  // `grid-container` + `hybrid-mode` are theme hooks so CSS can target
  // the hybrid masonry layout specifically (e.g., corner markers).
  const gridClasses = [
    "grid-container",
    focusedSessionId === null ? "hybrid-mode" : "",
    "relative w-full max-w-4xl",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: -20 }}
      animate={{
        opacity: isTerminalOpen ? 0 : 1,
        y: isTerminalOpen ? -20 : 0,
      }}
      transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      className={gridClasses}
      style={{ height: layout.totalHeight || undefined }}
    >
      {layout.showDockDivider && layout.dockDividerY !== null && (
        <div
          className="dock-divider absolute left-0 right-0 pointer-events-none"
          style={{
            top: layout.dockDividerY,
            transform: "translateY(-50%)",
          }}
        >
          <span>other sessions</span>
        </div>
      )}

      {layout.positions.map((pos, idx) => {
        const box = { x: pos.x, y: pos.y, width: pos.w, height: pos.h };
        const transition = { duration: 0.4, ease: [0.25, 0.8, 0.25, 1] as const };
        const isDropTarget = dragState?.target?.id === pos.id;

        const stackName = stackNameFromId(pos.id);
        if (stackName) {
          const stack = stackMap[stackName];
          if (!stack) return null;
          return (
            <motion.div
              key={pos.id}
              data-drop-id={pos.id}
              data-drop-kind="stack"
              initial={false}
              animate={box}
              transition={transition}
              className="absolute top-0 left-0"
            >
              <StackTile
                stack={stack}
                size={pos.size}
                sessionTypeMap={sessionTypeMap}
                isOpen={openStackName === stackName}
                isDropTarget={isDropTarget}
                onOpen={(rect) => onOpenStack(stackName, rect)}
              />
            </motion.div>
          );
        }

        const session = sessionMap[pos.id];
        if (!session) return null;
        const isDragSource = dragState?.sourceId === pos.id;
        return (
          <motion.div
            key={pos.id}
            data-drop-id={pos.id}
            data-drop-kind="session"
            initial={false}
            animate={{
              ...box,
              // A card armed as a merge target swells, like iOS before a folder forms.
              scale: isDropTarget ? 1.06 : 1,
              opacity: isDragSource ? 0.4 : 1,
            }}
            transition={transition}
            className={`absolute top-0 left-0 ${isDropTarget ? "stack-merge-target" : ""}`}
            onPointerDown={(e) => beginPress(pos.id, e)}
          >
            <SessionCard
              session={session}
              index={idx}
              size={pos.size}
              isFocused={focusedSessionId === pos.id}
              sessionType={sessionTypeMap[session.session_type]}
              onClick={() => handleCardClick(pos.id)}
              onContextMenu={(e) => onSessionContextMenu(pos.id, e)}
            />
            {isDropTarget && (
              <span
                aria-hidden
                className="absolute -inset-1.5 rounded-[1.25rem] ring-2 ring-violet-400/70 pointer-events-none"
              />
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
}
