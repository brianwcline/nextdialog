import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { terminalOptions } from "../lib/terminal-theme";

interface UseTerminalOptions {
  sessionId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
}

export function useTerminal({
  sessionId,
  containerRef,
  visible,
}: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initRef = useRef(false);

  // Create terminal once
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const term = new Terminal(terminalOptions);
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    try {
      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = "11";
    } catch (err) {
      console.error("[useTerminal] Unicode11Addon failed:", err);
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Write input to PTY
    term.onData((data) => {
      invoke("write_to_pty", { id: sessionId, data }).catch(console.error);
    });

    // Intercept Cmd+V for clipboard image paste
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === "keydown" && e.key === "v" && e.metaKey) {
        invoke<boolean>("check_and_paste_clipboard_image", {
          id: sessionId,
        }).then((wasImage) => {
          if (!wasImage) {
            // Fall through to normal text paste
            navigator.clipboard.readText().then((text) => {
              if (text) {
                invoke("write_to_pty", { id: sessionId, data: text }).catch(
                  console.error,
                );
              }
            });
          }
        });
        return false; // Prevent default paste handling
      }
      return true;
    });

    // Listen for PTY data
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    listen<string>(`pty-data-${sessionId}`, (event) => {
      term.write(event.payload);
    }).then((fn) => {
      unlistenData = fn;
    });

    listen(`pty-exit-${sessionId}`, () => {
      term.write("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
    }).then((fn) => {
      unlistenExit = fn;
    });

    return () => {
      unlistenData?.();
      unlistenExit?.();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      initRef.current = false;
    };
  }, [sessionId]);

  // Mount/unmount terminal DOM
  useEffect(() => {
    const container = containerRef.current;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;

    if (!container || !term || !fitAddon) return;

    if (visible) {
      // Only open if not already attached
      if (!term.element) {
        term.open(container);
      }
      // Delay fit to let DOM settle, then scroll to latest content
      requestAnimationFrame(() => {
        fitAddon.fit();
        term.scrollToBottom();
      });
    }
  }, [visible, containerRef]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !fitAddon || !visible) return;

    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const term = termRef.current;
        if (term) {
          invoke("resize_pty", {
            id: sessionId,
            rows: term.rows,
            cols: term.cols,
          }).catch(() => {});
        }
      } catch {
        // fit can throw if container is 0-sized
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [sessionId, visible, containerRef]);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  return { terminal: termRef, focus };
}
