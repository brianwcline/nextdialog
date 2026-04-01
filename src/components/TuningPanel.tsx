import { useState, useCallback } from "react";
import { useTuning } from "../hooks/useTuning";
import { useProfiles } from "../hooks/useProfiles";
import { HooksSection } from "./tuning/HooksSection";
import { PermissionsSection } from "./tuning/PermissionsSection";
import { FileConfigsSection, getFileKindsForAgent } from "./tuning/FileConfigsSection";
import { trackEvent } from "../lib/telemetry";
import type { AgentConfigOverrides, SessionTuning } from "../lib/types";

interface TuningPanelProps {
  sessionId: string;
  sessionType: string;
  onDismiss: () => void;
  onRestart: () => void;
}

// Claude Code defaults — used as fallback when SessionType has no explicit config
const CLAUDE_DEFAULTS = {
  model: "opus",
  effort: "medium",
  permission_mode: "default",
  thinking_mode: "enabled",
  verbose: false,
  chrome_enabled: null as boolean | null,
  worktree: null as boolean | null,
};

const MODEL_OPTIONS = [
  { value: "haiku", label: "Haiku", hint: "Fast, cheap" },
  { value: "sonnet", label: "Sonnet", hint: "Balanced" },
  { value: "opus", label: "Opus", hint: "Most capable" },
];
const EFFORT_OPTIONS = [
  { value: "low", label: "Low", hint: "Quick answers" },
  { value: "medium", label: "Medium", hint: "Default" },
  { value: "high", label: "High", hint: "Thorough" },
  { value: "max", label: "Max", hint: "Deep analysis" },
];
const PERMISSION_OPTIONS = [
  { value: "default", label: "Default", hint: "Ask for each action" },
  { value: "plan", label: "Plan", hint: "Research first, then build" },
  { value: "acceptEdits", label: "Accept Edits", hint: "Auto-approve file changes" },
  { value: "dontAsk", label: "Don't Ask", hint: "No prompts, deny if unsure" },
  { value: "bypassPermissions", label: "Bypass", hint: "Allow everything (careful!)" },
];
const THINKING_OPTIONS = [
  { value: "enabled", label: "Enabled", hint: "Always think step-by-step" },
  { value: "adaptive", label: "Adaptive", hint: "Think when needed" },
  { value: "disabled", label: "Disabled", hint: "No thinking, faster" },
];

export function TuningPanel({ sessionId, sessionType, onDismiss, onRestart }: TuningPanelProps) {
  const { tuning, baseline, loading, hasTuning, saveTuning, updateOverrides, updateStartupCommands, updateHooks, updatePermissions, updateFileConfigs, clearTuning } = useTuning(sessionId, sessionType);
  const { profiles, saveProfile, deleteProfile } = useProfiles(sessionType);
  const [newCommand, setNewCommand] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("hooks");

  const overrides = tuning?.config_overrides ?? {};
  const startupCommands = tuning?.startup_commands ?? [];
  const hooksConfig = tuning?.hooks_config ?? [];
  const permissionRules = tuning?.permission_rules ?? { allow: [], deny: [] };
  const fileConfigs = tuning?.file_configs ?? [];

  const isClaude = sessionType === "claude-code";
  const hasFileKinds = getFileKindsForAgent(sessionType).length > 0;
  const isCursor = sessionType === "cursor-agent";

  const handleOverride = useCallback(
    async (key: keyof AgentConfigOverrides, value: unknown) => {
      await updateOverrides({ [key]: value });
      setDirty(true);
      trackEvent("tuning.override_changed", "tuning", { key, value: String(value ?? "cleared"), session_type: sessionType }, sessionId);
    },
    [updateOverrides, sessionId, sessionType],
  );

  const handleAddCommand = useCallback(async () => {
    const trimmed = newCommand.trim();
    if (!trimmed) return;
    await updateStartupCommands([...startupCommands, trimmed]);
    setNewCommand("");
    trackEvent("tuning.startup_command_added", "tuning", { command: trimmed, session_type: sessionType }, sessionId);
  }, [newCommand, startupCommands, updateStartupCommands, sessionId, sessionType]);

  const handleRemoveCommand = useCallback(
    async (index: number) => {
      await updateStartupCommands(startupCommands.filter((_, i) => i !== index));
    },
    [startupCommands, updateStartupCommands],
  );

  const handleClear = useCallback(async () => {
    await clearTuning();
    setDirty(false);
    trackEvent("tuning.cleared", "tuning", { session_type: sessionType }, sessionId);
  }, [clearTuning, sessionId, sessionType]);

  const handleSaveProfile = useCallback(async () => {
    if (!profileName.trim() || !tuning) return;
    await saveProfile(profileName.trim(), tuning);
    setProfileName("");
    setShowSaveDialog(false);
    trackEvent("tuning.profile_saved", "tuning", { session_type: sessionType, profile_name: profileName.trim() }, sessionId);
  }, [profileName, tuning, saveProfile, sessionId, sessionType]);

  const handleLoadProfile = useCallback(
    async (profileTuning: SessionTuning) => {
      await saveTuning(profileTuning);
      setDirty(true);
      setShowProfileMenu(false);
      trackEvent("tuning.profile_loaded", "tuning", { session_type: sessionType }, sessionId);
    },
    [saveTuning, sessionId, sessionType],
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1a1a2e] text-slate-500 text-sm">
        Loading tuning...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1a1a2e] text-slate-300" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-slate-200">Session Tuning</h2>
          {hasTuning && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/20 text-violet-300">
              Active
            </span>
          )}

          {/* Profile dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowProfileMenu((v) => !v)}
              className="px-2 py-1 rounded text-[11px] text-slate-500 hover:text-slate-300 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/30 transition-colors"
            >
              {tuning?.profile_id
                ? profiles.find((p) => p.id === tuning.profile_id)?.name ?? "Profile"
                : "Load Profile"}
            </button>
            {showProfileMenu && (
              <div className="absolute top-full left-0 mt-1 z-30 min-w-[200px] rounded-lg bg-[#313244] border border-slate-600/50 shadow-xl py-1">
                {profiles.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-slate-500">No saved profiles</div>
                ) : (
                  profiles.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-slate-600/30 group">
                      <button
                        onClick={() => handleLoadProfile(p.tuning)}
                        className="text-[11px] text-slate-300 text-left flex-1 min-w-0 truncate"
                      >
                        {p.name}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteProfile(p.id); }}
                        className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all ml-2"
                      >
                        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                          <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
                <div
                  className="border-t border-slate-600/50 mt-1 pt-1"
                  onClick={() => setShowProfileMenu(false)}
                >
                  {/* Dismiss on backdrop click handled by parent */}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasTuning && (
            <button
              onClick={() => setShowSaveDialog(true)}
              className="px-2 py-1 rounded text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-500/10 transition-colors"
            >
              Save as Profile
            </button>
          )}
          {hasTuning && (
            <button
              onClick={handleClear}
              className="px-2 py-1 rounded text-xs text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
            >
              Clear All
            </button>
          )}
          <button
            onClick={onDismiss}
            className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Save profile dialog */}
      {showSaveDialog && (
        <div className="px-5 py-3 border-b border-slate-700/50 bg-violet-500/5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveProfile()}
              placeholder="Profile name (e.g., PR Babysitter)"
              className="flex-1 bg-[#141422] border border-violet-500/30 rounded px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-violet-500/50"
              autoFocus
            />
            <button
              onClick={handleSaveProfile}
              disabled={!profileName.trim()}
              className="px-3 py-1.5 rounded text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-30 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => { setShowSaveDialog(false); setProfileName(""); }}
              className="px-2 py-1.5 rounded text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex flex-col min-h-0">

        {/* Quick Toggles — always visible */}
        <div className="px-5 py-4 border-b border-slate-700/30">
          {isClaude && (
            <div className="space-y-3">
              <ToggleRow label="Model" hint="Which Claude model to use">
                <ButtonGroup
                  options={MODEL_OPTIONS}
                  value={overrides.model ?? null}
                  baselineValue={baseline?.model ?? CLAUDE_DEFAULTS.model}
                  onChange={(v) => handleOverride("model", v)}
                />
              </ToggleRow>

              <ToggleRow label="Effort" hint="How much thinking effort to use">
                <ButtonGroup
                  options={EFFORT_OPTIONS}
                  value={overrides.effort ?? null}
                  baselineValue={CLAUDE_DEFAULTS.effort}
                  onChange={(v) => handleOverride("effort", v)}
                />
              </ToggleRow>

              <ToggleRow label="Permission" hint="How Claude asks before acting">
                <ButtonGroup
                  options={PERMISSION_OPTIONS}
                  value={overrides.permission_mode ?? null}
                  baselineValue={baseline?.permission_mode ?? CLAUDE_DEFAULTS.permission_mode}
                  onChange={(v) => handleOverride("permission_mode", v)}
                />
              </ToggleRow>

              <ToggleRow label="Thinking" hint="Step-by-step reasoning behavior">
                <ButtonGroup
                  options={THINKING_OPTIONS}
                  value={overrides.thinking_mode ?? null}
                  baselineValue={CLAUDE_DEFAULTS.thinking_mode}
                  onChange={(v) => handleOverride("thinking_mode", v)}
                />
              </ToggleRow>

              <div className="flex items-center gap-4">
                <BoolToggle label="Chrome" hint="Browser integration" value={overrides.chrome_enabled ?? null} baselineValue={baseline?.chrome_enabled ?? CLAUDE_DEFAULTS.chrome_enabled} onChange={(v) => handleOverride("chrome_enabled", v)} />
                <BoolToggle label="Verbose" hint="Detailed output" value={overrides.verbose ?? null} baselineValue={baseline?.verbose ?? CLAUDE_DEFAULTS.verbose} onChange={(v) => handleOverride("verbose", v)} />
                <BoolToggle label="Worktree" hint="Git isolation" value={overrides.worktree ?? null} baselineValue={CLAUDE_DEFAULTS.worktree} onChange={(v) => handleOverride("worktree", v)} />
                <BoolToggle label="Bare" hint="Fast startup, skip plugins/hooks/LSP" value={overrides.bare ?? null} baselineValue={null} onChange={(v) => handleOverride("bare", v)} />
                <BoolToggle label="No Flicker" hint="Reduce terminal rendering flicker" value={overrides.no_flicker ?? null} baselineValue={null} onChange={(v) => handleOverride("no_flicker", v)} />
              </div>
            </div>
          )}
          {isCursor && (
            <div className="text-xs text-slate-500">
              Configure Cursor Agent via the tabs below.
            </div>
          )}
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-5 pt-3 pb-0 border-b border-slate-700/30">
          {(isClaude
            ? getTabsForClaude(hooksConfig.length, permissionRules.allow.length + permissionRules.deny.length, fileConfigs.length, startupCommands.length + (overrides.append_system_prompt ? 1 : 0))
            : isCursor
              ? getTabsForCursor(fileConfigs.length, startupCommands.length)
              : sessionType === "gemini-cli"
                ? getTabsForGemini(fileConfigs.length, startupCommands.length)
                : getTabsGeneric(startupCommands.length)
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-[11px] rounded-t-md transition-colors ${
                activeTab === tab.id
                  ? "text-violet-300 bg-[#141422] border border-slate-700/30 border-b-transparent -mb-px"
                  : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 px-1 py-0 rounded text-[9px] bg-violet-500/20 text-violet-400">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Hooks tab */}
          {activeTab === "hooks" && isClaude && (
            <div>
              <p className="text-[10px] text-slate-600 mb-3">Auto-run scripts when Claude writes, edits, or stops</p>
              <HooksSection
                hooks={hooksConfig}
                onUpdate={(hooks) => {
                  updateHooks(hooks); setDirty(true);
                  trackEvent("tuning.hooks_changed", "tuning", { count: hooks.length, session_type: sessionType }, sessionId);
                }}
              />
            </div>
          )}

          {/* Permissions tab */}
          {activeTab === "permissions" && isClaude && (
            <div>
              <p className="text-[10px] text-slate-600 mb-3">Auto-approve or block specific commands and actions</p>
              <PermissionsSection
                rules={permissionRules}
                onUpdate={(rules) => {
                  updatePermissions(rules); setDirty(true);
                  trackEvent("tuning.permissions_changed", "tuning", { allow_count: rules.allow.length, deny_count: rules.deny.length, session_type: sessionType }, sessionId);
                }}
              />
            </div>
          )}

          {/* Files tab */}
          {activeTab === "files" && hasFileKinds && (
            <div>
              <p className="text-[10px] text-slate-600 mb-3">Install commands, agents, skills, and context files to the project</p>
              <FileConfigsSection
                sessionId={sessionId}
                sessionType={sessionType}
                files={fileConfigs}
                onUpdate={(files) => {
                  updateFileConfigs(files); setDirty(true);
                  trackEvent("tuning.files_changed", "tuning", { count: files.length, session_type: sessionType }, sessionId);
                }}
              />
            </div>
          )}

          {/* Prompt & Commands tab */}
          {activeTab === "prompt" && (
            <div className="space-y-5">
              {isClaude && (
                <div>
                  <h4 className="text-xs font-medium text-slate-400 mb-2">System Prompt</h4>
                  <p className="text-[10px] text-slate-600 mb-2">Extra instructions appended to Claude's system prompt</p>
                  <textarea
                    value={overrides.append_system_prompt ?? ""}
                    onChange={(e) => handleOverride("append_system_prompt", e.target.value || null)}
                    placeholder="e.g., Always explain your reasoning. Use TypeScript strict mode. Follow the existing patterns in this codebase."
                    rows={4}
                    className="w-full bg-[#141422] border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-y focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              )}

              <div>
                <h4 className="text-xs font-medium text-slate-400 mb-2">Startup Commands</h4>
                <p className="text-[10px] text-slate-600 mb-2">Slash commands typed into the session after the agent is ready</p>
                <div className="space-y-2">
                  {startupCommands.map((cmd, i) => (
                    <div key={i} className="flex items-center gap-2 group">
                      <span className="flex-1 text-xs font-mono text-slate-400 bg-[#141422] rounded px-2.5 py-1.5 border border-slate-700/30">
                        {cmd}
                      </span>
                      <button
                        onClick={() => handleRemoveCommand(i)}
                        className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-xs"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCommand}
                      onChange={(e) => setNewCommand(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddCommand()}
                      placeholder="/loop 5m /run-tests"
                      className="flex-1 bg-[#141422] border border-slate-700/50 rounded px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50"
                    />
                    <button
                      onClick={handleAddCommand}
                      disabled={!newCommand.trim()}
                      className="px-2.5 py-1.5 rounded text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Advanced tab */}
          {activeTab === "advanced" && (
            <div className="space-y-3">
              <p className="text-[10px] text-slate-600 mb-1">Max turns, MCP config, custom CLI arguments</p>
              {isClaude && (
                <>
                  <TextInput
                    label="Max Turns"
                    type="number"
                    value={overrides.max_turns?.toString() ?? ""}
                    onChange={(v) => handleOverride("max_turns", v ? parseInt(v) : null)}
                    placeholder="No limit"
                  />
                  <TextInput
                    label="MCP Config Path"
                    value={overrides.mcp_config_path ?? ""}
                    onChange={(v) => handleOverride("mcp_config_path", v || null)}
                    placeholder="/path/to/mcp.json"
                  />
                  <TextInput
                    label="Main Thread Agent"
                    value={overrides.agent ?? ""}
                    onChange={(v) => handleOverride("agent", v || null)}
                    placeholder="agent-name (from .claude/agents/)"
                  />
                </>
              )}
              <TextInput
                label="Custom CLI Args"
                value={(overrides.custom_args ?? []).join(" ")}
                onChange={(v) => handleOverride("custom_args", v ? v.split(/\s+/) : null)}
                placeholder="--flag1 --flag2 value"
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-700/50 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">
          {dirty ? "Restart to apply CLI changes" : hasTuning ? "Tuning active" : "No tuning applied"}
        </span>
        {dirty && (
          <button
            onClick={() => { onRestart(); setDirty(false); trackEvent("tuning.applied_restart", "tuning", { session_type: sessionType }, sessionId); }}
            className="px-3 py-1.5 rounded-md text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors"
          >
            Apply & Restart
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tab configuration ──

interface TabDef {
  id: string;
  label: string;
  count: number;
}

function getTabsForClaude(hooks: number, permissions: number, files: number, commands: number): TabDef[] {
  return [
    { id: "hooks", label: "Hooks", count: hooks },
    { id: "permissions", label: "Permissions", count: permissions },
    { id: "files", label: "Files", count: files },
    { id: "prompt", label: "Prompt & Commands", count: commands },
    { id: "advanced", label: "Advanced", count: 0 },
  ];
}

function getTabsForCursor(files: number, commands: number): TabDef[] {
  return [
    { id: "files", label: "Files", count: files },
    { id: "prompt", label: "Commands", count: commands },
    { id: "advanced", label: "Advanced", count: 0 },
  ];
}

function getTabsForGemini(files: number, commands: number): TabDef[] {
  return [
    { id: "files", label: "Files", count: files },
    { id: "prompt", label: "Commands", count: commands },
    { id: "advanced", label: "Advanced", count: 0 },
  ];
}

function getTabsGeneric(commands: number): TabDef[] {
  return [
    { id: "prompt", label: "Commands", count: commands },
    { id: "advanced", label: "Advanced", count: 0 },
  ];
}

// ── Sub-components ──

interface OptionItem {
  value: string;
  label: string;
  hint: string;
}

function ToggleRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="shrink-0">
        <span className="text-xs text-slate-300">{label}</span>
        {hint && <span className="text-[10px] text-slate-600 ml-2">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function ButtonGroup({
  options,
  value,
  baselineValue,
  onChange,
}: {
  options: OptionItem[];
  value: string | null;
  baselineValue?: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => {
        const isOverride = value === opt.value;
        const isBaseline = !value && baselineValue === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(value === opt.value ? null : opt.value)}
            title={opt.hint}
            className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
              isOverride
                ? "bg-violet-500/30 text-violet-200 border border-violet-500/50"
                : isBaseline
                  ? "bg-slate-700/40 text-slate-300 border border-slate-600/50"
                  : "bg-slate-800/50 text-slate-500 border border-transparent hover:text-slate-300 hover:bg-slate-700/50"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function BoolToggle({
  label,
  hint,
  value,
  baselineValue,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  baselineValue?: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  // Show the effective value: override if set, otherwise baseline
  const effective = value ?? baselineValue ?? null;
  const isOverride = value !== null && value !== undefined;

  return (
    <button
      onClick={() => {
        if (value === null) onChange(true);
        else if (value === true) onChange(false);
        else onChange(null);
      }}
      title={hint}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors ${
        isOverride && value === true
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
          : isOverride && value === false
            ? "bg-red-500/15 text-red-400 border border-red-500/30"
            : effective === true
              ? "bg-slate-700/40 text-slate-300 border border-slate-600/50"
              : effective === false
                ? "bg-slate-700/30 text-slate-400 border border-slate-600/30"
                : "bg-slate-800/50 text-slate-500 border border-transparent hover:text-slate-300"
      }`}
    >
      <span className="text-[9px]">
        {isOverride
          ? (value === true ? "ON" : "OFF")
          : (effective === true ? "on" : effective === false ? "off" : "—")}
      </span>
      {label}
    </button>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 w-28 shrink-0">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-[#141422] border border-slate-700/50 rounded px-2.5 py-1.5 text-xs text-slate-300 placeholder-slate-600 font-mono focus:outline-none focus:border-violet-500/50"
      />
    </div>
  );
}
