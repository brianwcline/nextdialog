import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Session } from "../lib/types";

interface GroupPickerModalProps {
  /** Session being moved; the modal is open while this is non-null. */
  session: Session | null;
  /** Groups already in use, in display order. */
  existingGroups: string[];
  onPick: (group: string | null) => void;
  onClose: () => void;
}

/** Longest group name accepted; the backend caps at the same length. */
const MAX_GROUP_NAME_CHARS = 40;

/** Choose an existing group, name a new one, or remove the session from its group. */
export function GroupPickerModal({
  session,
  existingGroups,
  onPick,
  onClose,
}: GroupPickerModalProps) {
  const [newGroupName, setNewGroupName] = useState("");

  // Fresh input each time the modal opens for a session.
  useEffect(() => {
    setNewGroupName("");
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    // Capture phase + stopPropagation: Escape closes only this modal, not the
    // terminal overlay or the home view's focus underneath it.
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [session, onClose]);

  const trimmedName = newGroupName.trim();

  return (
    <AnimatePresence>
      {session && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl glass-modal shadow-2xl p-6"
          >
            <h2 className="text-lg font-semibold text-slate-800">Move to group</h2>
            <p className="text-xs text-slate-500 mt-1 mb-4 truncate">{session.name}</p>

            {existingGroups.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {existingGroups.map((group) => {
                  const isCurrent = session.group === group;
                  return (
                    <button
                      key={group}
                      type="button"
                      disabled={isCurrent}
                      onClick={() => onPick(group)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                        isCurrent
                          ? "bg-violet-100 text-violet-700 cursor-default"
                          : "bg-white/60 text-slate-600 border border-slate-200 hover:bg-white"
                      }`}
                    >
                      {group}
                    </button>
                  );
                })}
              </div>
            )}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (trimmedName) onPick(trimmedName);
              }}
            >
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                maxLength={MAX_GROUP_NAME_CHARS}
                placeholder="New group name"
                aria-label="New group name"
                autoFocus
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={!trimmedName}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-white disabled:opacity-40 hover:bg-slate-700 transition-colors"
              >
                Add
              </button>
            </form>

            <div className="flex justify-between items-center mt-5">
              {session.group ? (
                <button
                  type="button"
                  onClick={() => onPick(null)}
                  className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Remove from “{session.group}”
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
