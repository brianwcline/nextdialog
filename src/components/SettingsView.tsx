import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Toggle } from "./Toggle";
import { SessionTypeIcon } from "./SessionTypeIcon";
import type { SessionType } from "../lib/types";

interface Settings {
  notifications_enabled: boolean;
  default_directory: string;
  default_skip_permissions: boolean;
  sounds_enabled: boolean;
  sound_volume: number;
  intelligence_enabled: boolean;
  intelligence_provider: string;
  intelligence_api_key: string;
  intelligence_api_url: string;
}

interface SettingsViewProps {
  isOpen: boolean;
  onClose: () => void;
  sessionTypes?: SessionType[];
  onUpdateType?: (sessionType: SessionType) => Promise<unknown>;
  onCreateType?: (sessionType: SessionType) => Promise<unknown>;
  onDeleteType?: (id: string) => Promise<void>;
}

export function SettingsView({
  isOpen,
  onClose,
  sessionTypes = [],
  onUpdateType,
  onCreateType,
  onDeleteType,
}: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings>({
    notifications_enabled: true,
    default_directory: "",
    default_skip_permissions: false,
    sounds_enabled: false,
    sound_volume: 0.5,
    intelligence_enabled: false,
    intelligence_provider: "",
    intelligence_api_key: "",
    intelligence_api_url: "",
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      invoke<Settings>("get_settings")
        .then(setSettings)
        .catch(console.error);
      setShowAddForm(false);
    }
  }, [isOpen]);

  const save = async (updates: Partial<Settings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    await invoke("save_settings", { settings: updated }).catch(console.error);
  };

  const handleToggleType = async (st: SessionType) => {
    await onUpdateType?.({ ...st, enabled: !st.enabled });
  };

  const handleAddType = async () => {
    if (!newName.trim() || !newCommand.trim()) return;

    const id = newName.trim().toLowerCase().replace(/\s+/g, "-");
    // Split command to extract args
    const parts = newCommand.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    await onCreateType?.({
      id,
      name: newName.trim(),
      command,
      args,
      icon: newIcon || "~",
      color: newColor,
      env: {},
      status_patterns: {},
      builtin: false,
      enabled: true,
    });

    setNewName("");
    setNewCommand("");
    setNewIcon("");
    setNewColor("#6366f1");
    setShowAddForm(false);
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
            className="w-full max-w-lg rounded-2xl bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
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

              <div className="border-t border-slate-200 pt-4">
                <Toggle
                  checked={settings.sounds_enabled}
                  onChange={(v) => save({ sounds_enabled: v })}
                  label="Sound effects"
                />

                {settings.sounds_enabled && (
                  <div className="mt-3">
                    <label className="block text-sm font-medium text-slate-600 mb-1">
                      Volume
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.1}
                      value={settings.sound_volume}
                      onChange={(e) =>
                        save({ sound_volume: parseFloat(e.target.value) })
                      }
                      className="w-full accent-indigo-500"
                    />
                  </div>
                )}
              </div>

              {/* Session Types */}
              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">
                  Session Types
                </h3>
                <div className="space-y-2">
                  {sessionTypes.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/40"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <SessionTypeIcon icon={st.icon} color={st.color} />
                        <span className="text-sm text-slate-700 truncate">
                          {st.name}
                        </span>
                        {st.builtin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 shrink-0">
                            built-in
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!st.builtin && onDeleteType && (
                          <button
                            type="button"
                            onClick={() => onDeleteType(st.id)}
                            className="text-xs text-red-400 hover:text-red-600 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                        <Toggle
                          checked={st.enabled}
                          onChange={() => handleToggleType(st)}
                          label=""
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {showAddForm ? (
                  <div className="mt-3 p-3 rounded-lg bg-white/40 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="My Agent"
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Command
                      </label>
                      <input
                        type="text"
                        value={newCommand}
                        onChange={(e) => setNewCommand(e.target.value)}
                        placeholder="e.g. openclaw tui"
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                      />
                    </div>
                    <div className="flex gap-3">
                      <div className="w-20">
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          Icon
                        </label>
                        <input
                          type="text"
                          value={newIcon}
                          onChange={(e) => setNewIcon(e.target.value)}
                          placeholder="~"
                          maxLength={2}
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          Color
                        </label>
                        <input
                          type="color"
                          value={newColor}
                          onChange={(e) => setNewColor(e.target.value)}
                          className="w-10 h-8 rounded border border-slate-200 cursor-pointer"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddType}
                        disabled={!newName.trim() || !newCommand.trim()}
                        className="px-3 py-1.5 text-xs bg-indigo-500 text-white rounded-md hover:bg-indigo-600 transition-colors disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="mt-2 text-sm text-indigo-500 hover:text-indigo-600 transition-colors"
                  >
                    + Add custom type...
                  </button>
                )}
              </div>

              {/* NextDialog Intelligence */}
              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">
                  NextDialog Intelligence
                </h3>
                <Toggle
                  checked={settings.intelligence_enabled}
                  onChange={(v) => save({ intelligence_enabled: v })}
                  label="Enable NextDialog Intelligence"
                />

                {settings.intelligence_enabled && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        Provider
                      </label>
                      <select
                        value={settings.intelligence_provider}
                        onChange={(e) =>
                          save({ intelligence_provider: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      >
                        <option value="">Select a provider...</option>
                        <option value="anthropic">Anthropic</option>
                        <option value="openai">OpenAI</option>
                        <option value="gemini">Gemini</option>
                        <option value="ollama">Ollama</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        API Key
                      </label>
                      <div className="flex gap-2">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={settings.intelligence_api_key}
                          onChange={(e) =>
                            save({ intelligence_api_key: e.target.value })
                          }
                          placeholder="sk-..."
                          className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="px-3 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-slate-200 transition-colors"
                        >
                          {showApiKey ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>

                    {settings.intelligence_provider === "ollama" && (
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">
                          API URL
                        </label>
                        <input
                          type="text"
                          value={settings.intelligence_api_url}
                          onChange={(e) =>
                            save({ intelligence_api_url: e.target.value })
                          }
                          placeholder="http://localhost:11434"
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400"
                        />
                      </div>
                    )}
                  </div>
                )}
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
