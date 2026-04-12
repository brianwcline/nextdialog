/**
 * Smart layout engine — pure functions ported from
 * `product-manager/experiments/smart-layout/index.html` (lines 1615–1766).
 *
 * Everything in this file is side-effect-free. The `computeLayout` function
 * returns an array of absolute positions the React layer renders via
 * Framer Motion `layout` props.
 *
 * Attention scoring formula (exact match to the experiment):
 *   score = 0.65 * recencyScore + 0.25 * frequencyScore + statusBoost
 *     recencyScore   = max(0, 1 - (now - lastInteraction) / 24h)
 *     frequencyScore = min(1, interactionCount / 30)
 *     statusBoost    = 0.10 if planning, 0.08 if working, else 0
 */
import type { SessionSize, SessionStatus } from "./types";

/** Gap between cards in pixels. Matches the experiment. */
export const CARD_GAP = 16;

/** Layout mode — Phase 1 only exposes `"hybrid"` via SmartGrid. */
export type LayoutMode = "hybrid" | "recency" | "focus";

/** Minimal shape the attention engine needs from a session. */
export interface AttentionSession {
  id: string;
  status: SessionStatus;
  /** Epoch milliseconds of the last interaction (from `last_active`). */
  lastInteraction: number;
  /** Count of timeline entries — from `get_timeline_count` Tauri command. */
  interactionCount: number;
  /** Project slug derived from working directory; null when unknown. */
  project: string | null;
}

/** Absolute card position in the grid. */
export interface CardPosition {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  size: SessionSize;
  isHero?: boolean;
}

/** Result of layout computation. Includes total grid height. */
export interface LayoutResult {
  positions: CardPosition[];
  totalHeight: number;
  /** True if there is a focused session (focus or hybrid mode) — drives the dock divider. */
  showDockDivider: boolean;
  /** Y offset where the dock (minimal cards) starts, used to place the divider. Null when no dock. */
  dockDividerY: number | null;
}

/** Card heights per size category (no-focus layouts). Matches experiment. */
const SIZE_HEIGHTS: Record<SessionSize, number> = {
  large: 200,
  medium: 175,
  small: 145,
  minimal: 115,
};

const HERO_HEIGHT = 260;
const FOCUS_RELATED_HEIGHT = 160;
const FOCUS_DOCK_HEIGHT = 100;
/**
 * Extra vertical space reserved between the hero/related row and the dock
 * row, used to house the "other sessions" divider. Larger than CARD_GAP so
 * the divider has real breathing room and so dramatic focused-card glows
 * (Synthwave's neon outer shadow, Bento's deep drop shadow) don't bleed
 * through the divider text.
 */
const DOCK_DIVIDER_SPACE = 48;

export function getAttentionScore(s: AttentionSession): number {
  const recency = Math.max(0, 1 - (Date.now() - s.lastInteraction) / (24 * 3_600_000));
  const frequency = Math.min(1, s.interactionCount / 30);
  const statusBoost = s.status === "planning" ? 0.1 : s.status === "working" ? 0.08 : 0;
  return recency * 0.65 + frequency * 0.25 + statusBoost;
}

export function isRelated(
  a: AttentionSession | null | undefined,
  b: AttentionSession | null | undefined,
): boolean {
  if (!a || !b) return false;
  return !!a.project && !!b.project && a.project === b.project;
}

export function getSizeCategory(
  session: AttentionSession,
  layout: LayoutMode,
  focusedSession: AttentionSession | null,
): SessionSize {
  if ((layout === "focus" || layout === "hybrid") && focusedSession) {
    if (session.id === focusedSession.id) return "large";
    if (isRelated(session, focusedSession)) return "medium";
    return "minimal";
  }

  const score = getAttentionScore(session);
  if (score > 0.7) return "large";
  if (score > 0.4) return "medium";
  if (score > 0.15) return "small";
  return "minimal";
}

export function sortSessions(
  sessions: AttentionSession[],
  layout: LayoutMode,
  focusedSession: AttentionSession | null,
): AttentionSession[] {
  const sorted = [...sessions];

  if ((layout === "focus" || layout === "hybrid") && focusedSession) {
    sorted.sort((a, b) => {
      if (a.id === focusedSession.id) return -1;
      if (b.id === focusedSession.id) return 1;
      const aRel = isRelated(a, focusedSession);
      const bRel = isRelated(b, focusedSession);
      if (aRel && !bRel) return -1;
      if (!aRel && bRel) return 1;
      return getAttentionScore(b) - getAttentionScore(a);
    });
  } else {
    sorted.sort((a, b) => getAttentionScore(b) - getAttentionScore(a));
  }

  return sorted;
}

export function computeLayout(
  sortedSessions: AttentionSession[],
  layout: LayoutMode,
  focusedSession: AttentionSession | null,
  containerWidth: number,
): LayoutResult {
  if (sortedSessions.length === 0) {
    return { positions: [], totalHeight: 0, showDockDivider: false, dockDividerY: null };
  }

  const positions: CardPosition[] = [];
  const hasFocus = (layout === "focus" || layout === "hybrid") && focusedSession;

  if (hasFocus && focusedSession) {
    const related = sortedSessions.filter(
      (s) => s.id !== focusedSession.id && isRelated(s, focusedSession),
    );
    const rest = sortedSessions.filter(
      (s) => s.id !== focusedSession.id && !isRelated(s, focusedSession),
    );

    let curY = 0;

    // Hero card — full width, tall enough for terminal preview
    positions.push({
      id: focusedSession.id,
      x: 0,
      y: curY,
      w: containerWidth,
      h: HERO_HEIGHT,
      size: "large",
      isHero: true,
    });
    curY += HERO_HEIGHT + CARD_GAP;

    // Related cards — equal row
    if (related.length > 0) {
      const relW = (containerWidth - CARD_GAP * (related.length - 1)) / related.length;
      related.forEach((s, i) => {
        positions.push({
          id: s.id,
          x: i * (relW + CARD_GAP),
          y: curY,
          w: relW,
          h: FOCUS_RELATED_HEIGHT,
          size: "medium",
        });
      });
      curY += FOCUS_RELATED_HEIGHT + CARD_GAP;
    }

    // Expand the gap before the dock when a divider will be shown.
    // The divider sits visually centered inside this extra space; dock
    // cards render below it.
    const hasDock = rest.length > 0;
    const dividerCenterY = hasDock ? curY + DOCK_DIVIDER_SPACE / 2 : null;
    const dockStartY = hasDock ? curY + DOCK_DIVIDER_SPACE : 0;

    // Compact dock — adapt columns to count, keep readable
    if (hasDock) {
      const dockCols = rest.length <= 2 ? 2 : rest.length <= 4 ? Math.min(rest.length, 3) : 4;
      const dockH = FOCUS_DOCK_HEIGHT;
      const totalRows = Math.ceil(rest.length / dockCols);

      rest.forEach((s, i) => {
        const row = Math.floor(i / dockCols);
        const col = i % dockCols;
        // Count how many cards are on this row for equal distribution
        const cardsInRow =
          row === totalRows - 1 ? rest.length - row * dockCols : dockCols;
        const rowW = (containerWidth - CARD_GAP * (cardsInRow - 1)) / cardsInRow;
        positions.push({
          id: s.id,
          x: col * (rowW + CARD_GAP),
          y: dockStartY + row * (dockH + CARD_GAP),
          w: rowW,
          h: dockH,
          size: "minimal",
        });
      });
      curY = dockStartY + totalRows * (dockH + CARD_GAP) - CARD_GAP;
    }

    return {
      positions,
      totalHeight: curY,
      showDockDivider: hasDock,
      dockDividerY: dividerCenterY,
    };
  }

  // Recency / hybrid (no focus): hero + 2-column masonry
  // Categorize all cards
  const categorized = sortedSessions.map((s) => ({
    session: s,
    size: getSizeCategory(s, layout, null),
  }));

  // First card (highest attention) gets hero treatment — full width, taller
  const hero = categorized.shift();
  if (!hero) {
    return { positions: [], totalHeight: 0, showDockDivider: false, dockDividerY: null };
  }

  positions.push({
    id: hero.session.id,
    x: 0,
    y: 0,
    w: containerWidth,
    h: HERO_HEIGHT,
    size: hero.size,
    isHero: true,
  });

  // Rest: 2-column masonry, placed in shortest column
  const colW = (containerWidth - CARD_GAP) / 2;
  const colHeights: [number, number] = [HERO_HEIGHT + CARD_GAP, HERO_HEIGHT + CARD_GAP];

  categorized.forEach(({ session, size }, i) => {
    const cardH = SIZE_HEIGHTS[size];
    // Last card alone in a row? Stretch to full width
    const isLast = i === categorized.length - 1;
    const colDiff = Math.abs(colHeights[0] - colHeights[1]);
    const isOrphan = isLast && colDiff < 5;

    if (isOrphan) {
      const y = Math.max(colHeights[0], colHeights[1]);
      positions.push({ id: session.id, x: 0, y, w: containerWidth, h: cardH, size });
      const newColHeight = y + cardH + CARD_GAP;
      colHeights[0] = newColHeight;
      colHeights[1] = newColHeight;
    } else {
      const col = colHeights[0] <= colHeights[1] ? 0 : 1;
      const y = colHeights[col];
      positions.push({
        id: session.id,
        x: col * (colW + CARD_GAP),
        y,
        w: colW,
        h: cardH,
        size,
      });
      colHeights[col] = y + cardH + CARD_GAP;
    }
  });

  const totalHeight = Math.max(colHeights[0], colHeights[1]) - CARD_GAP;

  return { positions, totalHeight, showDockDivider: false, dockDividerY: null };
}
