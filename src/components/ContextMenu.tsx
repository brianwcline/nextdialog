import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ContextMenuItem {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  shortcut?: string;
  dividerAfter?: boolean;
}

interface ContextMenuProps {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({
  isOpen,
  x,
  y,
  items,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.1 }}
          className="fixed z-[100] min-w-[160px] rounded-lg bg-white/90 backdrop-blur-xl shadow-xl border border-slate-200/60 py-1 overflow-hidden"
          style={{ left: x, top: y }}
        >
          {items.map((item, idx) => (
            <div key={item.label}>
              <button
                onClick={() => {
                  item.onClick();
                  onClose();
                }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center justify-between gap-4 ${
                  item.variant === "danger"
                    ? "text-red-600 hover:bg-red-50"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="text-xs text-slate-400 ml-auto">{item.shortcut}</span>
                )}
              </button>
              {item.dividerAfter && idx < items.length - 1 && (
                <div className="border-t border-slate-200/60 my-1" />
              )}
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
