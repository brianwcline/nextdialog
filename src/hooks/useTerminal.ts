import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { terminalOptions } from "../lib/terminal-theme";

// === TEMPORARY: always-on debug logging ===
const D = (...args: unknown[]) => console.log("[term-debug]", ...args);

// Tolerance for "at bottom" checks — ink can leave viewport 1-2 rows short
const BOTTOM_MARGIN = 3;

// After a resize, force auto-scroll for this many ms. Ink re-renders
// triggered by SIGWINCH can take several hundred ms and the intermediate
// buffer states cause isAtBottomRef to flip false via onScroll races.
const RESIZE_GRACE_MS = 2000;

interface UseTerminalOptions {
  sessionId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  visible: boolean;
}

/** Dump all scroll-related state for debugging */
function dumpState(label: string, term: Terminal) {
  const buf = term.buffer.active;
  const el = term.element;
  const viewport = el?.querySelector(".xterm-viewport") as HTMLElement | null;
  const scrollArea = el?.querySelector(
    ".xterm-scroll-area",
  ) as HTMLElement | null;

  const state: Record<string, unknown> = {
    "buf.baseY": buf.baseY,
    "buf.viewportY": buf.viewportY,
    "buf.length": buf.length,
    "buf.type": buf.type,
    "term.rows": term.rows,
    "term.cols": term.cols,
  };

  if (viewport) {
    state["vp.scrollTop"] = Math.round(viewport.scrollTop);
    state["vp.scrollHeight"] = viewport.scrollHeight;
    state["vp.clientHeight"] = viewport.clientHeight;
    state["vp.maxScroll"] = viewport.scrollHeight - viewport.clientHeight;
  }

  if (scrollArea) {
    state["sa.offsetHeight"] = scrollArea.offsetHeight;
    state["sa.style.height"] = scrollArea.style.height;
  }

  if (viewport && term.rows > 0) {
    const cellHeight = viewport.clientHeight / term.rows;
    state["cellHeight"] = Math.round(cellHeight * 100) / 100;
    state["expectedSAHeight"] = Math.round(buf.length * cellHeight);
  }

  D(label, state);
}

/**
 * Sync the xterm viewport scroll area height to match the actual buffer size.
 */
function syncViewportScrollArea(term: Terminal, label: string) {
  const el = term.element;
  if (!el) return;
  const viewport = el.querySelector(".xterm-viewport") as HTMLElement | null;
  const scrollArea = el.querySelector(
    ".xterm-scroll-area",
  ) as HTMLElement | null;
  if (!viewport || !scrollArea) return;

  const buf = term.buffer.active;
  const cellHeight = viewport.clientHeight / term.rows;
  if (cellHeight <= 0) return;

  const correctHeight = buf.length * cellHeight;
  const currentHeight = scrollArea.offsetHeight;
  const diff = Math.abs(correctHeight - currentHeight);

  if (diff > cellHeight * 0.5) {
    D(`syncViewport(${label}): FIXING height`, {
      from: Math.round(currentHeight),
      to: Math.round(correctHeight),
      bufLength: buf.length,
    });
    scrollArea.style.height = `${correctHeight}px`;
  }
}

export function useTerminal({
  sessionId,
  containerRef,
  visible,
}: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const pendingWrites = useRef(0);
  // Grace period: after resize, force auto-scroll regardless of isAtBottomRef
  const forceAutoScrollUntil = useRef(0);

  const [showScrollIndicator, setShowScrollIndicator] = useState(false);

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

    // Track whether viewport is at the bottom of scrollback
    term.onScroll(() => {
      if (pendingWrites.current > 0) return;
      // During resize grace period, don't let scroll events flip isAtBottom
      if (Date.now() < forceAutoScrollUntil.current) return;
      const buf = term.buffer.active;
      const atBottom =
        buf.baseY + term.rows + BOTTOM_MARGIN >= buf.length;
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        setShowScrollIndicator(false);
      }
    });

    // Post-render position tracking — fires after ink rewrites complete
    term.onWriteParsed(() => {
      if (pendingWrites.current > 0) return;
      const buf = term.buffer.active;
      const atBottom =
        buf.baseY + term.rows + BOTTOM_MARGIN >= buf.length;
      if (atBottom) {
        isAtBottomRef.current = true;
        setShowScrollIndicator(false);
      }
    });

    // Alternate buffer awareness (normal ↔ alt screen transitions)
    term.buffer.onBufferChange((buf) => {
      D("bufferChange", { newType: buf.type });
      if (buf.type === "normal") {
        isAtBottomRef.current = true;
        term.scrollToBottom();
        setShowScrollIndicator(false);
      }
    });

    // Write input to PTY — always snap to bottom so the user sees the prompt
    term.onData((data) => {
      term.scrollToBottom();
      isAtBottomRef.current = true;
      setShowScrollIndicator(false);
      invoke("write_to_pty", { id: sessionId, data }).catch(console.error);
    });

    // Intercept paste to check for clipboard images first, then fall back to text
    const textarea = term.textarea;
    if (textarea) {
      textarea.addEventListener("paste", (e) => {
        e.preventDefault();
        e.stopPropagation();
        invoke<boolean>("check_and_paste_clipboard_image", {
          id: sessionId,
        }).then((wasImage) => {
          if (!wasImage) {
            const text = e.clipboardData?.getData("text/plain");
            if (text) {
              term.paste(text);
            }
          }
        });
      });
    }

    // Listen for PTY data — pending-write counter replaces boolean guard
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    // Suppress output during restart (between pty-restart and new session data)
    let suppressUntil = 0;

    listen<string>(`pty-data-${sessionId}`, (event) => {
      // Drop output from the dying session during restart
      if (suppressUntil > 0) {
        if (Date.now() < suppressUntil) return;
        suppressUntil = 0; // Grace period expired, accept new output
      }

      pendingWrites.current++;
      const inGracePeriod = Date.now() < forceAutoScrollUntil.current;
      const shouldAutoScroll = isAtBottomRef.current || inGracePeriod;

      if (inGracePeriod) {
        D("write: grace period active, forcing auto-scroll");
      }

      term.write(event.payload, () => {
        pendingWrites.current--;

        if (pendingWrites.current === 0) {
          const buf = term.buffer.active;
          const atBottom =
            buf.baseY + term.rows + BOTTOM_MARGIN >= buf.length;

          syncViewportScrollArea(term, "write-cb");

          if (shouldAutoScroll || atBottom) {
            term.scrollToBottom();
            isAtBottomRef.current = true;
            setShowScrollIndicator(false);
          } else {
            setShowScrollIndicator(true);
          }

          requestAnimationFrame(() => {
            syncViewportScrollArea(term, "write-cb-rAF");
          });
        }
      });
    }).then((fn) => {
      unlistenData = fn;
    });

    // Clear terminal and suppress old output during restart
    let unlistenRestart: UnlistenFn | null = null;
    listen(`pty-restart-${sessionId}`, () => {
      suppressUntil = Date.now() + 500; // Suppress output for 500ms
      term.clear();
      term.reset();
      // Re-fit and resize so the new session gets correct dimensions
      requestAnimationFrame(() => {
        fitAddon.fit();
        invoke("resize_pty", {
          id: sessionId,
          rows: term.rows,
          cols: term.cols,
        }).catch(() => {});
      });
    }).then((fn) => {
      unlistenRestart = fn;
    });

    const spawnTime = Date.now();

    listen(`pty-exit-${sessionId}`, () => {
      const aliveMs = Date.now() - spawnTime;
      if (aliveMs < 3000) {
        // Process exited almost immediately — likely command not found or crash
        term.write(
          "\r\n\x1b[31m[Session exited immediately]\x1b[0m\r\n" +
          "\x1b[90mThe process exited within " + Math.round(aliveMs / 1000) + "s of starting.\r\n" +
          "This usually means the command was not found on your PATH.\r\n" +
          "Check that the tool is installed and accessible from your shell.\x1b[0m\r\n",
        );
      } else {
        term.write("\r\n\x1b[90m[Session ended]\x1b[0m\r\n");
      }
    }).then((fn) => {
      unlistenExit = fn;
    });

    return () => {
      unlistenData?.();
      unlistenExit?.();
      unlistenRestart?.();
      try {
        term.dispose();
      } catch (err) {
        console.warn("[useTerminal] dispose error (safe to ignore):", err);
      }
      termRef.current = null;
      fitAddonRef.current = null;
      initRef.current = false;
    };
  }, [sessionId]);

  // Mount/unmount terminal DOM + sync PTY size + wheel stuck detector
  useEffect(() => {
    const container = containerRef.current;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;

    if (!container || !term || !fitAddon) return;

    let wheelCleanup: (() => void) | null = null;
    let mountSettleTimer: ReturnType<typeof setTimeout> | null = null;

    if (visible) {
      if (!term.element) {
        term.open(container);
      }
      // Mount is effectively a resize — enable grace period
      forceAutoScrollUntil.current = Date.now() + RESIZE_GRACE_MS;
      D("mount: fitting terminal, grace period active");

      requestAnimationFrame(() => {
        fitAddon.fit();
        invoke("resize_pty", {
          id: sessionId,
          rows: term.rows,
          cols: term.cols,
        }).catch(() => {});
        dumpState("mount: after fit", term);
        requestAnimationFrame(() => {
          syncViewportScrollArea(term, "mount-rAF");
          term.scrollToBottom();
          dumpState("mount: after scrollToBottom", term);
        });
      });

      // Delayed refit: the webview can reload during macOS fullscreen
      // transitions, mounting the terminal before the window reaches its
      // final size. This second fit catches the settled geometry.
      mountSettleTimer = setTimeout(() => {
        const prevRows = term.rows;
        fitAddon.fit();
        if (term.rows !== prevRows) {
          D("mount-settle: rows changed", prevRows, "→", term.rows);
          invoke("resize_pty", {
            id: sessionId,
            rows: term.rows,
            cols: term.cols,
          }).catch(() => {});
          syncViewportScrollArea(term, "mount-settle");
          term.scrollToBottom();
        }
      }, 800);

      // Wheel stuck detector
      const viewport = term.element?.querySelector(
        ".xterm-viewport",
      ) as HTMLElement | null;
      if (viewport) {
        const handleWheel = (e: WheelEvent) => {
          if (e.deltaY <= 0) return;
          requestAnimationFrame(() => {
            const maxScroll =
              viewport.scrollHeight - viewport.clientHeight;
            if (maxScroll <= 0) return;

            if (viewport.scrollTop >= maxScroll - 1) {
              const buf = term.buffer.active;
              const cellHeight = viewport.clientHeight / term.rows;
              if (cellHeight <= 0) return;

              const expectedMaxScroll =
                buf.length * cellHeight - viewport.clientHeight;

              if (expectedMaxScroll > maxScroll + cellHeight) {
                D("wheel-snap: scroll area stale, snapping to bottom");
                syncViewportScrollArea(term, "wheel-snap");
                term.scrollToBottom();
                isAtBottomRef.current = true;
                setShowScrollIndicator(false);
              }
            }
          });
        };
        viewport.addEventListener("wheel", handleWheel, { passive: true });
        wheelCleanup = () =>
          viewport.removeEventListener("wheel", handleWheel);
      }
    }

    return () => {
      wheelCleanup?.();
      if (mountSettleTimer) clearTimeout(mountSettleTimer);
    };
  }, [visible, containerRef, sessionId]);

  // Resize observer (debounced to avoid SIGWINCH storms for TUI apps)
  useEffect(() => {
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !fitAddon || !visible) return;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    // Settle timer: catches the final container size after macOS
    // fullscreen animations (the ResizeObserver debounce may fire
    // mid-animation, leaving term.rows at the wrong value).
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRows = 0;
    let lastCols = 0;

    const doResize = (label: string) => {
      try {
        const term = termRef.current;
        if (!term) return;

        const wasAtBottom = isAtBottomRef.current;
        const prevRows = term.rows;
        const prevCols = term.cols;

        fitAddon.fit();

        // Skip if dimensions haven't changed (settle timer no-op)
        if (term.rows === lastRows && term.cols === lastCols) return;
        lastRows = term.rows;
        lastCols = term.cols;

        D(`resize(${label}): ${prevRows}×${prevCols} → ${term.rows}×${term.cols}, wasAtBottom:`, wasAtBottom);
        dumpState(`resize(${label}): post-fit`, term);

        invoke("resize_pty", {
          id: sessionId,
          rows: term.rows,
          cols: term.cols,
        }).catch(() => {});

        // Enable grace period — ink will re-render after SIGWINCH and
        // the intermediate buffer states must not flip isAtBottomRef
        if (wasAtBottom) {
          forceAutoScrollUntil.current = Date.now() + RESIZE_GRACE_MS;
          isAtBottomRef.current = true;
          D(`resize(${label}): grace period ACTIVATED`);
        }

        // Double-rAF to let xterm process resize + render
        requestAnimationFrame(() => {
          syncViewportScrollArea(term, `${label}-rAF1`);
          requestAnimationFrame(() => {
            syncViewportScrollArea(term, `${label}-rAF2`);
            if (wasAtBottom || isAtBottomRef.current) {
              term.scrollToBottom();
              isAtBottomRef.current = true;
              D(`resize(${label}): scrolled to bottom`);
            }
          });
        });
      } catch (err) {
        D("resize: error", err);
      }
    };

    const observer = new ResizeObserver(() => {
      // Quick debounce (100ms) for responsive resize
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => doResize("debounce"), 100);

      // Settle timer (600ms) — catches final size after macOS
      // fullscreen animation completes. Resets on every event,
      // so it fires 600ms after the LAST resize event.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => doResize("settle"), 600);
    });

    observer.observe(container);

    // Window resize listener: the container's ResizeObserver may not
    // detect height changes when the viewport shrinks (e.g., macOS
    // fullscreen → windowed) because CSS layout of the overlay/flex
    // containers can lag behind the actual viewport change. Listening
    // to the window resize event catches these.
    const handleWindowResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => doResize("window"), 150);
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => doResize("window-settle"), 800);
    };
    window.addEventListener("resize", handleWindowResize);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      if (settleTimer) clearTimeout(settleTimer);
      observer.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [sessionId, visible, containerRef]);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  const scrollToBottom = useCallback(() => {
    const term = termRef.current;
    if (!term) return;

    D("scrollToBottom: CALLED (Cmd+Down or indicator click)");
    dumpState("scrollToBottom: before", term);

    syncViewportScrollArea(term, "scrollToBottom");
    term.scrollToBottom();

    // Belt-and-suspenders: directly set DOM scrollTop
    const viewport = term.element?.querySelector(
      ".xterm-viewport",
    ) as HTMLElement | null;
    if (viewport) {
      const before = viewport.scrollTop;
      viewport.scrollTop = viewport.scrollHeight;
      D("scrollToBottom: DOM fallback", {
        scrollTopBefore: Math.round(before),
        scrollTopAfter: Math.round(viewport.scrollTop),
        scrollHeight: viewport.scrollHeight,
        clientHeight: viewport.clientHeight,
      });
    }

    dumpState("scrollToBottom: after", term);
    isAtBottomRef.current = true;
    setShowScrollIndicator(false);
  }, []);

  return { terminal: termRef, focus, showScrollIndicator, scrollToBottom };
}
