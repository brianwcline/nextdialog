import { useState, useCallback } from "react";
import type { PermissionRules } from "../../lib/types";

// ── Permission presets ──

interface PermissionPreset {
  id: string;
  label: string;
  description: string;
  type: "allow" | "deny";
  rules: string[];
}

const PRESETS: PermissionPreset[] = [
  {
    id: "allow-git",
    label: "Auto-approve git commands",
    description: "git add, commit, push, pull, checkout, etc.",
    type: "allow",
    rules: ["Bash(git *)"],
  },
  {
    id: "allow-npm-scripts",
    label: "Auto-approve npm/bun scripts",
    description: "npm test, npm run build, bun test, etc.",
    type: "allow",
    rules: ["Bash(npm test)", "Bash(npm run *)", "Bash(bun test)", "Bash(bun run *)"],
  },
  {
    id: "allow-lint-format",
    label: "Auto-approve lint & format",
    description: "eslint, prettier, biome, tsc --noEmit",
    type: "allow",
    rules: ["Bash(npx eslint *)", "Bash(npx prettier *)", "Bash(npx biome *)", "Bash(npx tsc --noEmit)"],
  },
  {
    id: "deny-dangerous",
    label: "Block dangerous commands",
    description: "rm -rf, DROP TABLE, force push to main",
    type: "deny",
    rules: ["Bash(rm -rf *)", "Bash(git push --force origin main)", "Bash(git push --force origin master)"],
  },
];

interface PermissionsSectionProps {
  rules: PermissionRules;
  onUpdate: (rules: PermissionRules) => void;
}

export function PermissionsSection({ rules, onUpdate }: PermissionsSectionProps) {
  const [newAllowRule, setNewAllowRule] = useState("");
  const [newDenyRule, setNewDenyRule] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  // Check if a preset is active (all its rules are present)
  const isPresetActive = useCallback(
    (preset: PermissionPreset) => {
      const list = preset.type === "allow" ? rules.allow : rules.deny;
      return preset.rules.every((r) => list.includes(r));
    },
    [rules],
  );

  // Toggle a preset on/off
  const togglePreset = useCallback(
    (preset: PermissionPreset) => {
      const key = preset.type === "allow" ? "allow" : "deny";
      const current = [...rules[key]];
      if (isPresetActive(preset)) {
        // Remove preset rules
        const filtered = current.filter((r) => !preset.rules.includes(r));
        onUpdate({ ...rules, [key]: filtered });
      } else {
        // Add preset rules (avoiding duplicates)
        const merged = [...new Set([...current, ...preset.rules])];
        onUpdate({ ...rules, [key]: merged });
      }
    },
    [rules, onUpdate, isPresetActive],
  );

  // Add custom rule
  const addRule = useCallback(
    (type: "allow" | "deny", rule: string) => {
      const trimmed = rule.trim();
      if (!trimmed) return;
      const current = [...rules[type]];
      if (!current.includes(trimmed)) {
        onUpdate({ ...rules, [type]: [...current, trimmed] });
      }
    },
    [rules, onUpdate],
  );

  // Remove a rule
  const removeRule = useCallback(
    (type: "allow" | "deny", rule: string) => {
      onUpdate({ ...rules, [type]: rules[type].filter((r) => r !== rule) });
    },
    [rules, onUpdate],
  );

  const allowPresets = PRESETS.filter((p) => p.type === "allow");
  const denyPresets = PRESETS.filter((p) => p.type === "deny");

  return (
    <div className="space-y-4">
      {/* Allow presets */}
      <div>
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">Auto-approve</span>
        <div className="mt-1.5 space-y-1.5">
          {allowPresets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              active={isPresetActive(preset)}
              onToggle={() => togglePreset(preset)}
            />
          ))}
        </div>
      </div>

      {/* Deny presets */}
      <div>
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">Block</span>
        <div className="mt-1.5 space-y-1.5">
          {denyPresets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              active={isPresetActive(preset)}
              onToggle={() => togglePreset(preset)}
            />
          ))}
        </div>
      </div>

      {/* Custom rules */}
      <div>
        <button
          onClick={() => setShowCustom((v) => !v)}
          className="flex items-center gap-2 text-[10px] text-slate-600 uppercase tracking-wider hover:text-slate-400 transition-colors"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 10 10"
            fill="none"
            className={`transition-transform ${showCustom ? "rotate-90" : ""}`}
          >
            <path d="M3 1L7 5L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Custom Rules ({rules.allow.length + rules.deny.length} total)
        </button>
        {showCustom && (
          <div className="mt-2 space-y-3">
            {/* Allow rules */}
            <div>
              <span className="text-[10px] text-emerald-500/70 font-medium">Allow</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {rules.allow.map((rule) => (
                  <RuleTag key={rule} rule={rule} type="allow" onRemove={() => removeRule("allow", rule)} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="text"
                  value={newAllowRule}
                  onChange={(e) => setNewAllowRule(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addRule("allow", newAllowRule);
                      setNewAllowRule("");
                    }
                  }}
                  placeholder="Bash(git *), Edit(/src/**)"
                  className="flex-1 bg-[#141422] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-400 font-mono placeholder-slate-700 focus:outline-none focus:border-emerald-500/50"
                />
                <button
                  onClick={() => { addRule("allow", newAllowRule); setNewAllowRule(""); }}
                  disabled={!newAllowRule.trim()}
                  className="px-2 py-1 rounded text-[10px] bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-30 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Deny rules */}
            <div>
              <span className="text-[10px] text-red-500/70 font-medium">Deny</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {rules.deny.map((rule) => (
                  <RuleTag key={rule} rule={rule} type="deny" onRemove={() => removeRule("deny", rule)} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <input
                  type="text"
                  value={newDenyRule}
                  onChange={(e) => setNewDenyRule(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addRule("deny", newDenyRule);
                      setNewDenyRule("");
                    }
                  }}
                  placeholder="Bash(rm -rf *)"
                  className="flex-1 bg-[#141422] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-400 font-mono placeholder-slate-700 focus:outline-none focus:border-red-500/50"
                />
                <button
                  onClick={() => { addRule("deny", newDenyRule); setNewDenyRule(""); }}
                  disabled={!newDenyRule.trim()}
                  className="px-2 py-1 rounded text-[10px] bg-red-500/15 text-red-400 hover:bg-red-500/25 disabled:opacity-30 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <p className="text-[10px] text-slate-700">
              Syntax: ToolName(pattern) — e.g., Bash(git *), Edit(/src/**), Read(/secrets/**)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preset Card ──

function PresetCard({
  preset,
  active,
  onToggle,
}: {
  preset: PermissionPreset;
  active: boolean;
  onToggle: () => void;
}) {
  const borderColor = preset.type === "allow"
    ? active ? "border-emerald-500/40 bg-emerald-500/5" : "border-slate-700/30 bg-slate-800/20"
    : active ? "border-red-500/30 bg-red-500/5" : "border-slate-700/30 bg-slate-800/20";
  const checkColor = preset.type === "allow" ? "text-emerald-300" : "text-red-300";
  const checkBg = preset.type === "allow"
    ? active ? "bg-emerald-500/30 border-emerald-500/60" : "border-slate-600/50"
    : active ? "bg-red-500/30 border-red-500/60" : "border-slate-600/50";

  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-start gap-3 px-3 py-2 rounded-lg border text-left transition-colors ${borderColor}`}
    >
      <div className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checkBg}`}>
        {active && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={checkColor} />
          </svg>
        )}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-200">{preset.label}</div>
        <div className="text-[10px] text-slate-500 mt-0.5">{preset.description}</div>
      </div>
    </button>
  );
}

// ── Rule Tag ──

function RuleTag({
  rule,
  type,
  onRemove,
}: {
  rule: string;
  type: "allow" | "deny";
  onRemove: () => void;
}) {
  const colors = type === "allow"
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
    : "bg-red-500/10 text-red-400 border-red-500/30";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono ${colors}`}>
      {rule}
      <button onClick={onRemove} className="hover:opacity-70 transition-opacity">&times;</button>
    </span>
  );
}
