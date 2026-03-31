import { useState, useCallback } from "react";
import { useTuning } from "../hooks/useTuning";
import { useProfiles } from "../hooks/useProfiles";
import { HooksSection } from "./tuning/HooksSection";
import { PermissionsSection } from "./tuning/PermissionsSection";
import { FileConfigsSection, getFileKindsForAgent } from "./tuning/FileConfigsSection";
import type { AgentConfigOverrides, SessionTuning } from "../lib/types";

interface TuningPanelProps {
  sessionId: string;
  sessionType: string;
  onDismiss: () => void;
  onRestart: () => void;
}

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
  const { tuning, loading, hasTuning, saveTuning, updateOverrides, updateStartupCommands, updateHooks, updatePermissions, updateFileConfigs, clearTuning } = useTuning(sessionId);
  const { profiles, saveProfile, deleteProfile } = useProfiles(sessionType);
  const [newCommand, setNewCommand] = useState("");
  const [dirty, setDirty] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [showProfileMenu, setShowProfileMenu] = useState(false);

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
    },
    [updateOverrides],
  );

  const handleAddCommand = useCallback(async () => {
    const trimmed = newCommand.trim();
    if (!trimmed) return;
    await updateStartupCommands([...startupCommands, trimmed]);
    setNewCommand("");
  }, [newCommand, startupCommands, updateStartupCommands]);

  const handleRemoveCommand = useCallback(
    async (index: number) => {
      await updateStartupCommands(startupCommands.filter((_, i) => i !== index));
    },
    [startupCommands, updateStartupCommands],
  );

  const handleClear = useCallback(async () => {
    await clearTuning();
    setDirty(false);
  }, [clearTuning]);

  const handleSaveProfile = useCallback(async () => {
    if (!profileName.trim() || !tuning) return;
    await saveProfile(profileName.trim(), tuning);
    setProfileName("");
    setShowSaveDialog(false);
  }, [profileName, tuning, saveProfile]);

  const handleLoadProfile = useCallback(
    async (profileTuning: SessionTuning) => {
      await saveTuning(profileTuning);
      setDirty(true);
      setShowProfileMenu(false);
    },
    [saveTuning],
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

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Quick Toggles — Claude Code */}
        {isClaude && (
          <section>
            <SectionHeader
              title="Quick Toggles"
              subtitle="Override model, effort, and behavior for this session"
            />
            <div className="space-y-3">
              <ToggleRow label="Model" hint="Which Claude model to use">
                <ButtonGroup
                  options={MODEL_OPTIONS}
                  value={overrides.model ?? null}
                  onChange={(v) => handleOverride("model", v)}
                />
              </ToggleRow>

              <ToggleRow label="Effort" hint="How much thinking effort to use">
                <ButtonGroup
                  options={EFFORT_OPTIONS}
                  value={overrides.effort ?? null}
                  onChange={(v) => handleOverride("effort", v)}
                />
              </ToggleRow>

              <ToggleRow label="Permission" hint="How Claude asks before acting">
                <ButtonGroup
                  options={PERMISSION_OPTIONS}
                  value={overrides.permission_mode ?? null}
                  onChange={(v) => handleOverride("permission_mode", v)}
                />
              </ToggleRow>

              <ToggleRow label="Thinking" hint="Step-by-step reasoning behavior">
                <ButtonGroup
                  options={THINKING_OPTIONS}
                  value={overrides.thinking_mode ?? null}
                  onChange={(v) => handleOverride("thinking_mode", v)}
                />
              </ToggleRow>

              <div className="flex items-center gap-4">
                <BoolToggle
                  label="Chrome"
                  hint="Browser integration"
                  value={overrides.chrome_enabled ?? null}
                  onChange={(v) => handleOverride("chrome_enabled", v)}
                />
                <BoolToggle
                  label="Verbose"
                  hint="Detailed output"
                  value={overrides.verbose ?? null}
                  onChange={(v) => handleOverride("verbose", v)}
                />
                <BoolToggle
                  label="Worktree"
                  hint="Git isolation"
                  value={overrides.worktree ?? null}
                  onChange={(v) => handleOverride("worktree", v)}
                />
              </div>
            </div>
          </section>
        )}

        {/* Quick Toggles — Cursor */}
        {isCursor && (
          <section>
            <SectionHeader
              title="Quick Toggles"
              subtitle="Cursor Agent configuration"
            />
            <div className="text-xs text-slate-500">
              Add rules, skills, and hooks via the Files section below.
            </div>
          </section>
        )}

        {/* System Prompt (Claude only) */}
        {isClaude && (
          <CollapsibleSection
            title="System Prompt"
            subtitle="Extra instructions appended to Claude's system prompt"
            defaultOpen={!!overrides.append_system_prompt}
          >
            <textarea
              value={overrides.append_system_prompt ?? ""}
              onChange={(e) => handleOverride("append_system_prompt", e.target.value || null)}
              placeholder="e.g., Always explain your reasoning. Use TypeScript strict mode. Follow the existing patterns in this codebase."
              rows={4}
              className="w-full bg-[#141422] border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-y focus:outline-none focus:border-violet-500/50"
            />
          </CollapsibleSection>
        )}

        {/* Hooks (Claude only) */}
        {isClaude && (
          <CollapsibleSection
            title="Hooks"
            subtitle="Auto-run scripts when Claude writes, edits, or stops"
            defaultOpen={hooksConfig.length > 0}
          >
            <HooksSection
              hooks={hooksConfig}
              onUpdate={(hooks) => { updateHooks(hooks); setDirty(true); }}
            />
          </CollapsibleSection>
        )}

        {/* Permissions (Claude only) */}
        {isClaude && (
          <CollapsibleSection
            title="Permissions"
            subtitle="Auto-approve or block specific commands and actions"
            defaultOpen={permissionRules.allow.length > 0 || permissionRules.deny.length > 0}
          >
            <PermissionsSection
              rules={permissionRules}
              onUpdate={(rules) => { updatePermissions(rules); setDirty(true); }}
            />
          </CollapsibleSection>
        )}

        {/* File Configs (agent-aware) */}
        {hasFileKinds && (
          <CollapsibleSection
            title="Files"
            subtitle="Install commands, agents, skills, and context files to the project"
            defaultOpen={fileConfigs.length > 0}
          >
            <FileConfigsSection
              sessionId={sessionId}
              sessionType={sessionType}
              files={fileConfigs}
              onUpdate={(files) => { updateFileConfigs(files); setDirty(true); }}
            />
          </CollapsibleSection>
        )}

        {/* Startup Commands */}
        <CollapsibleSection
          title="Startup Commands"
          subtitle="Slash commands typed into the session after the agent is ready"
          defaultOpen={startupCommands.length > 0}
        >
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
            <p className="text-[10px] text-slate-600">
              Typed into the session after the agent signals ready.
            </p>
          </div>
        </CollapsibleSection>

        {/* Advanced */}
        <CollapsibleSection title="Advanced" subtitle="Max turns, MCP config, custom CLI arguments">
          <div className="space-y-3">
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
        </CollapsibleSection>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-700/50 flex items-center justify-between">
        <span className="text-[10px] text-slate-600">
          {dirty ? "Restart to apply CLI changes" : hasTuning ? "Tuning active" : "No tuning applied"}
        </span>
        {dirty && (
          <button
            onClick={() => { onRestart(); setDirty(false); }}
            className="px-3 py-1.5 rounded-md text-xs bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors"
          >
            Apply & Restart
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

interface OptionItem {
  value: string;
  label: string;
  hint: string;
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</h3>
      {subtitle && <p className="text-[10px] text-slate-600 mt-0.5">{subtitle}</p>}
    </div>
  );
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
  onChange,
}: {
  options: OptionItem[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(value === opt.value ? null : opt.value)}
          title={opt.hint}
          className={`px-2.5 py-1 rounded text-[11px] transition-colors ${
            value === opt.value
              ? "bg-violet-500/30 text-violet-200 border border-violet-500/50"
              : "bg-slate-800/50 text-slate-500 border border-transparent hover:text-slate-300 hover:bg-slate-700/50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function BoolToggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <button
      onClick={() => {
        if (value === null) onChange(true);
        else if (value === true) onChange(false);
        else onChange(null);
      }}
      title={hint}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors ${
        value === true
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
          : value === false
            ? "bg-red-500/15 text-red-400 border border-red-500/30"
            : "bg-slate-800/50 text-slate-500 border border-transparent hover:text-slate-300"
      }`}
    >
      <span className="text-[9px]">
        {value === true ? "ON" : value === false ? "OFF" : "—"}
      </span>
      {label}
    </button>
  );
}

function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-start gap-2 mb-2 hover:opacity-80 transition-opacity text-left"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={`transition-transform mt-0.5 shrink-0 ${open ? "rotate-90" : ""}`}
        >
          <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</span>
          {subtitle && <p className="text-[10px] text-slate-600 mt-0.5 normal-case tracking-normal">{subtitle}</p>}
        </div>
      </button>
      {open && <div className="pl-4">{children}</div>}
    </section>
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
