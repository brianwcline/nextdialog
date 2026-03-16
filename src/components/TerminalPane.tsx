import { useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTerminal } from "../hooks/useTerminal";

export interface TerminalPaneHandle {
  scrollToBottom: () => void;
}

interface TerminalPaneProps {
  sessionId: string;
  visible: boolean;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane({ sessionId, visible }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { focus, showScrollIndicator, scrollToBottom } = useTerminal({
      sessionId,
      containerRef,
      visible,
    });

    useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

    useEffect(() => {
      if (visible) {
        const timer = setTimeout(focus, 100);
        return () => clearTimeout(timer);
      }
    }, [visible, focus]);

    return (
      <div
        className="relative flex-1 min-h-0 overflow-hidden p-1"
        style={{ display: visible ? "block" : "none" }}
        onClick={() => focus()}
      >
        <div ref={containerRef} className="h-full" />

        <AnimatePresence>
          {visible && showScrollIndicator && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: [0.25, 0.8, 0.25, 1] }}
              onClick={(e) => {
                e.stopPropagation();
                scrollToBottom();
              }}
              className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#313244]/90 backdrop-blur-sm text-slate-300 hover:bg-[#45475A] transition-colors text-xs shadow-lg border border-slate-600/30"
            >
              <span>New output</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className="text-slate-400"
              >
                <path
                  d="M6 2.5v7M3 7l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    );
  },
);
