interface TokenBurnBarProps {
  usage: number; // 0.0 - 1.0
}

export function TokenBurnBar({ usage }: TokenBurnBarProps) {
  const pct = Math.max(0, Math.min(1, usage)) * 100;

  const color = "#94A3B8";

  return (
    <div className="w-full group relative" title={`${Math.round(pct)}% context used`}>
      <div className="h-1 rounded-full bg-slate-200/30 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
