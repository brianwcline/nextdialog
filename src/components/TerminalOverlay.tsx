import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TerminalPane } from "./TerminalPane";
import { StatusDot } from "./StatusDot";
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
  onAddCompanion,
  onRemoveCompanion,
}: TerminalOverlayProps) {
  const [activeTabId, setActiveTabId] = useState(session.id);
  const [showMenu, setShowMenu] = useState(false);

  const allTabs = [session, ...companions];
  const activeSession = allTabs.find((t) => t.id === activeTabId) ?? session;
  const isStopped = activeSession.status === "stopped";

  // Reset to primary tab if active tab was removed
  useEffect(() => {
    if (!allTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(session.id);
    }
  }, [allTabs, activeTabId, session.id]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showMenu) {
          setShowMenu(false);
        } else {
          onClose();
        }
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
  }, [isOpen, onClose, showMenu, session, companions, activeTabId, onAddCompanion, onRemoveCompanion]);

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

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      initial={false}
      animate={{
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? "auto" : "none",
      }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      style={{ visibility: isOpen ? "visible" : "hidden" }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/10"
        initial={false}
        animate={{ backdropFilter: isOpen ? "blur(8px)" : "blur(0px)" }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        onClick={onClose}
      />

      {/* Terminal window */}
      <motion.div
        className="relative w-full h-full max-w-5xl max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl border border-slate-700/50 flex flex-col bg-[#1E1E2E]"
        initial={false}
        animate={{ scale: isOpen ? 1 : 0.97, y: isOpen ? 0 : 10 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#181825] border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <StatusDot status={activeSession.status} size={8} />
            <span className="text-sm font-medium text-slate-200">
              {activeSession.name}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {activeSession.working_directory.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
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

            <div className="w-px h-4 bg-slate-700/50 mx-1" />

            {/* Restart */}
            <button
              onClick={() => onRestart(activeTabId)}
              title="Restart session"
              className="px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
            >
              Restart
            </button>

            {/* End / Start toggle */}
            {isStopped ? (
              <button
                onClick={() => onRestart(activeTabId)}
                title="Start session"
                className="px-2.5 py-1 rounded-md text-xs text-green-400 hover:text-green-300 hover:bg-green-900/30 transition-colors"
              >
                Start
              </button>
            ) : (
              <button
                onClick={() => onEnd(activeTabId)}
                title="End session"
                className="px-2.5 py-1 rounded-md text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
              >
                End
              </button>
            )}

            {/* More menu */}
            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="px-2 py-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors text-sm"
                title="More actions"
              >
                ...
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 min-w-[140px] rounded-lg bg-[#313244] border border-slate-600/50 shadow-xl py-1 z-10">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onRestart(activeTabId);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors"
                  >
                    Restart
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onEnd(activeTabId);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors"
                  >
                    End Session
                  </button>
                  <div className="border-t border-slate-600/50 my-1" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onRemove(activeTabId);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            {/* Close overlay */}
            <button
              onClick={onClose}
              title="Close overlay (session keeps running)"
              className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none px-2 ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab bar — shown only when companions exist */}
        {hasCompanions && (
          <div className="flex items-center bg-[#181825] border-b border-slate-700/50 px-2">
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

        {/* Terminal panes — all mounted, only active visible */}
        <div className="flex-1 flex flex-col min-h-0">
          {allTabs.map((tab) => (
            <TerminalPane
              key={tab.id}
              sessionId={tab.id}
              visible={tab.id === activeTabId && isOpen}
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
