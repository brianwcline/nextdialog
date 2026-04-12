import { ShiftingGradient } from "./ShiftingGradient";
import type { SessionStatus } from "../lib/types";

interface AppBackgroundProps {
  sessionStatuses?: SessionStatus[];
  backgroundMode: string;
  backgroundImageUrl: string | null;
}

/**
 * App background layer. Non-default mood themes (Bauhaus, Memphis, Bento,
 * Risograph, Synthwave) paint their own backdrop via `body::before` /
 * `body::after` pseudo-elements and set `--nd-bg-layer-display: none` on
 * the `body`, which hides the wrapper below. The default Zen theme leaves
 * the CSS variable unset (falling back to `block`) and the gradient /
 * image layer renders normally.
 */
export function AppBackground({
  sessionStatuses,
  backgroundMode,
  backgroundImageUrl,
}: AppBackgroundProps) {
  // Wrap both branches so themes can toggle their visibility with one CSS rule.
  const wrapperStyle: React.CSSProperties = {
    display: "var(--nd-bg-layer-display, block)",
  };

  if (backgroundMode === "image" && backgroundImageUrl) {
    return (
      <div className="fixed -z-10 inset-0" style={wrapperStyle}>
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

  return (
    <div className="fixed -z-10 inset-0" style={wrapperStyle}>
      <ShiftingGradient sessionStatuses={sessionStatuses} />
    </div>
  );
}
