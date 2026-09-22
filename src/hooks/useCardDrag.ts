import { useCallback, useEffect, useRef, useState } from "react";

/** Pointer travel (px) before a press becomes a drag; below this it's a click. */
const DRAG_THRESHOLD_PX = 6;

export type DropKind = "session" | "stack";

/** What the pointer is over: an element with `data-drop-id` / `data-drop-kind`. */
export interface DropTarget {
  id: string;
  kind: DropKind;
}

export interface DragPoint {
  x: number;
  y: number;
}

interface UseCardDragOptions {
  /** Called on release after a real drag. `target` is null unless armed. */
  onDrop: (sourceId: string, target: DropTarget | null, point: DragPoint) => void;
  /** Hover time on a session before it arms as a merge target (iOS folder feel). */
  sessionDwellMs?: number;
  /** Optional per-move hook, e.g. to show "release to remove" feedback. */
  onMove?: (point: DragPoint) => void;
}

export interface CardDragState {
  sourceId: string;
  /** Target the pointer is over, armed once the dwell time has passed. */
  target: DropTarget | null;
}

interface PendingPress {
  id: string;
  element: HTMLElement;
  startX: number;
  startY: number;
  pointerId: number;
}

function findDropTarget(x: number, y: number, sourceId: string): DropTarget | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!(el instanceof HTMLElement)) continue;
    const holder = el.closest<HTMLElement>("[data-drop-id]");
    const id = holder?.dataset.dropId;
    const kind = holder?.dataset.dropKind;
    if (!id || id === sourceId || (kind !== "session" && kind !== "stack")) continue;
    return { id, kind };
  }
  return null;
}

/**
 * Pointer-based card dragging for stacks. Pointer events rather than HTML5
 * drag-and-drop, because Tauri's native drag-drop handler intercepts DOM drag
 * events. The ghost is a cloned DOM node moved imperatively, so a drag
 * doesn't re-render React on every pointer move.
 */
export function useCardDrag({ onDrop, sessionDwellMs = 350, onMove }: UseCardDragOptions) {
  const [dragState, setDragState] = useState<CardDragState | null>(null);
  const pressRef = useRef<PendingPress | null>(null);
  const ghostRef = useRef<{ node: HTMLElement; offsetX: number; offsetY: number } | null>(null);
  const hoverRef = useRef<{ target: DropTarget; armed: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const suppressClickRef = useRef(false);
  const onDropRef = useRef(onDrop);
  const onMoveRef = useRef(onMove);
  onDropRef.current = onDrop;
  onMoveRef.current = onMove;

  const clearHover = useCallback(() => {
    if (hoverRef.current?.timer) clearTimeout(hoverRef.current.timer);
    hoverRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    ghostRef.current?.node.remove();
    ghostRef.current = null;
    pressRef.current = null;
    clearHover();
    setDragState(null);
  }, [clearHover]);

  const updateHover = useCallback(
    (sourceId: string, target: DropTarget | null) => {
      const current = hoverRef.current;
      if (current && target && current.target.id === target.id) return;
      clearHover();
      if (!target) {
        setDragState({ sourceId, target: null });
        return;
      }
      // Stacks accept a drop right away; a session must be hovered briefly,
      // so passing over cards doesn't merge them by accident.
      if (target.kind === "stack") {
        hoverRef.current = { target, armed: true, timer: null };
        setDragState({ sourceId, target });
        return;
      }
      const timer = setTimeout(() => {
        if (hoverRef.current?.target.id !== target.id) return;
        hoverRef.current.armed = true;
        setDragState({ sourceId, target });
      }, sessionDwellMs);
      hoverRef.current = { target, armed: false, timer };
      setDragState({ sourceId, target: null });
    },
    [clearHover, sessionDwellMs],
  );

  const moveGhost = useCallback((x: number, y: number) => {
    const ghost = ghostRef.current;
    if (!ghost) return;
    ghost.node.style.transform = `translate(${x - ghost.offsetX}px, ${y - ghost.offsetY}px) scale(1.05)`;
  }, []);

  const startGhost = useCallback((press: PendingPress, x: number, y: number) => {
    const rect = press.element.getBoundingClientRect();
    const node = press.element.cloneNode(true) as HTMLElement;
    node.classList.add("card-drag-ghost");
    // The copy must never register as a drop target itself.
    node.removeAttribute("data-drop-id");
    node.removeAttribute("data-drop-kind");
    Object.assign(node.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: "0",
      pointerEvents: "none",
      zIndex: "80",
      transition: "box-shadow 150ms ease",
      boxShadow: "0 24px 48px rgba(15, 23, 42, 0.28)",
    });
    document.body.appendChild(node);
    ghostRef.current = { node, offsetX: press.startX - rect.left, offsetY: press.startY - rect.top };
    moveGhost(x, y);
  }, [moveGhost]);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || e.pointerId !== press.pointerId) return;
      if (!ghostRef.current) {
        const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
        if (moved < DRAG_THRESHOLD_PX) return;
        suppressClickRef.current = true;
        startGhost(press, e.clientX, e.clientY);
        setDragState({ sourceId: press.id, target: null });
      }
      moveGhost(e.clientX, e.clientY);
      updateHover(press.id, findDropTarget(e.clientX, e.clientY, press.id));
      onMoveRef.current?.({ x: e.clientX, y: e.clientY });
    };

    const handleUp = (e: PointerEvent) => {
      const press = pressRef.current;
      if (!press || e.pointerId !== press.pointerId) return;
      if (ghostRef.current) {
        const hover = hoverRef.current;
        const target = hover?.armed ? hover.target : null;
        onDropRef.current(press.id, target, { x: e.clientX, y: e.clientY });
        // The click that follows pointerup must not also focus or open.
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      teardown();
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !ghostRef.current) return;
      e.stopPropagation();
      teardown();
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", teardown);
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", teardown);
      window.removeEventListener("keydown", handleKey, { capture: true });
      ghostRef.current?.node.remove();
    };
  }, [moveGhost, startGhost, teardown, updateHover]);

  /** Attach to a draggable card wrapper's onPointerDown. */
  const beginPress = useCallback((id: string, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    pressRef.current = {
      id,
      element: e.currentTarget,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    };
  }, []);

  /** True right after a drag, so the trailing click can be ignored. */
  const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

  return { dragState, beginPress, shouldSuppressClick };
}
