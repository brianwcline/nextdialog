import { useRef, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTerminal } from "../hooks/useTerminal";
import { StatusDot } from "./StatusDot";
import type { Session } from "../lib/types";
import "@xterm/xterm/css/xterm.css";

interface TerminalOverlayProps {
  session: Session;
  isOpen: boolean;
  onClose: () => void;
  onEnd: (id: string) => void;
  onRestart: (id: string) => void;
  onRemove: (id: string) => void;
}

export function TerminalOverlay({
  session,
  isOpen,
  onClose,
  onEnd,
  onRestart,
  onRemove,
}: TerminalOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { focus } = useTerminal({
    sessionId: session.id,
    containerRef,
    visible: isOpen,
  });

  const isStopped = session.status === "stopped";

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(focus, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, focus]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showMenu) {
          setShowMenu(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, showMenu]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [showMenu]);

  // Drag-drop file handling
  useEffect(() => {
    if (!isOpen) return;

    const webview = getCurrentWebviewWindow();
    const unlistenPromise = webview.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (paths.length > 0) {
          const pathStr = paths.join(" ");
          invoke("write_to_pty", {
            id: session.id,
            data: pathStr,
          }).catch(console.error);
        }
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [isOpen, session.id]);

  // Always render, but hide when not open — preserves xterm DOM and scrollback
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{
        visibility: isOpen ? "visible" : "hidden",
        pointerEvents: isOpen ? "auto" : "none",
        opacity: isOpen ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/10 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Terminal window */}
      <div
        className="relative w-full h-full max-w-5xl max-h-[85vh] rounded-2xl overflow-hidden shadow-2xl border border-slate-700/50 flex flex-col bg-[#1E1E2E]"
        style={{
          transform: isOpen ? "scale(1) translateY(0)" : "scale(0.95) translateY(10px)",
          transition: "transform 0.2s ease",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#181825] border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <StatusDot status={session.status} size={8} />
            <span className="text-sm font-medium text-slate-200">
              {session.name}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {session.working_directory.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Restart */}
            <button
              onClick={() => onRestart(session.id)}
              title="Restart session"
              className="px-2.5 py-1 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition-colors"
            >
              Restart
            </button>

            {/* End / Start toggle */}
            {isStopped ? (
              <button
                onClick={() => onRestart(session.id)}
                title="Start session"
                className="px-2.5 py-1 rounded-md text-xs text-green-400 hover:text-green-300 hover:bg-green-900/30 transition-colors"
              >
                Start
              </button>
            ) : (
              <button
                onClick={() => onEnd(session.id)}
                title="End session"
                className="px-2.5 py-1 rounded-md text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 transition-colors"
              >
                End
              </button>
            )}

            {/* More menu */}
            <div className="relative" ref={menuRef}>
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
                      onRestart(session.id);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors"
                  >
                    Restart
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onEnd(session.id);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-600/50 transition-colors"
                  >
                    End Session
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
                </div>
              )}
            </div>

            {/* Close overlay (hide, don't kill) */}
            <button
              onClick={onClose}
              title="Close overlay (session keeps running)"
              className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none px-2 ml-1"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Terminal container */}
        <div ref={containerRef} className="flex-1 p-1" />
      </div>
    </div>
  );
}
