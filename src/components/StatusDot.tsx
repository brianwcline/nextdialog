import { motion } from "framer-motion";
import type { SessionStatus } from "../lib/types";

const statusColors: Record<SessionStatus, string> = {
  stopped: "#94A3B8",
  starting: "#A78BFA",
  idle: "#22C55E",
  working: "#6366F1",
  planning: "#8B5CF6",
  waiting: "#F59E0B",
  error: "#EF4444",
};

const pulseStatuses = new Set<SessionStatus>(["starting", "working", "planning"]);

interface StatusDotProps {
  status: SessionStatus;
  size?: number;
}

export function StatusDot({ status, size = 10 }: StatusDotProps) {
  const color = statusColors[status];
  const shouldPulse = pulseStatuses.has(status);

  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {shouldPulse && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: color }}
          animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span
        className="relative inline-flex rounded-full w-full h-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}
