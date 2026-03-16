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
  hookEnabled?: boolean;
  lastToolUse?: string;
  hookNotification?: string;
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
}
