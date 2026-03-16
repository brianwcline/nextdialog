import claudeCodeSvg from "../assets/agent-icons/claude-code.svg?raw";
import codexSvg from "../assets/agent-icons/codex.svg?raw";
import geminiSvg from "../assets/agent-icons/gemini.svg?raw";
import terminalSvg from "../assets/agent-icons/terminal.svg?raw";
import aiderSvg from "../assets/agent-icons/aider.svg?raw";
const SVG_ICONS: Record<string, string> = {
  "claude-code": claudeCodeSvg,
  "codex-cli": codexSvg,
  "gemini-cli": geminiSvg,
  terminal: terminalSvg,
  aider: aiderSvg,
};

interface SessionTypeIconProps {
  id?: string;
  icon: string;
  color?: string;
  className?: string;
}

export function SessionTypeIcon({
  id,
  icon,
  color,
  className = "",
}: SessionTypeIconProps) {
  const svgContent = id ? SVG_ICONS[id] : undefined;

  if (svgContent) {
    return (
      <span
        className={`inline-flex items-center justify-center w-4 h-4 [&>svg]:w-full [&>svg]:h-full ${className}`}
        style={{ color }}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    );
  }

  // Fallback: path-based icon (img) or emoji
  if (icon.startsWith("/")) {
    return <img src={icon} alt="" className={`w-4 h-4 ${className}`} />;
  }
  return (
    <span className={className} style={{ color }}>
      {icon}
    </span>
  );
}
