import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useAnimate, usePresence } from "framer-motion";
import type { SessionType } from "../lib/types";
import type { StackInfo } from "../lib/stacks";
import { SessionCard } from "./SessionCard";
import { useCardDrag, type DragPoint } from "../hooks/useCardDrag";

interface StackOverlayProps {
  stack: StackInfo;
  /** Where the closed tile sits; the panel springs out of (and back into) it. */
  originRect: DOMRect;
  /** `data-drop-id` of the tile, re-measured on close in case the grid moved. */
  originDropId: string;
  /** Select the title for typing (a stack that was just created by a drop). */
  autoEditTitle: boolean;
  sessionTypeMap: Record<string, SessionType>;
  onClose: () => void;
  onOpenSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  onRename: (to: string) => void;
  onRemoveMember: (id: string) => void;
}

// Close to the iOS folder spring.
const SPRING = { type: "spring", stiffness: 300, damping: 30 } as const;

/** Transform that maps the panel's box onto the tile's box. */
function transformToward(origin: DOMRect, panel: DOMRect) {
  return {
    x: origin.left + origin.width / 2 - (panel.left + panel.width / 2),
    y: origin.top + origin.height / 2 - (panel.top + panel.height / 2),
    scaleX: origin.width / panel.width,
    scaleY: origin.height / panel.height,
  };
}

function isOutside(point: DragPoint, rect: DOMRect | undefined): boolean {
  if (!rect) return false;
  return point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom;
}

/**
 * An open session stack, iOS-folder style: the home view blurs, the panel
 * springs out of the tile, members fan in, and the name is editable in place.
 * One click opens a session, like tapping an app in a folder. Dragging a card
 * past the panel's edge takes it out of the stack.
 */
export function StackOverlay({
  stack,
  originRect,
  originDropId,
  autoEditTitle,
  sessionTypeMap,
  onClose,
  onOpenSession,
  onSessionContextMenu,
  onRename,
  onRemoveMember,
}: StackOverlayProps) {
  const [isPresent, safeToRemove] = usePresence();
  const [panelScope, animatePanel] = useAnimate<HTMLDivElement>();
  const [title, setTitle] = useState(stack.name);
  const [dragOutside, setDragOutside] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle(stack.name);
  }, [stack.name]);

  const { dragState, beginPress, shouldSuppressClick } = useCardDrag({
    onDrop: (sourceId, _target, point) => {
      setDragOutside(false);
      if (isOutside(point, panelScope.current?.getBoundingClientRect())) {
        onRemoveMember(sourceId);
      }
    },
    onMove: (point) => {
      setDragOutside(isOutside(point, panelScope.current?.getBoundingClientRect()));
    },
  });

  // Open: spring from the tile's box to the panel's resting box.
  useLayoutEffect(() => {
    const panel = panelScope.current;
    if (!panel) return;
    const from = transformToward(originRect, panel.getBoundingClientRect());
    void animatePanel(
      panel,
      {
        x: [from.x, 0],
        y: [from.y, 0],
        scaleX: [from.scaleX, 1],
        scaleY: [from.scaleY, 1],
        opacity: [0.5, 1],
      },
      SPRING,
    );
    if (autoEditTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
    // Runs once per open; later prop changes must not replay the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close: spring back into the tile, then let AnimatePresence unmount us.
  useEffect(() => {
    if (isPresent) return;
    const panel = panelScope.current;
    if (!panel) {
      safeToRemove?.();
      return;
    }
    const tile = document.querySelector(`[data-drop-id="${CSS.escape(originDropId)}"]`);
    const origin = tile?.getBoundingClientRect() ?? originRect;
    // Measure the resting box: undo the current transform first.
    panel.style.transform = "none";
    const to = transformToward(origin, panel.getBoundingClientRect());
    void animatePanel(panel, { ...to, opacity: 0 }, SPRING).then(() => safeToRemove?.());
  }, [isPresent, animatePanel, originDropId, originRect, panelScope, safeToRemove]);

  // Escape closes the stack (not the view underneath). A drag in progress
  // handles its own Escape as a cancel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dragState) return;
      if (document.activeElement === titleInputRef.current) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [dragState, onClose]);

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== stack.name) onRename(next);
    else setTitle(stack.name);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-10">
      <motion.div
        className="stack-backdrop absolute inset-0 bg-black/20"
        initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
        animate={{ opacity: 1, backdropFilter: "blur(14px)" }}
        exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
        transition={{ duration: 0.3 }}
        onClick={onClose}
      />

      <div
        ref={panelScope}
        className={`stack-panel glass-modal relative w-full max-w-3xl max-h-full overflow-y-auto rounded-[2rem] shadow-2xl p-6 transition-[box-shadow] ${
          dragOutside ? "ring-2 ring-rose-300/70" : ""
        }`}
        style={{ transformOrigin: "center center" }}
      >
        <input
          ref={titleInputRef}
          value={title}
          maxLength={40}
          aria-label="Stack name"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              setTitle(stack.name);
              e.currentTarget.blur();
            }
          }}
          className="stack-title w-full bg-transparent text-center text-2xl font-semibold text-slate-800 rounded-lg px-2 py-1 mb-5 focus:outline-none focus:bg-white/40"
        />

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stack.members.map((member, i) => (
            <motion.div
              key={member.id}
              className="h-[175px]"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: dragState?.sourceId === member.id ? 0.35 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ ...SPRING, delay: 0.04 * i }}
              onPointerDown={(e) => beginPress(member.id, e)}
            >
              <SessionCard
                session={member}
                index={0}
                size="medium"
                sessionType={sessionTypeMap[member.session_type]}
                onClick={() => {
                  if (shouldSuppressClick()) return;
                  onOpenSession(member.id);
                }}
                onContextMenu={(e) => onSessionContextMenu(member.id, e)}
              />
            </motion.div>
          ))}
        </div>

        <p className="mt-5 text-center text-[11px] text-slate-500">
          {dragOutside ? "Release to take it out of the stack" : "Drag a card out to remove it from the stack"}
        </p>
      </div>
    </div>
  );
}
