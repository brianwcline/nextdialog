import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toggle } from "./Toggle";
import { SessionTypeIcon } from "./SessionTypeIcon";
import type { SessionType, AgentConfig } from "../lib/types";
import { defaultAgentConfig } from "../lib/types";

interface ConfigureModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionType: SessionType;
  onSave: (updated: SessionType) => Promise<unknown>;
  // Global Claude Code settings (passed through from SettingsView)
  skipPermissions?: boolean;
  onSkipPermissionsChange?: (v: boolean) => void;
  hooksEnabled?: boolean;
  onHooksEnabledChange?: (v: boolean) => void;
}

const PERMISSION_MODES = [
  { value: "", label: "Default" },
  { value: "acceptEdits", label: "Accept Edits" },
  { value: "plan", label: "Plan Mode" },
  { value: "bypassPermissions", label: "Bypass Permissions" },
];

export function ConfigureModal({
  isOpen,
  onClose,
  sessionType,
  onSave,
  skipPermissions,
  onSkipPermissionsChange,
  hooksEnabled,
  onHooksEnabledChange,
}: ConfigureModalProps) {
  const [config, setConfig] = useState<AgentConfig>({ ...defaultAgentConfig });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Tag input state
  const [allowedToolInput, setAllowedToolInput] = useState("");
  const [disallowedToolInput, setDisallowedToolInput] = useState("");
  const [addDirInput, setAddDirInput] = useState("");
  const [envKeyInput, setEnvKeyInput] = useState("");
  const [envValInput, setEnvValInput] = useState("");

  useEffect(() => {
    if (isOpen && sessionType) {
      setConfig({
        ...defaultAgentConfig,
        ...sessionType.agent_config,
        // Ensure arrays/objects are new refs
        allowed_tools: [...(sessionType.agent_config?.allowed_tools ?? [])],
        disallowed_tools: [
          ...(sessionType.agent_config?.disallowed_tools ?? []),
        ],
        additional_dirs: [...(sessionType.agent_config?.additional_dirs ?? [])],
        custom_args: [...(sessionType.agent_config?.custom_args ?? [])],
        custom_env: { ...(sessionType.agent_config?.custom_env ?? {}) },
      });
      setShowAdvanced(false);
    }
  }, [isOpen, sessionType]);

  const isClaude = sessionType?.id === "claude-code";

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...sessionType, agent_config: config });
    } finally {
      setSaving(false);
    }
  };

  const addTag = (
    field: "allowed_tools" | "disallowed_tools" | "additional_dirs",
    value: string,
    clearFn: (v: string) => void
  ) => {
    const trimmed = value.trim();
    if (!trimmed || config[field].includes(trimmed)) return;
    setConfig({ ...config, [field]: [...config[field], trimmed] });
    clearFn("");
  };

  const removeTag = (
    field: "allowed_tools" | "disallowed_tools" | "additional_dirs",
    index: number
  ) => {
    setConfig({
      ...config,
      [field]: config[field].filter((_, i) => i !== index),
    });
  };

  const addEnvVar = () => {
    const key = envKeyInput.trim();
    const val = envValInput.trim();
    if (!key) return;
    setConfig({
      ...config,
      custom_env: { ...config.custom_env, [key]: val },
    });
    setEnvKeyInput("");
    setEnvValInput("");
  };

  const removeEnvVar = (key: string) => {
    const next = { ...config.custom_env };
    delete next[key];
    setConfig({ ...config, custom_env: next });
  };

  const inputClass =
    "w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400";
  const selectClass =
    "w-full px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 appearance-none bg-[length:16px_16px] bg-[position:right_10px_center] bg-no-repeat pr-9"
    + ` bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%2394a3b8' d='M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z'/%3E%3C/svg%3E")]`;
  const selectInlineClass =
    "px-3 py-2 rounded-lg border border-slate-200 bg-white/60 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 appearance-none bg-[length:16px_16px] bg-[position:right_8px_center] bg-no-repeat pr-8"
    + ` bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%2394a3b8' d='M4.427 6.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 6H4.604a.25.25 0 00-.177.427z'/%3E%3C/svg%3E")]`;
  const labelClass = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-sm"
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
            {/* Header */}
            <div className="flex items-center gap-2 mb-5">
              <SessionTypeIcon
                id={sessionType?.id ?? ""}
                icon={sessionType?.icon ?? ""}
                color={sessionType?.color ?? "#94a3b8"}
              />
              <h2 className="text-lg font-semibold text-slate-800">
                Configure {sessionType?.name}
              </h2>
            </div>

            <div className="space-y-4">
              {/* === Basic Settings (Claude-specific) === */}
              {isClaude && (
                <>
                  {/* Skip Permissions */}
                  {onSkipPermissionsChange && (
                    <Toggle
                      checked={skipPermissions ?? false}
                      onChange={onSkipPermissionsChange}
                      label="Skip permissions by default"
                    />
                  )}

                  {/* HTTP Hooks */}
                  {onHooksEnabledChange && (
                    <div>
                      <Toggle
                        checked={hooksEnabled ?? false}
                        onChange={onHooksEnabledChange}
                        label="Enable HTTP hooks"
                      />
                      <p className="text-[10px] text-slate-400 mt-0.5 ml-[52px]">
                        Real-time status detection via Claude Code's hook API.
                      </p>
                    </div>
                  )}

                  {/* Permission Mode */}
                  <div>
                    <label className={labelClass}>Permission Mode</label>
                    <select
                      value={config.permission_mode ?? ""}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          permission_mode: e.target.value || undefined,
                        })
                      }
                      className={selectClass}
                    >
                      {PERMISSION_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Model */}
                  <div>
                    <label className={labelClass}>Model</label>
                    <input
                      type="text"
                      value={config.model ?? ""}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          model: e.target.value || undefined,
                        })
                      }
                      placeholder="sonnet, opus, haiku, or full model ID"
                      className={inputClass}
                    />
                  </div>

                  {/* Chrome */}
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-500">
                      Browser Automation
                    </label>
                    <select
                      value={
                        config.chrome_enabled === true
                          ? "on"
                          : config.chrome_enabled === false
                            ? "off"
                            : ""
                      }
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          chrome_enabled:
                            e.target.value === "on"
                              ? true
                              : e.target.value === "off"
                                ? false
                                : undefined,
                        })
                      }
                      className={selectInlineClass}
                    >
                      <option value="">Default</option>
                      <option value="on">Enabled</option>
                      <option value="off">Disabled</option>
                    </select>
                  </div>
                </>
              )}

              {/* === Advanced Settings === */}
              {isClaude && (
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-xs text-violet-400 hover:text-violet-500 transition-colors"
                >
                  {showAdvanced ? "Hide advanced" : "Show advanced"}
                </button>
              )}

              <AnimatePresence>
                {(showAdvanced || !isClaude) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.8, 0.25, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-4 border-t border-slate-200 pt-4">
                      {isClaude && (
                        <>
                          {/* System Prompt */}
                          <div>
                            <label className={labelClass}>
                              Append to System Prompt
                            </label>
                            <textarea
                              value={config.append_system_prompt ?? ""}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  append_system_prompt:
                                    e.target.value || undefined,
                                })
                              }
                              placeholder="Additional instructions appended to the system prompt..."
                              rows={3}
                              className={`${inputClass} resize-none`}
                            />
                          </div>

                          {/* Max Turns */}
                          <div>
                            <label className={labelClass}>Max Turns</label>
                            <input
                              type="number"
                              value={config.max_turns ?? ""}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  max_turns: e.target.value
                                    ? parseInt(e.target.value, 10)
                                    : undefined,
                                })
                              }
                              placeholder="Unlimited"
                              min={1}
                              className={inputClass}
                            />
                          </div>

                          {/* Verbose */}
                          <Toggle
                            checked={config.verbose}
                            onChange={(v) =>
                              setConfig({ ...config, verbose: v })
                            }
                            label="Verbose output"
                          />

                          {/* MCP Config */}
                          <div>
                            <label className={labelClass}>
                              MCP Config Path
                            </label>
                            <input
                              type="text"
                              value={config.mcp_config_path ?? ""}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  mcp_config_path:
                                    e.target.value || undefined,
                                })
                              }
                              placeholder="/path/to/mcp-config.json"
                              className={`${inputClass} font-mono`}
                            />
                          </div>

                          {/* Additional Directories */}
                          <div>
                            <label className={labelClass}>
                              Additional Directories
                            </label>
                            <TagInput
                              tags={config.additional_dirs}
                              inputValue={addDirInput}
                              onInputChange={setAddDirInput}
                              onAdd={() =>
                                addTag(
                                  "additional_dirs",
                                  addDirInput,
                                  setAddDirInput
                                )
                              }
                              onRemove={(i) =>
                                removeTag("additional_dirs", i)
                              }
                              placeholder="/path/to/dir"
                              mono
                            />
                          </div>

                          {/* Allowed Tools */}
                          <div>
                            <label className={labelClass}>Allowed Tools</label>
                            <TagInput
                              tags={config.allowed_tools}
                              inputValue={allowedToolInput}
                              onInputChange={setAllowedToolInput}
                              onAdd={() =>
                                addTag(
                                  "allowed_tools",
                                  allowedToolInput,
                                  setAllowedToolInput
                                )
                              }
                              onRemove={(i) =>
                                removeTag("allowed_tools", i)
                              }
                              placeholder="tool_name"
                              mono
                            />
                          </div>

                          {/* Disallowed Tools */}
                          <div>
                            <label className={labelClass}>
                              Disallowed Tools
                            </label>
                            <TagInput
                              tags={config.disallowed_tools}
                              inputValue={disallowedToolInput}
                              onInputChange={setDisallowedToolInput}
                              onAdd={() =>
                                addTag(
                                  "disallowed_tools",
                                  disallowedToolInput,
                                  setDisallowedToolInput
                                )
                              }
                              onRemove={(i) =>
                                removeTag("disallowed_tools", i)
                              }
                              placeholder="tool_name"
                              mono
                            />
                          </div>
                        </>
                      )}

                      {/* Environment Variables (generic) */}
                      <div>
                        <label className={labelClass}>
                          Environment Variables
                        </label>
                        <div className="space-y-1.5">
                          {Object.entries(config.custom_env).map(
                            ([key, val]) => (
                              <div
                                key={key}
                                className="flex items-center gap-1.5"
                              >
                                <span className="text-xs font-mono text-slate-600 bg-white/50 px-2 py-1 rounded">
                                  {key}={val}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeEnvVar(key)}
                                  className="text-xs text-red-400 hover:text-red-600"
                                >
                                  x
                                </button>
                              </div>
                            )
                          )}
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={envKeyInput}
                              onChange={(e) => setEnvKeyInput(e.target.value)}
                              placeholder="KEY"
                              className="flex-1 px-2 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
                              onKeyDown={(e) =>
                                e.key === "Enter" && addEnvVar()
                              }
                            />
                            <input
                              type="text"
                              value={envValInput}
                              onChange={(e) => setEnvValInput(e.target.value)}
                              placeholder="value"
                              className="flex-1 px-2 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400"
                              onKeyDown={(e) =>
                                e.key === "Enter" && addEnvVar()
                              }
                            />
                            <button
                              type="button"
                              onClick={addEnvVar}
                              className="px-2 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 transition-colors"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Custom CLI Args (generic) */}
                      <div>
                        <label className={labelClass}>Custom CLI Args</label>
                        <input
                          type="text"
                          value={config.custom_args.join(" ")}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              custom_args: e.target.value
                                ? e.target.value.split(/\s+/)
                                : [],
                            })
                          }
                          placeholder="--flag value --another"
                          className={`${inputClass} font-mono`}
                        />
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          Space-separated. Appended to the launch command.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-violet-400 text-white text-sm font-medium hover:bg-violet-500 transition-colors shadow-md disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* Reusable tag-style input for lists */
function TagInput({
  tags,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  placeholder,
  mono,
}: {
  tags: string[];
  inputValue: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {tags.map((tag, i) => (
          <span
            key={`${tag}-${i}`}
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-violet-50 text-violet-600 ${mono ? "font-mono" : ""}`}
          >
            {tag}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="text-violet-400 hover:text-violet-500"
            >
              x
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={placeholder}
          className={`flex-1 px-2 py-1.5 rounded-md border border-slate-200 bg-white/60 text-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300 placeholder:text-slate-400 ${mono ? "font-mono" : ""}`}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
        />
        <button
          type="button"
          onClick={onAdd}
          className="px-2 py-1.5 text-xs bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}
