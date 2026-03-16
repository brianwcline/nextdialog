# NextDialog — Full Build Plan

**A calm, design-first desktop app for managing multiple Claude Code sessions.**

Built with Tauri 2 + React + xterm.js. Designed around the cognitive limits of human attention.

---

## 1. Vision & Positioning

### What NextDialog Is

NextDialog is a lightweight desktop application that gives developers a serene home base for managing multiple Claude Code terminal sessions. Instead of juggling terminal windows and losing context, developers launch NextDialog, see all their sessions as glanceable status cards on a calming gradient background, click into any session to interact with it, and close the window to return to a zen state.

### What NextDialog Is Not

NextDialog is not a full IDE, not a Git client, not a diff viewer, and not an agent orchestrator. It deliberately does less than competing tools like 1Code, Agent Deck, or Claudia GUI. The differentiation is design and cognitive ergonomics — informed by BCG research showing productivity drops after 3 simultaneous AI tools and that "AI brain fry" drives 33% more decision fatigue and 39% higher intent to quit.

### Design Principles

1. **Calm over capability.** The app should lower your heart rate, not raise it.
2. **Glanceable status.** You should know the state of every session in under 2 seconds.
3. **Zero-friction transitions.** Click in, do your thing, click out. No cognitive residue.
4. **Respect the CLI.** Claude Code is the engine. NextDialog is the dashboard, not a replacement.
5. **3-session sweet spot.** Optimized for 2-4 concurrent sessions based on the productivity cliff research.

---

## 2. Technology Stack

### Core Framework

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| App shell | Tauri 2.x | ~5MB binary, 30-40MB RAM idle, 0.4s launch. Matches the "lightweight calm tool" identity. |
| Backend | Rust | Required by Tauri. Handles PTY spawning, status detection, clipboard bridge. |
| Frontend | React 18 + TypeScript | Matches existing skill system. Large ecosystem for xterm.js integration. |
| Terminal | xterm.js + @xterm/addon-fit | Industry standard terminal emulator for web. Used by VS Code, Hyper, Wave Terminal. |
| PTY | tauri-plugin-pty + portable-pty | Spawns real pseudo-terminals for Claude Code processes. Tauri 2 compatible. |
| Build | Vite | Fast HMR for frontend development. Native Tauri integration. |
| Styling | CSS Modules or Tailwind | Keep it simple. No component library — every element is custom. |

### Key Dependencies

**Rust (src-tauri/Cargo.toml):**
- `tauri` 2.x
- `tauri-plugin-pty` 0.1.x
- `portable-pty` 0.9.x
- `serde` / `serde_json` — serialization
- `regex` — stdout pattern matching for status detection
- `clipboard` or `arboard` — clipboard image access

**JavaScript (package.json):**
- `@tauri-apps/api` 2.x
- `@tauri-apps/plugin-shell` — process spawning
- `xterm` + `@xterm/addon-fit` + `@xterm/addon-webgl` — terminal rendering
- `tauri-pty` — JS bindings for the PTY plugin
- `react` 18.x + `react-dom`
- `framer-motion` — subtle animations (card entrance, modal transitions)

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│                    FRONTEND (React)                   │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Home View   │  │  Terminal    │  │  New Session │ │
│  │  (gradient + │  │  Overlay     │  │  Modal       │ │
│  │   cards)     │  │  (xterm.js)  │  │              │ │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                │                  │         │
│         └────────────────┼──────────────────┘         │
│                          │                            │
│                    Tauri IPC                           │
├──────────────────────────┼────────────────────────────┤
│                          │                            │
│                  BACKEND (Rust)                        │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │              Session Manager                    │   │
│  │  - Create / destroy sessions                    │   │
│  │  - Maintain session registry                    │   │
│  │  - Persist session config to disk               │   │
│  └────────────────────┬───────────────────────────┘   │
│                       │                               │
│  ┌────────────────────┼───────────────────────────┐   │
│  │              PTY Pool                           │   │
│  │  - Spawn claude CLI in pseudo-terminal          │   │
│  │  - Manage stdin/stdout pipes                    │   │
│  │  - Handle resize events                         │   │
│  └────────────────────┬───────────────────────────┘   │
│                       │                               │
│  ┌────────────────────┼───────────────────────────┐   │
│  │          Status Detector                        │   │
│  │  - Monitor stdout stream per session            │   │
│  │  - Pattern match for prompt / working / error   │   │
│  │  - Emit status change events to frontend        │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
│  ┌──────────────────┐  ┌─────────────────────────┐   │
│  │  Clipboard Bridge │  │  File Drop Handler     │   │
│  │  (image paste)    │  │  (drag & drop → PTY)   │   │
│  └──────────────────┘  └─────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

### Data Flow

1. **User creates session** → Frontend sends IPC `create_session { name, skip_permissions }` → Rust spawns `claude [--dangerously-skip-permissions]` in a PTY → Returns session ID
2. **User opens session** → Frontend requests PTY attachment → xterm.js connects to PTY stdout stream → User sees terminal output
3. **User types** → xterm.js captures keystrokes → Writes to PTY stdin → Claude Code receives input
4. **Status detection** → Rust backend continuously reads PTY stdout → Applies regex patterns → Emits `session_status_changed` event → Frontend updates card dot color
5. **User closes overlay** → PTY remains alive in background → Status detection continues → Card reflects live state
6. **Drag & drop** → Tauri `drag-drop` event fires → Rust gets file path → Writes path string to PTY stdin → Claude Code receives file reference

---

## 4. Session Lifecycle

### States

| State | Indicator | Detection Method |
|-------|-----------|-----------------|
| **Idle** | Green dot | Prompt character detected, no output for 2+ seconds |
| **Working** | Indigo dot (pulsing) | Continuous stdout output flowing |
| **Planning** | Purple dot (pulsing) | Plan mode indicator detected in output |
| **Waiting** | Amber dot (pulsing) | Question pattern detected + cursor at input position |
| **Error** | Red dot | Error pattern in stdout (stack trace, "ERROR", non-zero exit) |
| **Stopped** | Gray dot | PTY process exited |

### Status Detection Patterns (Rust)

```
IDLE:       /^❯\s*$/ or /^>\s*$/ followed by 2s silence
WORKING:    Continuous character output within 500ms intervals
PLANNING:   /⏸ plan mode/ in output stream
WAITING:    /\?\s*$/ or /\(y\/n\)/ or /Which.*\?/ at end of output + silence
ERROR:      /Error:/ or /ERROR/ or /panic/ or exit code != 0
STOPPED:    PTY child process exit event
```

### Session Persistence

Sessions persist across app restarts via a JSON config file at `~/.nextdialog/sessions.json`:

```json
{
  "sessions": [
    {
      "id": "uuid-v4",
      "name": "carehub-frontend",
      "working_directory": "/Users/brian/projects/carehub/frontend",
      "skip_permissions": true,
      "created_at": "2026-03-14T10:00:00Z",
      "last_active": "2026-03-14T14:30:00Z"
    }
  ]
}
```

On app launch, previously active sessions are shown as "Stopped" cards that can be relaunched with one click. Claude Code's `--continue` flag resumes the last conversation in that directory.

---

## 5. Feature Specification

### 5.1 Home View

**The default screen.** A full-viewport animated gradient background with session cards floating on top.

- **Gradient:** Three radial gradients with slowly oscillating hue (220-280 range), position, and opacity. Shifts through soft blues, lavenders, and teals. Subtle dot grid texture underneath.
- **Top bar:** "NextDialog" wordmark (DM Sans 700) + session count + "+ New Session" button (frosted glass).
- **Session cards:** 200×200px rounded squares (border-radius: 24px). Frosted glass (`backdrop-filter: blur(20px)`, semi-transparent white). Session name in DM Sans 600. Status dot + label at bottom. Hover lifts card 4px with shadow transition.
- **Empty state:** Centered diamond icon with gentle float animation. "No sessions yet" + "Launch a session to start working with Claude Code."
- **Card grid:** Flexbox wrap, centered, 20px gap. Max 4 per row.

### 5.2 New Session Modal

Triggered by "+ New Session" button. Frosted backdrop overlay.

**Fields:**
- **Session name** — Text input. Required. Placeholder: "my-project". Auto-slugified.
- **Working directory** — Text input with folder picker button. Defaults to `~`. The folder picker uses Tauri's native file dialog.
- **Skip permissions** — Toggle switch. Label: "Skip permissions" with subtitle "Auto-approve file and command operations". Maps to `--dangerously-skip-permissions` flag.
- **Initial prompt** (optional) — Textarea. If provided, sent to Claude Code immediately after session starts via the `-p` flag or stdin write.

**Actions:** Cancel (ghost) + Launch (primary, dark). Launch disabled until name is non-empty. ESC closes.

### 5.3 Terminal Overlay

Clicking a session card opens a modal overlay with the full terminal.

- **Container:** Centered card, `min(90%, 840px)` wide, `min(80vh, 640px)` tall. White background, border-radius 20px.
- **Header:** Session name + status badge (colored dot + label in pill). Close button (✕) at right.
- **Terminal body:** xterm.js instance, full width/height of remaining space. Light theme (white background, dark text). Font: Geist Mono or JetBrains Mono at 13px.
- **Input area:** Bottom bar with indigo arrow prompt (→), text input, ESC hint badge.
- **Keyboard:** ESC closes overlay. All other input passes to xterm.js → PTY.

**Terminal theme (light):**
```
background: #FFFFFF
foreground: #1E293B
cursor: #6366F1
selection: rgba(99, 102, 241, 0.15)
black: #1E293B
red: #DC2626
green: #16A34A
yellow: #CA8A04
blue: #2563EB
magenta: #9333EA
cyan: #0891B2
white: #F1F5F9
```

### 5.4 Drag & Drop Support

- **File drop on terminal overlay:** Tauri intercepts `drag-drop` event, extracts file path(s), writes them to PTY stdin as space-separated paths. Works for images, code files, any file Claude Code can reference.
- **Image paste (Ctrl+V):** The Rust clipboard bridge detects image content on clipboard, saves to temp file (`/tmp/nextdialog-paste-{timestamp}.png`), writes path to PTY stdin. Matches Claude Code's existing Ctrl+V behavior.
- **File drop on home view:** Dropping a folder on the home view opens the New Session modal with that folder pre-filled as the working directory.

### 5.5 Session Management

- **Kill session:** Right-click card → "End Session". Sends SIGTERM to PTY child process. Card transitions to Stopped state.
- **Restart session:** Click Stopped card → Confirm restart. Spawns new PTY with `claude --continue` in the same working directory.
- **Remove session:** Right-click card → "Remove". Kills process if running, removes from registry. Card animates out.
- **Rename session:** Right-click card → "Rename". Inline edit on card name.

### 5.6 Notifications

- **System notifications:** When a session transitions from Working → Waiting (Claude needs input), fire a macOS/Windows native notification: "[session-name] needs your input."
- **Badge count:** App dock icon shows badge with count of sessions in Waiting state.
- **Audio cue (optional):** Subtle chime on state transition to Waiting. Configurable in settings.

---

## 6. Claude Code Feature Parity Matrix

Every Claude Code CLI capability must work through NextDialog's PTY layer.

| Feature | How It Works in NextDialog | Special Handling Required |
|---------|---------------------------|-------------------------|
| Text input / prompts | xterm.js → PTY stdin | None — pass-through |
| Drag & drop images | Tauri drag-drop event → file path → PTY stdin | Yes — Rust file drop handler |
| Clipboard image paste (Ctrl+V) | Clipboard bridge saves temp file → path to PTY stdin | Yes — Rust clipboard bridge |
| File path references (@) | Pass-through via terminal | None |
| Slash commands (/clear, /compact) | Pass-through via terminal | None |
| Plan mode (Shift+Tab) | Terminal escape sequence pass-through | None |
| Auto-accept mode (Shift+Tab) | Terminal escape sequence pass-through | None |
| Message queuing | Pass-through — multiple inputs to PTY stdin | None |
| MCP server integration | Claude reads ~/.claude config natively | None |
| Extended thinking (Ctrl+O) | Terminal escape sequence pass-through | None |
| Session resume (--continue) | Passed as CLI flag on session restart | Yes — session manager |
| Terminal resize | xterm.js addon-fit → PTY resize signal (SIGWINCH) | Yes — resize handler |
| Color / ANSI output | xterm.js renders natively | None |
| Link clicking (Cmd+Click) | xterm.js link handler addon | Yes — @xterm/addon-web-links |
| Git operations | Claude runs git via PTY — pass-through | None |
| Hooks / notifications | Claude's hook system fires natively in the PTY | None |

---

## 7. Project Structure

```
nextdialog/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json          # Permissions for shell, PTY, clipboard, file drop
│   ├── icons/                    # App icons (all sizes)
│   └── src/
│       ├── main.rs               # Tauri app entry point
│       ├── lib.rs                # Plugin registration
│       ├── session/
│       │   ├── mod.rs
│       │   ├── manager.rs        # Session CRUD, persistence
│       │   └── config.rs         # Session config types
│       ├── pty/
│       │   ├── mod.rs
│       │   ├── pool.rs           # PTY spawning and lifecycle
│       │   └── resize.rs         # Terminal resize handling
│       ├── status/
│       │   ├── mod.rs
│       │   └── detector.rs       # Stdout pattern matching, state machine
│       ├── clipboard/
│       │   ├── mod.rs
│       │   └── bridge.rs         # Image detection, temp file, path injection
│       └── commands.rs           # Tauri IPC command handlers
├── src/
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Root component, routing
│   ├── components/
│   │   ├── HomeView.tsx          # Gradient + card grid
│   │   ├── SessionCard.tsx       # Individual session card
│   │   ├── TerminalOverlay.tsx   # Modal with xterm.js
│   │   ├── NewSessionModal.tsx   # Session creation form
│   │   ├── ShiftingGradient.tsx  # Animated background
│   │   ├── StatusDot.tsx         # Animated status indicator
│   │   └── Toggle.tsx            # Skip permissions toggle
│   ├── hooks/
│   │   ├── useSession.ts         # Session CRUD via Tauri IPC
│   │   ├── useTerminal.ts        # xterm.js lifecycle management
│   │   ├── useStatus.ts          # Listen for status change events
│   │   └── useGradient.ts        # Animation frame gradient driver
│   ├── lib/
│   │   ├── tauri.ts              # Typed IPC wrappers
│   │   ├── terminal-theme.ts     # xterm.js theme config
│   │   └── types.ts              # Shared TypeScript types
│   └── styles/
│       ├── global.css            # Base styles, fonts, animations
│       └── terminal.css          # xterm.js overrides
├── public/
│   └── fonts/                    # DM Sans, Geist Mono (self-hosted)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 8. Build Phases

### Phase 0 — Scaffold (Day 1)

**Goal:** Bootable Tauri 2 + React app with hot reload.

- [ ] `npm create tauri-app@latest nextdialog -- --template react-ts`
- [ ] Configure `tauri.conf.json` — app name, window config (transparent, decorations off for custom titlebar if desired), permissions
- [ ] Install frontend deps: `xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `framer-motion`
- [ ] Install Rust deps: `tauri-plugin-pty`, `serde`, `regex`, `arboard`
- [ ] Verify `tauri dev` launches with React HMR
- [ ] Self-host DM Sans + Geist Mono fonts

**Deliverable:** Empty app window with React rendering "NextDialog" text.

### Phase 1 — Home View (Days 2-3)

**Goal:** The calm home screen with animated gradient and empty state.

- [ ] Build `ShiftingGradient` component — three radial gradients animated via `requestAnimationFrame`
- [ ] Build top bar — wordmark, session count, "+ New Session" button with frosted glass style
- [ ] Build empty state — floating diamond icon, subtitle text, fade-up animation
- [ ] Build `SessionCard` component — frosted glass, status dot, hover lift, staggered entrance animation
- [ ] Wire cards to local React state (mock data) to verify layout and animations
- [ ] Test on macOS WebKit webview (verify `backdrop-filter` works — it's a WebKit-originated property, so this should be fine)

**Deliverable:** Beautiful home screen with mock session cards. No backend wiring yet.

### Phase 2 — Session Creation (Days 4-5)

**Goal:** New Session modal creates real Claude Code sessions.

- [ ] Build `NewSessionModal` — name input, directory picker, skip permissions toggle, initial prompt textarea
- [ ] Implement Rust `SessionManager` — struct with Vec of sessions, serialize/deserialize to `~/.nextdialog/sessions.json`
- [ ] Implement Tauri IPC command `create_session` — accepts name, directory, skip_permissions, initial_prompt
- [ ] Wire modal to IPC — on "Launch", call `create_session`, receive session ID, add card to grid
- [ ] Implement Tauri native file dialog for directory picker
- [ ] Handle validation — name uniqueness, directory exists

**Deliverable:** Modal creates sessions that persist to disk. Cards appear on home view. No terminal yet.

### Phase 3 — PTY & Terminal (Days 6-10)

**Goal:** Click a card, see a real Claude Code terminal, interact with it.

This is the core engineering phase.

- [ ] Register `tauri-plugin-pty` in Rust backend
- [ ] Implement `PtyPool` — spawns `claude` (or `claude --dangerously-skip-permissions`) as a child process in a pseudo-terminal per session
- [ ] Pass working directory as `cwd` to PTY spawn
- [ ] Implement `TerminalOverlay` — mount xterm.js instance on open, connect to PTY data stream, unmount on close
- [ ] Wire xterm.js `onData` → PTY stdin (user input)
- [ ] Wire PTY stdout → xterm.js `write` (terminal output)
- [ ] Implement terminal resize — `addon-fit` measures container, sends resize signal to PTY via `SIGWINCH`
- [ ] Configure xterm.js light theme (white bg, slate text, indigo cursor)
- [ ] Test: spawn session, type prompt, see Claude Code respond, close overlay, reopen — output preserved
- [ ] Handle PTY process exit — update session state to Stopped
- [ ] Implement `--continue` flag for restarting stopped sessions

**Deliverable:** Fully functional Claude Code sessions running inside NextDialog. Core product works.

### Phase 4 — Status Detection (Days 11-13)

**Goal:** Cards reflect live session status without opening the terminal.

- [ ] Implement `StatusDetector` in Rust — reads PTY stdout stream, applies state machine
- [ ] State machine transitions: `Idle ↔ Working ↔ Idle`, `Working → Waiting`, `Working → Error`, `* → Stopped`
- [ ] Idle detection: prompt pattern + 2s silence timer
- [ ] Working detection: characters received within 500ms rolling window
- [ ] Waiting detection: question-mark pattern + silence
- [ ] Error detection: error string patterns + non-zero exit
- [ ] Emit `session_status_changed` Tauri event with session ID + new status
- [ ] Frontend `useStatus` hook listens for events, updates card status dots
- [ ] Animate status dot — pulse animation for active states (working, waiting), static for idle/stopped/error

**Deliverable:** Cards show real-time status. You can glance at the app and know which sessions need attention.

### Phase 5 — Drag & Drop + Clipboard (Days 14-16)

**Goal:** Full Claude Code feature parity for images and files.

- [ ] Implement Tauri `drag-drop` event handler — intercept file drops on terminal overlay
- [ ] On drop: extract file paths, write to active PTY stdin as path strings (matches Claude Code's file path reference behavior)
- [ ] Implement clipboard bridge in Rust — on Ctrl+V in terminal, check clipboard for image data
- [ ] If image detected: save to `/tmp/nextdialog-paste-{timestamp}.png`, write path to PTY stdin
- [ ] If text detected: pass through normally to xterm.js
- [ ] Handle folder drop on home view — open New Session modal with directory pre-filled
- [ ] Test: drag screenshot onto terminal → Claude Code analyzes it. Ctrl+V paste screenshot → same result.

**Deliverable:** Image drag-and-drop and clipboard paste work identically to native Claude Code terminal.

### Phase 6 — Notifications & Polish (Days 17-19)

**Goal:** System notifications, dock badges, and UX polish.

- [ ] Implement native notifications via Tauri notification plugin — fire when session transitions to Waiting state
- [ ] Notification content: "[session-name] needs your input" with app icon
- [ ] Implement dock badge count (macOS) — show number of Waiting sessions
- [ ] Add right-click context menu on session cards — End Session, Restart, Remove, Rename
- [ ] Add keyboard shortcuts — Cmd+N (new session), Cmd+1-9 (jump to session), Escape (close overlay)
- [ ] Add `@xterm/addon-web-links` — clickable URLs in terminal output
- [ ] Loading states — skeleton cards during session creation
- [ ] Error handling — graceful messages when Claude Code binary not found, auth expired, etc.
- [ ] Settings screen (minimal) — notification toggle, audio cue toggle, default directory, default skip permissions

**Deliverable:** Polished, notification-aware app ready for daily use.

### Phase 7 — Packaging & Distribution (Days 20-22)

**Goal:** Distributable app for macOS (primary), Windows, Linux.

- [ ] Configure Tauri bundler — app icon (all sizes), app name, bundle identifier (`com.nextdialog.app`)
- [ ] macOS: DMG with background image, code signing (Developer ID if available)
- [ ] Windows: MSI/NSIS installer, ensure WebView2 bootstrapper included
- [ ] Linux: AppImage + .deb
- [ ] Auto-updater — Tauri updater plugin with GitHub Releases as update source
- [ ] CI/CD — GitHub Actions workflow: build on push to main, create release artifacts
- [ ] Test on clean macOS install — verify Claude Code CLI detection, first-run experience
- [ ] Write README with installation instructions, screenshots, and feature list

**Deliverable:** Downloadable app that installs in one click.

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `tauri-plugin-pty` is immature (v0.1.1, 372 downloads/month) | Medium | High | Fork and maintain if needed. Fallback: use Tauri shell plugin with custom PTY wrapper in Rust using `portable-pty` directly. |
| WebKit rendering differences on macOS | Low | Medium | `backdrop-filter` is WebKit-native. Test gradient animations early. Avoid bleeding-edge CSS. |
| Claude Code CLI changes break status detection patterns | Medium | Medium | Status detector uses configurable regex patterns. Version-check Claude Code on launch. |
| Clipboard image detection unreliable cross-platform | Medium | Medium | `arboard` crate handles cross-platform clipboard. Fallback: file path reference workflow. |
| Rust learning curve slows development | Medium | Medium | Core Rust code is bounded — PTY plugin handles the hard parts. Use Tauri's JS APIs where possible. Leverage Claude Code itself for Rust implementation. |
| Terminal performance with multiple sessions | Low | Medium | PTY processes are lazy — only active when terminal overlay is open. xterm.js WebGL renderer for heavy output. |
| macOS Gatekeeper blocks unsigned app | High | Low | Document `xattr -dr com.apple.quarantine` workaround. Pursue code signing for v1.1. |

---

## 10. Future Roadmap (Post-v1)

### v1.1 — Intelligence Layer
- Session activity timeline — sparkline on each card showing activity over time
- Token usage estimation — parse Claude Code output for token counts
- Auto-compact suggestion — notify when context window is getting full

### v1.2 — Multi-Machine
- LAN discovery — find NextDialog instances on other machines (similar to Terminal Manager's approach)
- Remote session monitoring — see status of sessions running on your Mac mini from your laptop

### v1.3 — Session Templates
- Saved session configurations — name, directory, skip permissions, initial prompt, MCP servers
- One-click project launch — "Start my usual 3-session setup for CareHub"
- Template sharing — export/import JSON configs

### v1.4 — Conductor Mode
- Designate one session as a "conductor" that monitors others
- Auto-respond to simple questions across sessions
- Escalate complex decisions to the human with context summary

### v1.5 — Mobile Companion
- Tauri 2 supports iOS/Android from a single codebase
- Lightweight mobile view showing session status cards
- Push notifications when sessions need input
- Simple text input for responding to Waiting sessions on the go

---

## 11. Development Environment Setup

### Prerequisites

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update

# Node.js 20+
# (already installed if you use Claude Code)

# Tauri CLI
cargo install tauri-cli

# Claude Code (the thing we're wrapping)
npm install -g @anthropic-ai/claude-code
```

### First Run

```bash
# Create project
npm create tauri-app@latest nextdialog -- --template react-ts
cd nextdialog

# Install frontend dependencies
npm install xterm @xterm/addon-fit @xterm/addon-web-links framer-motion

# Install Rust dependencies (add to src-tauri/Cargo.toml)
cd src-tauri
cargo add tauri-plugin-pty
cargo add serde --features derive
cargo add serde_json
cargo add regex
cargo add arboard
cargo add uuid --features v4
cd ..

# Launch dev mode
cargo tauri dev
```

### Tauri Permissions (src-tauri/capabilities/default.json)

```json
{
  "identifier": "default",
  "description": "NextDialog default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "notification:default",
    "notification:allow-notify",
    "dialog:allow-open",
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-read-image"
  ]
}
```

---

## 12. Success Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| App launch time | < 500ms | Timestamp from process start to first paint |
| Memory per session (idle) | < 15MB overhead | System monitor with 1 vs 5 sessions |
| Total app memory (3 sessions) | < 100MB | System monitor during typical use |
| Status detection latency | < 1 second | Time from Claude Code state change to card update |
| Daily active sessions | 3-5 | Self-reported from own usage |
| Context switches saved | 50%+ reduction | Compare terminal-tab-hunting time before/after |
| Binary size | < 15MB | Build output |

---

*NextDialog: Because your brain shouldn't be the bottleneck.*
