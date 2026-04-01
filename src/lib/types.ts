export type SessionStatus =
  | "ready"
  | "stopped"
  | "starting"
  | "idle"
  | "working"
  | "planning"
  | "waiting"
  | "error";

export interface Session {
  id: string;
  name: string;
  working_directory: string;
  skip_permissions: boolean;
  initial_prompt?: string;
  created_at: string;
  last_active: string;
  status: SessionStatus;
  session_type: string;
  parked: boolean;
  parent_id?: string;
  tuning?: SessionTuning;
  hookEnabled?: boolean;
  lastToolUse?: string;
  hookNotification?: string;
}

export interface TimelineEntry {
  timestamp: string;
  event_type: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface GroupedTimelineEntry {
  id: string;
  timestamp: string;
  event_type: string;
  summary: string;
  count: number;
  entries: TimelineEntry[];
}

export interface AgentConfig {
  permission_mode?: string;
  allowed_tools: string[];
  disallowed_tools: string[];
  model?: string;
  mcp_config_path?: string;
  append_system_prompt?: string;
  max_turns?: number;
  verbose: boolean;
  chrome_enabled?: boolean;
  additional_dirs: string[];
  custom_args: string[];
  custom_env: Record<string, string>;
}

export const defaultAgentConfig: AgentConfig = {
  allowed_tools: [],
  disallowed_tools: [],
  verbose: false,
  additional_dirs: [],
  custom_args: [],
  custom_env: {},
};

export interface SessionType {
  id: string;
  name: string;
  command: string;
  args: string[];
  icon: string;
  color: string;
  env: Record<string, string>;
  status_patterns: Record<string, string>;
  builtin: boolean;
  enabled: boolean;
  agent_config: AgentConfig;
  /** Runtime flag — true if the command binary exists on PATH. Set by useSessionTypes, not persisted. */
  available?: boolean;
}

// ── Session Tuning ──

export interface AgentConfigOverrides {
  permission_mode?: string | null;
  allowed_tools?: string[] | null;
  disallowed_tools?: string[] | null;
  model?: string | null;
  effort?: string | null;
  mcp_config_path?: string | null;
  append_system_prompt?: string | null;
  max_turns?: number | null;
  verbose?: boolean | null;
  chrome_enabled?: boolean | null;
  thinking_mode?: string | null;
  additional_dirs?: string[] | null;
  agent?: string | null;
  worktree?: boolean | null;
  bare?: boolean | null;
  custom_args?: string[] | null;
  custom_env?: Record<string, string> | null;
}

export type FileConfigKind =
  | "Command"
  | "Agent"
  | "Skill"
  | "OutputStyle"
  | "Rule"
  | "CursorHook"
  | "CursorSkill"
  | "GeminiCommand"
  | "ContextFile"
  | "McpConfig";

export interface FileConfig {
  kind: FileConfigKind;
  relative_path: string;
  content: string;
}

export interface HookEntry {
  event: string;
  matcher?: string | null;
  hook_type: string;
  command: string;
  if_condition?: string | null;
  timeout?: number | null;
  async_mode: boolean;
  once: boolean;
  model?: string | null;
  recipe_id?: string | null;
}

export interface PermissionRules {
  allow: string[];
  deny: string[];
}

export interface SessionTuning {
  profile_id?: string;
  config_overrides: AgentConfigOverrides;
  file_configs: FileConfig[];
  startup_commands: string[];
  hooks_config: HookEntry[];
  permission_rules: PermissionRules;
}

export interface TuningProfile {
  id: string;
  name: string;
  description?: string;
  agent_type: string;
  tuning: SessionTuning;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export const defaultSessionTuning: SessionTuning = {
  config_overrides: {},
  file_configs: [],
  startup_commands: [],
  hooks_config: [],
  permission_rules: { allow: [], deny: [] },
};
