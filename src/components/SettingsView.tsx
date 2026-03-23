import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Toggle } from "./Toggle";
import { SessionTypeIcon } from "./SessionTypeIcon";
import { ConfigureModal } from "./ConfigureModal";
import type { SessionType } from "../lib/types";
import { defaultAgentConfig } from "../lib/types";

interface Settings {
  default_directory: string;
  default_skip_permissions: boolean;
  intelligence_enabled: boolean;
  intelligence_provider: string;
  intelligence_api_key: string;
  intelligence_api_url: string;
  machine_id: string;
  telemetry_enabled: boolean;
  hooks_enabled: boolean;
  hook_port_start: number;
  hook_port_end: number;
  background_mode: string;
  background_image_path: string;
}

interface SettingsViewProps {
  isOpen: boolean;
  onClose: () => void;
  sessionTypes?: SessionType[];
  onUpdateType?: (sessionType: SessionType) => Promise<unknown>;
  onCreateType?: (sessionType: SessionType) => Promise<unknown>;
  onDeleteType?: (id: string) => Promise<void>;
  backgroundMode?: string;
  onBackgroundChange?: (mode: string, imageUrl: string | null) => void;
}

export function SettingsView({
  isOpen,
  onClose,
  sessionTypes = [],
  onUpdateType,
  onCreateType,
  onDeleteType,
  backgroundMode = "gradient",
  onBackgroundChange,
}: SettingsViewProps) {
  const [settings, setSettings] = useState<Settings>({
    default_directory: "",
    default_skip_permissions: false,
    intelligence_enabled: false,
    intelligence_provider: "",
    intelligence_api_key: "",
    intelligence_api_url: "",
    machine_id: "",
    telemetry_enabled: false,
    hooks_enabled: true,
    hook_port_start: 7432,
    hook_port_end: 7499,
    background_mode: "gradient",
    background_image_path: "",
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [configureType, setConfigureType] = useState<SessionType | null>(null);
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newIcon, setNewIcon] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      invoke<Settings>("get_settings")
        .then((s) => {
          setSettings(s);
          // Load preview thumbnail if custom background is active
          if (s.background_mode === "image" && s.background_image_path) {
            invoke<string | null>("get_background_image_data").then((dataUrl) => {
              setBgPreviewUrl(dataUrl ?? null);
            });
          } else {
            setBgPreviewUrl(null);
          }
        })
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
      agent_config: { ...defaultAgentConfig },
    });

    setNewName("");
    setNewCommand("");
    setNewIcon("");
    setNewColor("#6366f1");
    setShowAddForm(false);
  };

  return (
    <>
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
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ duration: 0.4, ease: [0.25, 0.8, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl glass-modal shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
          >
            <h2 className="text-lg font-semibold text-slate-800 mb-5">
              Settings
            </h2>

            <div className="space-y-5">
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
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
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

              {/* Appearance */}
              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">
                  Appearance
                </h3>
                <div className="flex items-center gap-3">
                  {/* Preview thumbnail */}
                  <div className="w-16 h-10 rounded-md overflow-hidden border border-slate-200 bg-gradient-to-br from-orange-100 via-rose-50 to-violet-100 shrink-0">
                    {bgPreviewUrl && backgroundMode === "image" && (
                      <img
                        src={bgPreviewUrl}
                        alt="Background preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const selected = await open({
                          multiple: false,
                          filters: [
                            {
                              name: "Images",
                              extensions: ["jpg", "jpeg", "png", "webp"],
                            },
                          ],
                        });
                        if (selected) {
                          try {
                            const dataUrl = await invoke<string>(
                              "import_background_image",
                              { sourcePath: selected as string },
                            );
                            setBgPreviewUrl(dataUrl);
                            onBackgroundChange?.("image", dataUrl);
                          } catch (err) {
                            console.error("Failed to import background:", err);
                          }
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-xs hover:bg-slate-200 transition-colors"
                    >
                      Choose Image...
                    </button>
                    {backgroundMode === "image" && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await invoke("reset_background");
                            setBgPreviewUrl(null);
                            onBackgroundChange?.("gradient", null);
                          } catch (err) {
                            console.error("Failed to reset background:", err);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg text-slate-400 text-xs hover:text-slate-600 transition-colors"
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>
                </div>
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
                        <SessionTypeIcon id={st.id} icon={st.icon} color="#94a3b8" />
                        <span className="text-sm text-slate-700 truncate">
                          {st.name}
                        </span>
                        {st.builtin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 shrink-0">
                            built-in
                          </span>
                        )}
                        {st.available === false && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-400 shrink-0">
                            not found
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
                        <button
                          type="button"
                          onClick={() => setConfigureType(st)}
                          className="text-slate-300 hover:text-violet-400 transition-colors"
                          title="Configure"
                        >
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="8" cy="8" r="2.5" />
                            <path d="M6.83 2.17a.5.5 0 0 1 .49-.4h1.36a.5.5 0 0 1 .49.4l.2 1.1a4.5 4.5 0 0 1 1.09.63l1.05-.35a.5.5 0 0 1 .58.2l.68 1.18a.5.5 0 0 1-.1.6l-.85.75a4.5 4.5 0 0 1 0 1.24l.85.75a.5.5 0 0 1 .1.6l-.68 1.18a.5.5 0 0 1-.58.2l-1.05-.35a4.5 4.5 0 0 1-1.09.63l-.2 1.1a.5.5 0 0 1-.49.4H7.32a.5.5 0 0 1-.49-.4l-.2-1.1a4.5 4.5 0 0 1-1.09-.63l-1.05.35a.5.5 0 0 1-.58-.2l-.68-1.18a.5.5 0 0 1 .1-.6l.85-.75a4.5 4.5 0 0 1 0-1.24l-.85-.75a.5.5 0 0 1-.1-.6l.68-1.18a.5.5 0 0 1 .58-.2l1.05.35a4.5 4.5 0 0 1 1.09-.63l.2-1.1Z" />
                          </svg>
                        </button>
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
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
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
                        className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
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
                          className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-sm text-center focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
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
                        className="px-3 py-1.5 text-xs bg-violet-400 text-white rounded-md hover:bg-violet-500 transition-colors disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="mt-2 text-sm text-violet-400 hover:text-violet-500 transition-colors"
                  >
                    + Add custom type...
                  </button>
                )}
              </div>

              {/* NextDialog Intelligence — hidden until feature is rethought */}

              {/* Telemetry */}
              <div className="border-t border-slate-200 pt-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">
                  Usage Data
                </h3>
                <Toggle
                  checked={settings.telemetry_enabled}
                  onChange={(v) => save({ telemetry_enabled: v })}
                  label="Share anonymous usage data"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Helps improve NextDialog. No personal data is collected.
                </p>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-violet-400 text-white text-sm font-medium hover:bg-violet-500 transition-colors shadow-md"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {configureType && (
      <ConfigureModal
        isOpen={configureType !== null}
        onClose={() => setConfigureType(null)}
        sessionType={configureType}
        onSave={async (updated) => {
          await onUpdateType?.(updated);
          setConfigureType(null);
        }}
        skipPermissions={settings.default_skip_permissions}
        onSkipPermissionsChange={(v) => save({ default_skip_permissions: v })}
        hooksEnabled={settings.hooks_enabled}
        onHooksEnabledChange={(v) => save({ hooks_enabled: v })}
      />
    )}
    </>
  );
}
