import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Session, SessionType } from "../lib/types";
import { SessionCard } from "./SessionCard";
import { useSessionContext } from "../context/SessionContext";
import { useSmartLayout } from "../hooks/useSmartLayout";
import { useTimelineCounts } from "../hooks/useTimelineCounts";
import { trackEvent } from "../lib/telemetry";

/** Delay (ms) for distinguishing single-click (focus) from double-click (open terminal). */
const DOUBLE_CLICK_MS = 250;

interface SmartGridProps {
  sessions: Session[];
  isTerminalOpen: boolean;
  onOpenSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  sessionTypeMap: Record<string, SessionType>;
}

/**
 * Smart, attention-driven session grid. Replaces the uniform 2-column grid.
 *
 * Layout engine lives in `src/lib/attention.ts`. This component:
 *   - Measures its container width via ResizeObserver
 *   - Calls `useSmartLayout` to compute absolute positions
 *   - Renders each card as an absolutely-positioned motion.div with `layout`
 *     prop so Framer Motion animates position changes
 *   - Handles click (focus) vs double-click (open terminal) with a 250ms
 *     pending-click ref that's per-card so fast clicks across cards don't
 *     false-positive as double-clicks
 *   - Listens for Escape to unfocus
 *
 * Phase 1 hardcodes hybrid mode. Phase 2 (deferred) would read the mode
 * from settings.
 */
export function SmartGrid({
  sessions,
  isTerminalOpen,
  onOpenSession,
  onSessionContextMenu,
  sessionTypeMap,
}: SmartGridProps) {
  const { focusedSessionId, setFocusedSessionId } = useSessionContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Timeline counts drive the frequency term in the attention score.
  const timelineCounts = useTimelineCounts(sessions);

  const layout = useSmartLayout(
    sessions,
    timelineCounts,
    focusedSessionId,
    containerWidth,
    "hybrid",
  );

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
    [onOpenSession, setFocusedSessionId],
  );

  // Escape unfocuses. If the terminal is open, the existing TerminalOverlay
  // escape handler fires first (it stops propagation), so this only triggers
  // on the overview.
  useEffect(() => {
    if (isTerminalOpen) return; // terminal owns Escape when open
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && focusedSessionId !== null) {
        setFocusedSessionId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isTerminalOpen, focusedSessionId, setFocusedSessionId]);

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
    <div className="flex-1 overflow-y-auto flex items-start justify-center p-8 pb-20">
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
          const session = sessionMap[pos.id];
          if (!session) return null;
          return (
            <motion.div
              key={pos.id}
              initial={false}
              animate={{
                x: pos.x,
                y: pos.y,
                width: pos.w,
                height: pos.h,
              }}
              transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
              className="absolute top-0 left-0"
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
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
