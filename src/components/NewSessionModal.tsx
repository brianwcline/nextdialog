import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { open } from "@tauri-apps/plugin-dialog";
import { Toggle } from "./Toggle";
import type { RecentSession } from "../lib/recentSessions";

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function abbreviateDirectory(dir: string): string {
  const home = "/Users/";
  if (dir.startsWith(home)) {
    const rest = dir.slice(home.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx !== -1) return "~" + rest.slice(slashIdx);
    return "~";
  }
  return dir;
}

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (params: {
    name: string;
    working_directory: string;
    skip_permissions: boolean;
    initial_prompt?: string;
  }) => Promise<void>;
  defaultDirectory?: string;
  recentSessions?: RecentSession[];
  onReopenRecent?: (session: RecentSession) => void;
}

export function NewSessionModal({
  isOpen,
  onClose,
  onCreate,
  defaultDirectory,
  recentSessions = [],
  onReopenRecent,
}: NewSessionModalProps) {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState(defaultDirectory ?? "");
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const hasPrevious = recentSessions.length > 0;

  const filteredSessions = useMemo(() => {
    if (!filter.trim()) return recentSessions;
    const q = filter.toLowerCase();
    return recentSessions.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.working_directory.toLowerCase().includes(q),
    );
  }, [recentSessions, filter]);

  const handlePickDirectory = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      setDirectory(selected as string);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!directory.trim()) {
      setError("Working directory is required");
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        working_directory: directory.trim(),
        skip_permissions: skipPermissions,
        initial_prompt: initialPrompt.trim() || undefined,
      });
      // Reset form
      setName("");
      setDirectory(defaultDirectory ?? "");
      setSkipPermissions(false);
      setInitialPrompt("");
      setFilter("");
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const createForm = (
    <form onSubmit={handleSubmit} className="space-y-4">
      {hasPrevious && (
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
          Create New
        </h3>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. API Refactor"
          autoFocus
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">
          Working Directory
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="/path/to/project"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={handlePickDirectory}
            className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 transition-colors"
          >
            Browse
          </button>
        </div>
      </div>

      <Toggle
        checked={skipPermissions}
        onChange={setSkipPermissions}
        label="Skip permission prompts"
      />

      <div>
        <label className="block text-sm font-medium text-slate-600 mb-1">
          Initial Prompt{" "}
          <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={initialPrompt}
          onChange={(e) => setInitialPrompt(e.target.value)}
          placeholder="What should Claude start working on?"
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400 resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-5 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50 shadow-md"
        >
          {isSubmitting ? "Creating..." : "Create Session"}
        </button>
      </div>
    </form>
  );

  const previousPanel = hasPrevious ? (
    <div className="flex flex-col min-h-0">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Resume Previous
      </h3>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter sessions..."
        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400 mb-3"
      />
      <div className="overflow-y-auto max-h-[400px] -mr-2 pr-2 space-y-1">
        {filteredSessions.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">
            No matching sessions
          </p>
        ) : (
          filteredSessions.map((session, idx) => (
            <button
              key={`${session.name}-${session.working_directory}-${idx}`}
              type="button"
              onClick={() => onReopenRecent?.(session)}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-100/80 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700 truncate">
                  {session.name}
                </span>
                <span className="text-xs text-slate-400 ml-2 shrink-0">
                  {formatRelativeTime(session.last_active)}
                </span>
              </div>
              <div className="text-xs text-slate-400 font-mono truncate mt-0.5">
                {abbreviateDirectory(session.working_directory)}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  ) : null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full rounded-2xl bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl p-6 ${hasPrevious ? "max-w-3xl" : "max-w-md"}`}
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              New Session
            </h2>

            {hasPrevious ? (
              <div className="grid grid-cols-2 gap-6">
                <div>{createForm}</div>
                <div className="border-l border-slate-200 pl-6 min-h-0 flex flex-col">
                  {previousPanel}
                </div>
              </div>
            ) : (
              createForm
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
