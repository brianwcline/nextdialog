import { motion } from "framer-motion";
import type { Session } from "../lib/types";
import { StatusDot } from "./StatusDot";

interface SessionCardProps {
  session: Session;
  index: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

const statusLabels: Record<string, string> = {
  stopped: "Stopped",
  starting: "Starting...",
  idle: "Idle",
  working: "Working...",
  planning: "Planning...",
  waiting: "Waiting for input",
  error: "Error",
};

export function SessionCard({
  session,
  index,
  onClick,
  onContextMenu,
}: SessionCardProps) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      whileHover={{ y: -4 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="w-[200px] h-[200px] rounded-3xl backdrop-blur-xl bg-white/15 border border-white/25 shadow-lg hover:shadow-xl transition-shadow cursor-pointer text-left p-5 flex flex-col justify-between"
    >
      <div>
        <h3 className="text-[15px] font-semibold text-slate-800 truncate">
          {session.name}
        </h3>
        <p className="text-xs text-slate-500 mt-1 truncate font-mono">
          {session.working_directory.replace(/^\/Users\/[^/]+/, "~")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusDot status={session.status} />
        <span className="text-xs text-slate-600">
          {statusLabels[session.status] ?? session.status}
        </span>
      </div>
    </motion.button>
  );
}
