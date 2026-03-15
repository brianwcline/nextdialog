export type SessionStatus =
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
}

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
}
