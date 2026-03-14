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
}
