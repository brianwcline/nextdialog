import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileConfig, FileConfigKind } from "../../lib/types";

// ── Agent-aware file kinds ──

interface FileKindOption {
  kind: FileConfigKind;
  label: string;
  pathTemplate: string;
  placeholder: string;
  description: string;
}

const CLAUDE_KINDS: FileKindOption[] = [
  {
    kind: "Command",
    label: "Command",
    pathTemplate: ".claude/commands/{name}.md",
    placeholder: "---\ndescription: Describe what this command does\nallowed-tools: Bash, Read, Edit, Write\n---\n\n# Command prompt here\n",
    description: "Slash command (.claude/commands/)",
  },
  {
    kind: "Agent",
    label: "Agent",
    pathTemplate: ".claude/agents/{name}.md",
    placeholder: "---\nname: agent-name\ndescription: What this agent does\nmodel: opus\ntools: [Read, Write, Edit, Bash, Grep, Glob]\nmaxTurns: 10\n---\n\n# Agent system prompt here\n",
    description: "Subagent definition (.claude/agents/)",
  },
  {
    kind: "Skill",
    label: "Skill",
    pathTemplate: ".claude/skills/{name}/SKILL.md",
    placeholder: "---\ndescription: What this skill provides\nuser-invocable: false\n---\n\n# Skill content\n",
    description: "Model-invocable skill (.claude/skills/)",
  },
  {
    kind: "OutputStyle",
    label: "Output Style",
    pathTemplate: ".claude/output-styles/{name}.md",
    placeholder: '---\nname: "Custom Style"\ndescription: "Brief, focused responses"\nkeep-coding-instructions: true\n---\n\nYour style instructions here.\n',
    description: "Response style (.claude/output-styles/)",
  },
  {
    kind: "ContextFile",
    label: "Context File",
    pathTemplate: "CLAUDE.md",
    placeholder: "# Project Context\n\nAdd project-specific instructions here.\n",
    description: "Always-loaded context (CLAUDE.md)",
  },
];

const CURSOR_KINDS: FileKindOption[] = [
  {
    kind: "Rule",
    label: "Rule",
    pathTemplate: ".cursor/rules/{name}.md",
    placeholder: "## Rule Title\n\n- Pattern to follow\n- Keep rules short\n- Reference files, don't copy content\n",
    description: "Always-on context (.cursor/rules/)",
  },
  {
    kind: "CursorSkill",
    label: "Skill",
    pathTemplate: ".cursor/skills/{name}/SKILL.md",
    placeholder: "# Skill content\n\nDynamic capability loaded when relevant.\n",
    description: "Dynamic capability (.cursor/skills/)",
  },
];

const GEMINI_KINDS: FileKindOption[] = [
  {
    kind: "ContextFile",
    label: "Context File",
    pathTemplate: ".gemini/GEMINI.md",
    placeholder: "# Project Context\n\nAdd project-specific instructions here.\nSupports @include syntax for modular context.\n",
    description: "Hierarchical context (.gemini/GEMINI.md)",
  },
  {
    kind: "GeminiCommand",
    label: "Command",
    pathTemplate: ".gemini/commands/{name}.toml",
    placeholder: 'description = "What this command does"\nprompt = """\nYour command prompt here.\n\n{{args}}\n"""\n',
    description: "TOML command (.gemini/commands/)",
  },
];

export function getFileKindsForAgent(sessionType: string): FileKindOption[] {
  switch (sessionType) {
    case "claude-code": return CLAUDE_KINDS;
    case "cursor-agent": return CURSOR_KINDS;
    case "gemini-cli": return GEMINI_KINDS;
    default: return [];
  }
}

// ── Install status type from backend ──

interface FileInstallStatus {
  relative_path: string;
  kind: string;
  status: "installed" | "modified" | "missing";
}

// ── Component ──

interface FileConfigsSectionProps {
  sessionId: string;
  sessionType: string;
  files: FileConfig[];
  onUpdate: (files: FileConfig[]) => void;
}

export function FileConfigsSection({ sessionId, sessionType, files, onUpdate }: FileConfigsSectionProps) {
  const [addingKind, setAddingKind] = useState<FileKindOption | null>(null);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [installStatus, setInstallStatus] = useState<FileInstallStatus[]>([]);

  const kinds = getFileKindsForAgent(sessionType);

  // Load install status
  useEffect(() => {
    if (files.length > 0) {
      invoke<FileInstallStatus[]>("get_tuning_install_status", { id: sessionId })
        .then(setInstallStatus)
        .catch(console.error);
    } else {
      setInstallStatus([]);
    }
  }, [sessionId, files]);

  const getStatus = useCallback(
    (path: string): FileInstallStatus["status"] | null => {
      const found = installStatus.find((s) => s.relative_path === path);
      return found?.status ?? null;
    },
    [installStatus],
  );

  // Start adding a new file config
  const startAdd = useCallback((kind: FileKindOption) => {
    setAddingKind(kind);
    setNewName("");
    setNewContent(kind.placeholder);
  }, []);

  // Confirm adding
  const confirmAdd = useCallback(() => {
    if (!addingKind || !newContent.trim()) return;

    const path = addingKind.pathTemplate.replace("{name}", newName || "untitled");
    const file: FileConfig = {
      kind: addingKind.kind,
      relative_path: path,
      content: newContent,
    };

    onUpdate([...files, file]);
    setAddingKind(null);
    setNewName("");
    setNewContent("");
  }, [addingKind, newName, newContent, files, onUpdate]);

  // Remove a file config
  const removeFile = useCallback(
    (index: number) => {
      onUpdate(files.filter((_, i) => i !== index));
    },
    [files, onUpdate],
  );

  // Update a file config's content
  const updateFileContent = useCallback(
    (index: number, content: string) => {
      onUpdate(files.map((f, i) => (i === index ? { ...f, content } : f)));
    },
    [files, onUpdate],
  );

  // Install files to disk
  const handleInstall = useCallback(async () => {
    try {
      await invoke("install_tuning_files", { id: sessionId });
      // Refresh status
      const status = await invoke<FileInstallStatus[]>("get_tuning_install_status", { id: sessionId });
      setInstallStatus(status);
    } catch (e) {
      console.error("Install failed:", e);
    }
  }, [sessionId]);

  // Uninstall a single file
  const handleUninstall = useCallback(
    async (relativePath: string) => {
      try {
        await invoke("uninstall_tuning_file", { id: sessionId, relativePath });
        const status = await invoke<FileInstallStatus[]>("get_tuning_install_status", { id: sessionId });
        setInstallStatus(status);
      } catch (e) {
        console.error("Uninstall failed:", e);
      }
    },
    [sessionId],
  );

  if (kinds.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Existing files */}
      {files.map((file, i) => {
        const status = getStatus(file.relative_path);
        const isEditing = editingIndex === i;

        return (
          <div key={i} className="rounded-lg border border-slate-700/30 bg-slate-800/20 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <KindBadge kind={file.kind} />
                <span className="text-[11px] text-slate-400 font-mono truncate">
                  {file.relative_path}
                </span>
                {status && <StatusBadge status={status} />}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setEditingIndex(isEditing ? null : i)}
                  className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {isEditing ? "Close" : "Edit"}
                </button>
                {status === "installed" && (
                  <button
                    onClick={() => handleUninstall(file.relative_path)}
                    className="text-[10px] text-slate-600 hover:text-red-400 transition-colors"
                  >
                    Uninstall
                  </button>
                )}
                <button
                  onClick={() => removeFile(i)}
                  className="text-slate-600 hover:text-red-400 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            {isEditing && (
              <div className="px-3 pb-3">
                <textarea
                  value={file.content}
                  onChange={(e) => updateFileContent(i, e.target.value)}
                  rows={8}
                  className="w-full bg-[#141422] border border-slate-700/50 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono resize-y focus:outline-none focus:border-violet-500/50"
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Add new file form */}
      {addingKind ? (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <KindBadge kind={addingKind.kind} />
            <span className="text-xs text-slate-300">{addingKind.description}</span>
          </div>
          {addingKind.pathTemplate.includes("{name}") && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 shrink-0">Name:</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ""))}
                placeholder="my-command"
                className="flex-1 bg-[#141422] border border-slate-700/50 rounded px-2 py-1 text-[11px] text-slate-300 font-mono focus:outline-none focus:border-violet-500/50"
                autoFocus
              />
            </div>
          )}
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={8}
            className="w-full bg-[#141422] border border-slate-700/50 rounded-lg px-3 py-2 text-[11px] text-slate-300 font-mono resize-y focus:outline-none focus:border-violet-500/50"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setAddingKind(null)}
              className="px-2.5 py-1 rounded text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmAdd}
              disabled={!newContent.trim()}
              className="px-2.5 py-1 rounded text-[11px] bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-30 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {kinds.map((kind) => (
            <button
              key={kind.kind}
              onClick={() => startAdd(kind)}
              className="px-2.5 py-1.5 rounded-lg border border-dashed border-slate-700/50 text-[11px] text-slate-600 hover:text-slate-400 hover:border-slate-600/50 transition-colors"
            >
              + {kind.label}
            </button>
          ))}
        </div>
      )}

      {/* Install button */}
      {files.length > 0 && (
        <button
          onClick={handleInstall}
          className="w-full py-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-xs text-violet-300 hover:bg-violet-500/20 transition-colors"
        >
          Install {files.length} file{files.length !== 1 ? "s" : ""} to project
        </button>
      )}
    </div>
  );
}

// ── Sub-components ──

function KindBadge({ kind }: { kind: FileConfigKind }) {
  const colors: Record<string, string> = {
    Command: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    Agent: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    Skill: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    OutputStyle: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    Rule: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    CursorHook: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    CursorSkill: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    GeminiCommand: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    ContextFile: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    McpConfig: "bg-pink-500/15 text-pink-400 border-pink-500/30",
  };

  return (
    <span className={`px-1.5 py-0.5 rounded border text-[9px] font-medium ${colors[kind] ?? colors.ContextFile}`}>
      {kind}
    </span>
  );
}

function StatusBadge({ status }: { status: "installed" | "modified" | "missing" }) {
  const styles = {
    installed: "text-emerald-500",
    modified: "text-amber-500",
    missing: "text-slate-600",
  };
  const icons = {
    installed: "\u2713",
    modified: "\u26a0",
    missing: "\u2014",
  };

  return (
    <span className={`text-[9px] ${styles[status]}`} title={status}>
      {icons[status]}
    </span>
  );
}
