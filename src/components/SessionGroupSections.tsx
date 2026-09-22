import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import type { Session, SessionType } from "../lib/types";
import { SmartGrid } from "./SmartGrid";
import { partitionIntoSections } from "../lib/sessionSections";
import { readCollapsedGroups, writeCollapsedGroups } from "../lib/collapsedGroups";
import { trackEvent } from "../lib/telemetry";

interface SessionGroupSectionsProps {
  sessions: Session[];
  isTerminalOpen: boolean;
  onOpenSession: (id: string) => void;
  onSessionContextMenu: (id: string, e: React.MouseEvent) => void;
  sessionTypeMap: Record<string, SessionType>;
}

// Collapsed-state key for the ungrouped section. Blank group names are
// stored as "no group", so "" can never collide with a real group.
const UNGROUPED_KEY = "";

/** A session a collapsed section must not hide. */
function needsAttention(session: Session): boolean {
  return session.status === "waiting" || session.status === "error";
}

/**
 * Home view once any session has a group (#12, #17): one collapsible section
 * per group, named groups alphabetically and ungrouped last. Each section is
 * its own SmartGrid, so the attention layout still sizes and orders cards
 * within the group.
 */
export function SessionGroupSections({
  sessions,
  isTerminalOpen,
  onOpenSession,
  onSessionContextMenu,
  sessionTypeMap,
}: SessionGroupSectionsProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups);

  const toggleSection = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      const nowCollapsed = !next.has(key);
      if (nowCollapsed) next.add(key);
      else next.delete(key);
      writeCollapsedGroups(next);
      return next;
    });
  }, []);

  const sections = partitionIntoSections(sessions);

  return (
    <motion.div
      className="flex flex-col gap-8"
      initial={false}
      animate={{ opacity: isTerminalOpen ? 0 : 1 }}
      transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
    >
      {sections.map(({ group, sessions: sectionSessions }) => {
        const key = group ?? UNGROUPED_KEY;
        // A session waiting on the user or in error keeps its section open.
        const forcedOpen = sectionSessions.some(needsAttention);
        const isCollapsed = collapsed.has(key) && !forcedOpen;

        return (
          <section key={key} className="session-group">
            <button
              type="button"
              onClick={() => {
                // Report the new state before toggling so the event matches
                // what the user sees.
                trackEvent("session_group.collapsed_toggled", "session-groups", {
                  collapsed: !collapsed.has(key),
                });
                toggleSection(key);
              }}
              aria-expanded={!isCollapsed}
              className="session-group-header flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors"
              title={forcedOpen && collapsed.has(key) ? "Kept open: a session needs attention" : undefined}
            >
              <span
                aria-hidden
                className="inline-block w-3 transition-transform duration-200"
                style={{ transform: isCollapsed ? "rotate(-90deg)" : "none" }}
              >
                ▾
              </span>
              <span>{group ?? "Ungrouped"}</span>
              <span className="font-normal normal-case tracking-normal text-slate-400">
                {sectionSessions.length}
              </span>
            </button>

            {!isCollapsed && (
              <SmartGrid
                sessions={sectionSessions}
                isTerminalOpen={isTerminalOpen}
                onOpenSession={onOpenSession}
                onSessionContextMenu={onSessionContextMenu}
                sessionTypeMap={sessionTypeMap}
                leadWithHero={false}
              />
            )}
          </section>
        );
      })}
    </motion.div>
  );
}
