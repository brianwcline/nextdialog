import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { trackEvent } from "../lib/telemetry";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = ["bug", "feature", "general"] as const;

export function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<string>("medium");
  const [category, setCategory] = useState<string>("general");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      await invoke("submit_feedback", {
        text: text.trim(),
        severity,
        category,
        appState: null,
      });
      trackEvent("feedback.submitted", "feedback", { severity, category });
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        setText("");
        setSeverity("medium");
        setCategory("general");
        onClose();
      }, 1200);
    } catch (err) {
      console.error("Failed to submit feedback:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    setText("");
    setSeverity("medium");
    setCategory("general");
    setSubmitted(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl glass-modal shadow-2xl p-6"
          >
            {submitted ? (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center justify-center py-8 gap-3"
              >
                <div className="text-3xl">&#10003;</div>
                <p className="text-sm text-slate-600 font-medium">
                  Thanks for your feedback!
                </p>
              </motion.div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-800 mb-4">
                  Send Feedback
                </h2>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="What's on your mind?"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                  autoFocus
                />

                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-500 mb-2">
                    Severity
                  </label>
                  <div className="flex gap-2">
                    {SEVERITIES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSeverity(s)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          severity === s
                            ? "bg-indigo-500 text-white"
                            : "bg-white/50 text-slate-600 hover:bg-white/70"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-medium text-slate-500 mb-2">
                    Category
                  </label>
                  <div className="flex gap-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCategory(c)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          category === c
                            ? "bg-indigo-500 text-white"
                            : "bg-white/50 text-slate-600 hover:bg-white/70"
                        }`}
                      >
                        {c === "bug" ? "Bug" : c === "feature" ? "Feature Request" : "General"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!text.trim() || submitting}
                    className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors shadow-md disabled:opacity-50"
                  >
                    {submitting ? "Sending..." : "Send"}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
