import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { SessionTimeline } from "./SessionTimeline";
import { TuningPanel } from "./TuningPanel";
import { StatusDot } from "./StatusDot";
import { trackEvent } from "../lib/telemetry";
import type { Session } from "../lib/types";
import "@xterm/xterm/css/xterm.css";

interface TerminalOverlayProps {
  session: Session;
  companions: Session[];
  isOpen: boolean;
  onClose: () => void;
  onEnd: (id: string) => void;
  onRestart: (id: string) => void;
  onRemove: (id: string) => void;
  onPark: (id: string) => void;
  onAddCompanion: (parentId: string) => void;
  onRemoveCompanion: (id: string) => void;
}

export function TerminalOverlay({
  session,
  companions,
  isOpen,
  onClose,
  onEnd,
  onRestart,
  onRemove,
  onPark,
  onAddCompanion,
  onRemoveCompanion,
}: TerminalOverlayProps) {
  const [activeTabId, setActiveTabId] = useState(session.id);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [tuningOpen, setTuningOpen] = useState(false);
  const paneRefs = useRef<Map<string, TerminalPaneHandle>>(new Map());

  const allTabs = [session, ...companions];
  const activeSession = allTabs.find((t) => t.id === activeTabId) ?? session;
  // Reset to primary tab if active tab was removed
  useEffect(() => {
    if (!allTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(session.id);
    }
  }, [allTabs, activeTabId, session.id]);

  // Close timeline and tuning when overlay closes
  useEffect(() => {
    if (!isOpen) {
      setTimelineOpen(false);
      setTuningOpen(false);
    }
  }, [isOpen]);

  // Track timeline usage
  useEffect(() => {
    if (timelineOpen) {
      trackEvent("timeline.opened", "timeline", undefined, activeSession.id);
    }
  }, [timelineOpen, activeSession.id]);

  // Compute menu position from button ref when menu opens, and dismiss on outside click
  useEffect(() => {
    if (showMenu && menuBtnRef.current) {
      const rect = menuBtnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 180 });

      const onClickOutside = (e: MouseEvent) => {
        if (menuBtnRef.current?.contains(e.target as Node)) return;
        setShowMenu(false);
      };
      window.addEventListener("mousedown", onClickOutside);
      return () => window.removeEventListener("mousedown", onClickOutside);
    }
  }, [showMenu]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (tuningOpen) {
          setTuningOpen(false);
          return;
        }
        if (timelineOpen) {
          setTimelineOpen(false);
          return;
        }
        if (showMenu) {
          setShowMenu(false);
        }
        return;
      }

      // ⌘← or ⌘Backspace → back to home
      if (e.metaKey && (e.key === "ArrowLeft" || e.key === "Backspace") && !e.shiftKey) {
        e.preventDefault();
        onClose();
        return;
      }

      // ⌘R → restart
      if (e.metaKey && e.key === "r" && !e.shiftKey) {
        e.preventDefault();
        onRestart(session.id);
        return;
      }

      // ⌘P → park session
      if (e.metaKey && e.key === "p" && !e.shiftKey) {
        e.preventDefault();
        onPark(session.id);
        return;
      }

      // ⌘⇧E → end session
      if (e.metaKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        onEnd(session.id);
        return;
      }

      // ⌘. → toggle timeline
      if (e.metaKey && e.key === ".") {
        e.preventDefault();
        setTimelineOpen((v) => !v);
        return;
      }

      // ⌘, → toggle tuning panel
      if (e.metaKey && e.key === ",") {
        e.preventDefault();
        setTuningOpen((v) => !v);
        return;
      }

      if (e.metaKey && e.key === "t") {
        e.preventDefault();
        onAddCompanion(session.id);
        return;
      }

      if (e.metaKey && e.key === "w") {
        e.preventDefault();
        if (activeTabId !== session.id) {
          onRemoveCompanion(activeTabId);
        }
        return;
      }

      if (e.metaKey && e.key === "ArrowDown") {
        e.preventDefault();
        paneRefs.current.get(activeTabId)?.scrollToBottom();
        return;
      }

      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const tabs = [session, ...companions];
        if (idx < tabs.length) {
          setActiveTabId(tabs[idx].id);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, onRestart, onPark, onEnd, showMenu, timelineOpen, tuningOpen, session, companions, activeTabId, onAddCompanion, onRemoveCompanion]);

  // Drag-drop file handling — writes to active tab
  useEffect(() => {
    if (!isOpen) return;
    const webview = getCurrentWebviewWindow();
    const unlistenPromise = webview.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (paths.length > 0) {
          invoke("write_to_pty", {
            id: activeTabId,
            data: paths.join(" "),
          }).catch(console.error);
        }
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isOpen, activeTabId]);

  // Auto-switch to newly added companion
  const prevCompanionCountRef = useRef(companions.length);
  useEffect(() => {
    if (companions.length > prevCompanionCountRef.current) {
      const newest = companions[companions.length - 1];
      if (newest) setActiveTabId(newest.id);
    }
    prevCompanionCountRef.current = companions.length;
  }, [companions.length]);

  const handleCloseCompanionTab = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onRemoveCompanion(id);
    },
    [onRemoveCompanion],
  );

  const hasCompanions = companions.length > 0;
  const showTimelineButton = activeSession.session_type !== "terminal";

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      initial={false}
      animate={{
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? "auto" : "none",
      }}
      transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      style={{ visibility: isOpen ? "visible" : "hidden" }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/10"
        initial={false}
        animate={{ backdropFilter: isOpen ? "blur(8px)" : "blur(0px)" }}
        transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      />

      {/* Terminal window */}
      <motion.div
        className="relative w-full h-full max-w-5xl max-h-[85vh] rounded-[2rem] overflow-hidden shadow-2xl border border-slate-700/50 flex flex-col bg-[#1E1E2E]"
        initial={false}
        animate={{
          scale: isOpen ? 1 : 0.98,
          y: isOpen ? 0 : 20,
          opacity: isOpen ? 1 : 0,
        }}
        transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#181825] border-b border-slate-700/50 relative z-20" onMouseDown={(e) => e.preventDefault()}>
          <div className="flex items-center gap-3">
            {/* Back arrow — return to home */}
            <button
              onClick={onClose}
              title="Back to home (⌘←)"
              className="p-1 -ml-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <StatusDot status={activeSession.status} size={8} />
            <span className="text-sm font-medium text-slate-200">
              {activeSession.name}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {activeSession.working_directory.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Tune button */}
            {activeSession.session_type !== "terminal" && (
              <button
                onClick={() => setTuningOpen((v) => !v)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  tuningOpen
                    ? "text-violet-300 bg-violet-500/20"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-700/50"
                }`}
                title="Session tuning (⌘,)"
              >
                Tune
              </button>
            )}

            {/* Catch me up button */}
            {showTimelineButton && (
              <button
                onClick={() => setTimelineOpen((v) => !v)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  timelineOpen
                    ? "text-slate-200 bg-slate-700/50"
                    : "text-slate-500 hover:text-slate-300 hover:bg-slate-700/50"
                }`}
                title="Catch me up (⌘.)"
              >
                Catch me up
              </button>
            )}

            {/* + Terminal link (when no companions yet) */}
            {!hasCompanions && (
              <button
                onClick={() => onAddCompanion(session.id)}
                className="px-2.5 py-1 rounded-md text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
                title="Add companion terminal (⌘T)"
              >
                + Terminal
              </button>
            )}

            {/* Actions menu */}
            <div className="relative">
              <button
                ref={menuBtnRef}
                onClick={() => setShowMenu((v) => !v)}
                className="px-2 py-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors text-sm"
                title="Session actions"
              >
                ⋯
              </button>
              {/* Portal to body so it escapes overflow-hidden on the terminal window */}
              {createPortal(
                <AnimatePresence>
                  {showMenu && menuPos && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
                    className="fixed min-w-[180px] rounded-lg bg-[#313244] border border-slate-600/50 shadow-xl py-1 z-[200]"
                    style={{ top: menuPos.top, left: menuPos.left }}
                  >
                    {/* Safe actions */}
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onRestart(session.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors flex items-center justify-between"
                    >
                      <span>Restart</span>
                      <span className="text-[10px] text-slate-500">⌘R</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onPark(session.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors flex items-center justify-between"
                    >
                      <span>Park</span>
                      <span className="text-[10px] text-slate-500">⌘P</span>
                    </button>
                    <div className="border-t border-slate-600/50 my-1" />
                    {/* Dangerous actions */}
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onEnd(session.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors flex items-center justify-between"
                    >
                      <span>End Session</span>
                      <span className="text-[10px] text-slate-500">⌘⇧E</span>
                    </button>
                    <div className="border-t border-slate-600/50 my-1" />
                    <button
                      onClick={() => {
                        setShowMenu(false);
                        onRemove(session.id);
                      }}
                      className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors"
                    >
                      Remove
                    </button>
                  </motion.div>
                )}
                </AnimatePresence>,
                document.body
              )}
            </div>
          </div>
        </div>

        {/* Tab bar — shown only when companions exist */}
        {hasCompanions && (
          <div className="flex items-center bg-[#181825] border-b border-slate-700/50 px-2 relative z-20" onMouseDown={(e) => e.preventDefault()}>
            {allTabs.map((tab, idx) => {
              const isActive = tab.id === activeTabId;
              const isCompanion = tab.id !== session.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`group relative flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                    isActive
                      ? "text-slate-200 border-b-2 border-indigo-400"
                      : "text-slate-500 hover:text-slate-300 border-b-2 border-transparent"
                  }`}
                  title={`⌘${idx + 1}`}
                >
                  <StatusDot status={tab.status} size={6} />
                  <span>{tab.name}</span>
                  {isCompanion && (
                    <span
                      onClick={(e) => handleCloseCompanionTab(e, tab.id)}
                      className="ml-1 text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ×
                    </span>
                  )}
                </button>
              );
            })}
            {/* Add tab button */}
            <button
              onClick={() => onAddCompanion(session.id)}
              className="px-2 py-1.5 text-xs text-slate-600 hover:text-slate-300 transition-colors"
              title="Add companion terminal (⌘T)"
            >
              +
            </button>
          </div>
        )}

        {/* Terminal panes + timeline overlay container */}
        <div className="flex-1 flex flex-col min-h-0 relative">
          {/* Terminal panes — all mounted, only active visible */}
          {allTabs.map((tab) => (
            <TerminalPane
              key={tab.id}
              ref={(handle) => {
                if (handle) {
                  paneRefs.current.set(tab.id, handle);
                } else {
                  paneRefs.current.delete(tab.id);
                }
              }}
              sessionId={tab.id}
              visible={tab.id === activeTabId && isOpen}
            />
          ))}

          {/* Tuning panel — slides up from bottom */}
          <AnimatePresence>
            {tuningOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.25, 0.8, 0.25, 1] }}
                  className="absolute inset-0 bg-black/50 z-10 backdrop-blur-[2px] pointer-events-auto"
                  onClick={() => setTuningOpen(false)}
                />
                <motion.div
                  initial={{ y: "100%", opacity: 0.5 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "100%", opacity: 0 }}
                  transition={{
                    y: { duration: 0.4, ease: [0.25, 0.8, 0.25, 1] },
                    opacity: { duration: 0.25, ease: "easeOut" },
                  }}
                  className="absolute inset-x-0 bottom-0 z-20 h-[80%] overflow-hidden rounded-t-2xl"
                >
                  <TuningPanel
                    sessionId={activeSession.id}
                    sessionType={activeSession.session_type}
                    onDismiss={() => setTuningOpen(false)}
                    onRestart={() => {
                      setTuningOpen(false);
                      onRestart(session.id);
                    }}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Timeline pull-down overlay — slides down over terminal */}
          <AnimatePresence>
            {timelineOpen && (
              <>
                {/* Dim layer over terminal — captures clicks to dismiss, blocks terminal interaction */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.25, 0.8, 0.25, 1] }}
                  className="absolute inset-0 bg-black/50 z-10 backdrop-blur-[2px] pointer-events-auto"
                  onClick={() => setTimelineOpen(false)}
                />

                {/* Timeline content — slides down from top, fades on exit */}
                <motion.div
                  initial={{ y: "-100%", opacity: 0.5 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: "-100%", opacity: 0 }}
                  transition={{
                    y: { duration: 0.4, ease: [0.25, 0.8, 0.25, 1] },
                    opacity: { duration: 0.25, ease: "easeOut" },
                  }}
                  className="absolute inset-x-0 top-0 z-20 h-[75%] overflow-hidden rounded-b-2xl"
                >
                  <SessionTimeline
                    sessionId={activeSession.id}
                    isOpen={timelineOpen}
                    onDismiss={() => setTimelineOpen(false)}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
