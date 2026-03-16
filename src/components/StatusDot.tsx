import type { SessionStatus } from "../lib/types";

const statusColors: Record<SessionStatus, string> = {
  ready: "#94A3B8",
  stopped: "#94A3B8",
  starting: "#A78BFA",
  idle: "#22C55E",
  working: "#6366F1",
  planning: "#8B5CF6",
  waiting: "#F59E0B",
  error: "#EF4444",
};

const statusGlows: Record<SessionStatus, string> = {
  ready: "none",
  stopped: "none",
  starting: "none",
  idle: "none",
  working: "none",
  planning: "none",
  waiting: "0 0 12px rgba(245, 158, 11, 0.5)",
  error: "0 0 12px rgba(239, 68, 68, 0.5)",
};

interface StatusDotProps {
  status: SessionStatus;
  size?: number;
}

export function StatusDot({ status, size = 16 }: StatusDotProps) {
  const color = statusColors[status];

  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="inline-flex rounded-full w-full h-full"
        style={{ backgroundColor: color, boxShadow: statusGlows[status] }}
      />
    </span>
  );
}
