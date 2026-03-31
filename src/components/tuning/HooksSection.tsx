import { useState, useCallback } from "react";
import type { HookEntry } from "../../lib/types";

// ── Recipe definitions ──

interface HookRecipe {
  id: string;
  label: string;
  description: string;
  category: "quality" | "automation";
  defaultHook: Omit<HookEntry, "recipe_id">;
  /** Which field is user-customizable (shown as editable input) */
  customField: { key: "command"; label: string; placeholder: string };
}

const RECIPES: HookRecipe[] = [
  {
    id: "auto-format",
    label: "Auto-format on save",
    description: "Runs formatter after every file write or edit",
    category: "quality",
    defaultHook: {
      event: "PostToolUse",
      matcher: "Write|Edit",
      hook_type: "command",
      command: 'npx prettier --write "$tool_input_path" 2>/dev/null || true',
      async_mode: true,
      once: false,
    },
    customField: { key: "command", label: "Command", placeholder: "npx prettier --write ..." },
  },
  {
    id: "lint-on-edit",
    label: "Lint after edits",
    description: "Runs linter on changed files in the background",
    category: "quality",
    defaultHook: {
      event: "PostToolUse",
      matcher: "Write|Edit",
      hook_type: "command",
      command: 'npx eslint --fix "$tool_input_path" 2>/dev/null || true',
      async_mode: true,
      once: false,
    },
    customField: { key: "command", label: "Command", placeholder: "npx eslint --fix ..." },
  },
  {
    id: "test-on-stop",
    label: "Run tests before stopping",
    description: "Agent can't stop until tests pass (exit code 2 = keep working)",
    category: "quality",
    defaultHook: {
      event: "Stop",
      matcher: null,
      hook_type: "command",
      command: "npm test 2>&1 | tail -20",
      async_mode: false,
      once: false,
    },
    customField: { key: "command", label: "Test command", placeholder: "npm test" },
  },
  {
    id: "grind-loop",
    label: "Keep working until passing",
    description: "Stop hook that blocks the agent from stopping if tests/CI fail",
    category: "automation",
    defaultHook: {
      event: "Stop",
      matcher: null,
      hook_type: "command",
      command: 'npm test 2>&1 | tail -30; if [ $? -ne 0 ]; then exit 2; fi',
      async_mode: false,
      once: false,
    },
    customField: { key: "command", label: "Check command", placeholder: "npm test && npm run lint" },
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  quality: "Quality",
  automation: "Automation",
};

// ── Hook event options for custom editor ──

const HOOK_EVENT_GROUPS = [
  { label: "Tool", events: ["PreToolUse", "PostToolUse", "PostToolUseFailure"] },
  { label: "Session", events: ["SessionStart", "SessionEnd", "Stop", "StopFailure"] },
  { label: "Permission", events: ["PermissionRequest", "PermissionDenied"] },
  { label: "Subagent", events: ["SubagentStart", "SubagentStop"] },
  { label: "Context", events: ["PreCompact", "PostCompact", "UserPromptSubmit"] },
  { label: "Workspace", events: ["CwdChanged", "FileChanged", "ConfigChange"] },
  { label: "Other", events: ["Notification", "TaskCreated", "TaskCompleted", "Setup"] },
];

interface HooksSectionProps {
  hooks: HookEntry[];
  onUpdate: (hooks: HookEntry[]) => void;
}

export function HooksSection({ hooks, onUpdate }: HooksSectionProps) {
  const [showCustom, setShowCustom] = useState(false);

  // Check if a recipe is active (by recipe_id)
  const isRecipeActive = useCallback(
    (recipeId: string) => hooks.some((h) => h.recipe_id === recipeId),
    [hooks],
  );

  // Get the current command for an active recipe
  const getRecipeCommand = useCallback(
    (recipeId: string) => hooks.find((h) => h.recipe_id === recipeId)?.command,
    [hooks],
  );

  // Toggle a recipe on/off
  const toggleRecipe = useCallback(
    (recipe: HookRecipe) => {
      if (isRecipeActive(recipe.id)) {
        onUpdate(hooks.filter((h) => h.recipe_id !== recipe.id));
      } else {
        const entry: HookEntry = {
          ...recipe.defaultHook,
          recipe_id: recipe.id,
        };
        onUpdate([...hooks, entry]);
      }
    },
    [hooks, onUpdate, isRecipeActive],
  );

  // Update the command of an active recipe
  const updateRecipeCommand = useCallback(
    (recipeId: string, command: string) => {
      onUpdate(
        hooks.map((h) =>
          h.recipe_id === recipeId ? { ...h, command } : h,
        ),
      );
    },
    [hooks, onUpdate],
  );

  // Custom hook management
  const customHooks = hooks.filter((h) => !h.recipe_id);

  const addCustomHook = useCallback(() => {
    const entry: HookEntry = {
      event: "PostToolUse",
      matcher: null,
      hook_type: "command",
      command: "",
      async_mode: false,
      once: false,
    };
    onUpdate([...hooks, entry]);
    setShowCustom(true);
  }, [hooks, onUpdate]);

  const updateCustomHook = useCallback(
    (index: number, updated: Partial<HookEntry>) => {
      // Find the nth custom hook
      let customIdx = 0;
      const newHooks = hooks.map((h) => {
        if (!h.recipe_id) {
          if (customIdx === index) {
            customIdx++;
            return { ...h, ...updated };
          }
          customIdx++;
        }
        return h;
      });
      onUpdate(newHooks);
    },
    [hooks, onUpdate],
  );

  const removeCustomHook = useCallback(
    (index: number) => {
      let customIdx = 0;
      onUpdate(
        hooks.filter((h) => {
          if (!h.recipe_id) {
            if (customIdx === index) {
              customIdx++;
              return false;
            }
            customIdx++;
          }
          return true;
        }),
      );
    },
    [hooks, onUpdate],
  );

  // Group recipes by category
  const categories = [...new Set(RECIPES.map((r) => r.category))];

  return (
    <div className="space-y-4">
      {/* Recipe cards */}
      {categories.map((cat) => (
        <div key={cat}>
          <span className="text-[10px] text-slate-600 uppercase tracking-wider">
            {CATEGORY_LABELS[cat] ?? cat}
          </span>
          <div className="mt-1.5 space-y-2">
            {RECIPES.filter((r) => r.category === cat).map((recipe) => {
              const active = isRecipeActive(recipe.id);
              return (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  active={active}
                  command={getRecipeCommand(recipe.id) ?? recipe.defaultHook.command}
                  onToggle={() => toggleRecipe(recipe)}
                  onCommandChange={(cmd) => updateRecipeCommand(recipe.id, cmd)}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Custom hooks */}
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
          Custom Hooks ({customHooks.length})
        </button>
        {showCustom && (
          <div className="mt-2 space-y-2">
            {customHooks.map((hook, i) => (
              <CustomHookCard
                key={i}
                hook={hook}
                onChange={(updated) => updateCustomHook(i, updated)}
                onRemove={() => removeCustomHook(i)}
              />
            ))}
            <button
              onClick={addCustomHook}
              className="w-full py-2 rounded-lg border border-dashed border-slate-700/50 text-xs text-slate-600 hover:text-slate-400 hover:border-slate-600/50 transition-colors"
            >
              + Add Custom Hook
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Recipe Card ──

function RecipeCard({
  recipe,
  active,
  command,
  onToggle,
  onCommandChange,
}: {
  recipe: HookRecipe;
  active: boolean;
  command: string;
  onToggle: () => void;
  onCommandChange: (cmd: string) => void;
}) {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        active
          ? "border-violet-500/40 bg-violet-500/5"
          : "border-slate-700/30 bg-slate-800/20"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left"
      >
        <div
          className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
            active
              ? "bg-violet-500/30 border-violet-500/60"
              : "border-slate-600/50"
          }`}
        >
          {active && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-300" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs text-slate-200">{recipe.label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{recipe.description}</div>
        </div>
      </button>
      {active && (
        <div className="px-3 pb-2.5 pt-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600 shrink-0">{recipe.customField.label}:</span>
            <input
              type="text"
              value={command}
              onChange={(e) => onCommandChange(e.target.value)}
              placeholder={recipe.customField.placeholder}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-[#1E1E2E] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-400 font-mono focus:outline-none focus:border-violet-500/50"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Custom Hook Card ──

function CustomHookCard({
  hook,
  onChange,
  onRemove,
}: {
  hook: HookEntry;
  onChange: (updated: Partial<HookEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-700/30 bg-slate-800/20 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Event selector */}
          <select
            value={hook.event}
            onChange={(e) => onChange({ event: e.target.value })}
            className="bg-[#1E1E2E] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-violet-500/50"
          >
            {HOOK_EVENT_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.events.map((evt) => (
                  <option key={evt} value={evt}>{evt}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Type selector */}
          <select
            value={hook.hook_type}
            onChange={(e) => onChange({ hook_type: e.target.value })}
            className="bg-[#1E1E2E] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-violet-500/50"
          >
            <option value="command">command</option>
            <option value="prompt">prompt</option>
            <option value="agent">agent</option>
            <option value="http">http</option>
          </select>
        </div>

        <button
          onClick={onRemove}
          className="text-slate-600 hover:text-red-400 transition-colors ml-2"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Matcher */}
      <input
        type="text"
        value={hook.matcher ?? ""}
        onChange={(e) => onChange({ matcher: e.target.value || null })}
        placeholder="Matcher (e.g., Write|Edit, Bash, .*)"
        className="w-full bg-[#1E1E2E] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-400 font-mono placeholder-slate-700 focus:outline-none focus:border-violet-500/50"
      />

      {/* Command/prompt */}
      <textarea
        value={hook.command}
        onChange={(e) => onChange({ command: e.target.value })}
        placeholder={hook.hook_type === "http" ? "https://..." : hook.hook_type === "command" ? "shell command..." : "prompt text..."}
        rows={2}
        className="w-full bg-[#1E1E2E] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-400 font-mono placeholder-slate-700 resize-y focus:outline-none focus:border-violet-500/50"
      />

      {/* Options row */}
      <div className="flex items-center gap-3 text-[10px]">
        <label className="flex items-center gap-1 text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={hook.async_mode}
            onChange={(e) => onChange({ async_mode: e.target.checked })}
            className="rounded border-slate-600"
          />
          async
        </label>
        <label className="flex items-center gap-1 text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={hook.once}
            onChange={(e) => onChange({ once: e.target.checked })}
            className="rounded border-slate-600"
          />
          once
        </label>
        {hook.if_condition !== undefined && (
          <input
            type="text"
            value={hook.if_condition ?? ""}
            onChange={(e) => onChange({ if_condition: e.target.value || null })}
            placeholder="if: Bash(git *)"
            className="flex-1 bg-[#1E1E2E] border border-slate-700/50 rounded px-2 py-0.5 text-[10px] text-slate-500 font-mono placeholder-slate-700 focus:outline-none focus:border-violet-500/50"
          />
        )}
      </div>
    </div>
  );
}
