import { ShiftingGradient } from "./ShiftingGradient";
import type { SessionStatus } from "../lib/types";

interface AppBackgroundProps {
  sessionStatuses?: SessionStatus[];
  backgroundMode: string;
  backgroundImageUrl: string | null;
}

export function AppBackground({
  sessionStatuses,
  backgroundMode,
  backgroundImageUrl,
}: AppBackgroundProps) {
  if (backgroundMode === "image" && backgroundImageUrl) {
    return (
      <div className="fixed -z-10 inset-0">
        <img
          src={backgroundImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 background-scrim" />
        {/* Dot grid overlay — matches gradient mode */}
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: "radial-gradient(circle, #000 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>
    );
  }

  return <ShiftingGradient sessionStatuses={sessionStatuses} />;
}
