import { useRef } from "react";
import { useGradient } from "../hooks/useGradient";
import type { SessionStatus } from "../lib/types";

interface ShiftingGradientProps {
  sessionStatuses?: SessionStatus[];
}

export function ShiftingGradient({ sessionStatuses }: ShiftingGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useGradient({ canvasRef, sessionStatuses });

  return (
    <div className="fixed inset-0 -z-10">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      {/* Dot grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `radial-gradient(circle, #000 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
      />
    </div>
  );
}
