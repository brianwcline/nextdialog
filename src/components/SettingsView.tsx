import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Toggle } from "./Toggle";

interface Settings {
  notifications_enabled: boolean;
  default_directory: string;
  default_skip_permissions: boolean;
}

interface SettingsViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsView({ isOpen, onClose }: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings>({
    notifications_enabled: true,
    default_directory: "",
    default_skip_permissions: false,
  });

  useEffect(() => {
    if (isOpen) {
      invoke<Settings>("get_settings")
        .then(setSettings)
        .catch(console.error);
    }
  }, [isOpen]);

  const save = async (updates: Partial<Settings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    await invoke("save_settings", { settings: updated }).catch(console.error);
  };

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
            className="w-full max-w-md rounded-2xl bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl p-6"
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-5">
              Settings
            </h2>

            <div className="space-y-5">
              <Toggle
                checked={settings.notifications_enabled}
                onChange={(v) => save({ notifications_enabled: v })}
                label="Enable notifications"
              />

              <Toggle
                checked={settings.default_skip_permissions}
                onChange={(v) => save({ default_skip_permissions: v })}
                label="Skip permissions by default"
              />

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Default Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={settings.default_directory}
                    onChange={(e) =>
                      save({ default_directory: e.target.value })
                    }
                    placeholder="~/projects"
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const selected = await open({
                        directory: true,
                        multiple: false,
                      });
                      if (selected) {
                        save({ default_directory: selected as string });
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200 transition-colors"
                  >
                    Browse
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors shadow-md"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
