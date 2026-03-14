# NextDialog

**A calm interface for AI-assisted development.**

---

## The Problem

AI coding agents are transforming software development. Tools like Claude Code let developers delegate entire features, debug complex systems, and ship faster than ever. The best developers are now running multiple agent sessions in parallel — one refactoring an API, another writing tests, a third building a new feature.

But there's a cost.

A January 2026 BCG study of 1,488 workers found that productivity peaks at 2-3 simultaneous AI tools, then drops sharply. Fourteen percent of AI-intensive workers report what researchers call "AI brain fry" — acute mental fatigue from overseeing too many agent sessions at once. Those affected show 33% more decision fatigue, make significantly more errors, and are 39% more likely to quit.

The culprit isn't the AI. It's the interface. Developers today manage parallel coding sessions by juggling terminal windows — tabbing between them, losing track of which ones need attention, breaking their train of thought every time they context-switch. The tooling designed to make them faster is making them exhausted.

## The Insight

The problem isn't too many agents. It's too much cognitive overhead managing them.

Every existing multi-session tool in this space — and there are dozens — solves for power. More features, more integrations, more parallel agents, more Git workflows. They optimize for throughput. None of them optimize for the human.

What developers actually need is the opposite of more: a calm, glanceable home base where they can see the state of everything at once, click into a session only when it needs them, and return to a quiet screen when they're done. They need a tool that respects their attention as a finite resource.

## The Product

NextDialog is a lightweight desktop app for managing multiple Claude Code sessions.

When you launch it, you see a serene screen — a slowly shifting gradient in soft blues and lavenders, with your active sessions represented as floating glass cards. Each card has a name and a single colored dot: green for idle, indigo for working, amber for "needs your input." You can see the state of every session in under two seconds without opening anything.

Click a card to open that session's terminal. Do your work. Close it. You're back to the calm screen. The session keeps running in the background. If Claude has a question, the dot turns amber and you get a notification. No tab hunting, no terminal chaos, no cognitive residue.

New sessions launch with two inputs: a name and a toggle for auto-approve mode. That's it.

## How It Works

NextDialog wraps the real Claude Code CLI in a native desktop shell built with Tauri 2 and Rust. Each session runs in its own pseudo-terminal — the full Claude Code experience is preserved, including drag-and-drop images, clipboard paste, MCP server integration, plan mode, slash commands, and message queuing. Nothing is abstracted away or limited.

The Rust backend monitors each session's terminal output and classifies its state in real time using pattern matching. That state flows to the frontend as a single dot on a card. The entire status detection layer runs in the background with negligible overhead.

The app is approximately 10MB installed, uses around 30-40MB of RAM at idle, and launches in under half a second. It is designed to be the lightest thing on your machine.

## What Makes It Different

The multi-agent session manager space is crowded. There are TUI-based managers built on tmux (Agent Deck, Agent View, agtx), full GUI apps with Git integration and diff viewers (1Code, Claudia, opcode, CloudCLI), and Anthropic's own Claude Code Desktop with a sidebar session switcher.

NextDialog is different in kind, not degree.

Every other tool competes on features. NextDialog competes on feeling. The design language is intentionally minimal — inspired by the restraint of Linear and the calm of Apple Health. There are no sidebars, no diff panels, no Git worktree managers, no MCP configuration screens. There is a gradient, there are cards, and there is a terminal. That's the whole product.

This is a deliberate choice rooted in the research. The BCG study found that when teams embed AI into their workflows in an organized way, cognitive strain drops. When individuals feel pressure to use more tools and oversee more agents, strain increases. NextDialog is designed for the organized version: a small number of sessions, clearly visible, with the human in control of when and how they engage.

## Who It's For

NextDialog is for developers who use Claude Code daily and run 2-5 sessions in parallel. They are productive, high-output builders who have felt the tension between wanting AI to do more and feeling overwhelmed by the management overhead. They care about their tools the way they care about their workspace — they want something that feels good, not just something that works.

They are not looking for an orchestration platform. They are looking for a home screen.

## Technical Foundation

- **Tauri 2** — Rust-based desktop framework. Native performance, ~10MB binary, cross-platform (macOS, Windows, Linux).
- **Pseudo-terminal layer** — Each session spawns the real `claude` CLI in a PTY. Full feature parity with the native terminal experience.
- **xterm.js** — Industry-standard terminal rendering (used by VS Code, Hyper, Wave Terminal).
- **Real-time status detection** — Rust backend pattern-matches terminal output to classify session state with sub-second latency.
- **Native integrations** — System notifications, dock badge counts, drag-and-drop file handling, clipboard image bridging.

## Roadmap

**v1.0** — Core product. Session cards, terminal overlay, status detection, notifications, drag-and-drop, clipboard paste. Full Claude Code feature parity.

**v1.1** — Intelligence layer. Activity sparklines on cards, token usage estimation, auto-compact suggestions.

**v1.2** — Multi-machine. LAN discovery of NextDialog instances on other devices. Monitor sessions running on your Mac mini from your laptop.

**v1.3** — Session templates. Save and share session configurations. One-click launch of your standard multi-session setup.

**v1.5** — Mobile companion. Tauri 2's iOS/Android support enables a lightweight mobile view for monitoring sessions and responding to questions on the go.

## The Name

NextDialog refers to the next conversation waiting for your attention. In a world of parallel AI agents, the most important thing isn't what's happening right now — it's knowing what needs you next.

---

*NextDialog is built by 82W Digital LLC.*
