import { useRef, useEffect } from "react";
import { useTerminal } from "../hooks/useTerminal";

interface TerminalPaneProps {
  sessionId: string;
  visible: boolean;
}

export function TerminalPane({ sessionId, visible }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { focus } = useTerminal({ sessionId, containerRef, visible });

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(focus, 100);
      return () => clearTimeout(timer);
    }
  }, [visible, focus]);

  return (
    <div
      ref={containerRef}
      className="flex-1 p-1"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
