# NextDialog — Competitive Features & Strategic Differentiation

*Research completed March 14, 2026*

---

## Boris Cherny's Actual Workflow (The Target User)

From the Pragmatic Engineer interview (March 2026) and workflow breakdown:

- Runs **10-15 concurrent Claude Code sessions**: 5 in terminal (tabbed, numbered), 5-10 in browser, plus mobile sessions started in morning and checked later
- Ships **20-30 PRs/day** across 5 parallel instances
- Uses **Plan Mode first**, iterates until good, then switches to auto-accept for one-shot implementation
- Uses **Opus 4.5 with thinking** for everything — optimizes for "cost per reliable change" not speed
- Treats each session as **a separate worker with its own context** — "fleet" approach, not one brain doing all jobs
- Says his work shifted from **deep-focus coding to context-switching rapidly** between multiple agents
- Calls it: **"not so much about deep work, it's about how good I am at context switching and jumping across multiple different contexts very quickly"**

**This is the person NextDialog needs to impress.** He's living the problem every day. He built Claude Code. He's running 10-15 sessions in terminal tabs. And his own quote validates your thesis — it's about context switching, not coding.

---

## What Every Competitor Gets Wrong

After analyzing all 10+ competitors, here's the pattern: **they all solve for the terminal management problem, not the cognitive switching problem.**

| Tool | What it solves | What it misses |
|---|---|---|
| Claude Squad | "I have too many tmux tabs" | Doesn't help you know WHICH session needs you |
| Agent Deck | "I need mission control for 10 agents" | More information density = more cognitive load |
| opcode | "I want a pretty GUI" | Features on features — custom agents, analytics, sandboxing |
| 1Code | "I want Cursor for CLI agents" | Building an IDE, not reducing overhead |
| CCManager | "I want simpler tmux" | Closest to NextDialog's philosophy but still TUI-bound |
| Claude Code Desktop | "I need multi-session in a GUI" | Sidebar of sessions — functional but not designed for attention |

**Nobody has built for Boris's actual stated problem:** "how good I am at context switching." They all make it easier to HAVE more sessions. Nobody makes it easier to MANAGE your attention across them.

---

## Features That Create Competitive Advantage

### Tier 1: Attention Layer (What Makes Boris Notice)

#### 1. Intelligent Status Classification
Not just green/yellow/red dots. **Rich state detection** that tells you at a glance what each session is actually doing:

| State | Visual | What It Means |
|---|---|---|
| 🟢 Idle | Soft pulse | Waiting for your input, no urgency |
| 🔵 Working | Steady glow | Claude is executing, don't interrupt |
| 🟡 Planning | Amber breathe | Claude has a plan, needs your review |
| 🟠 Blocked | Orange flash | Hit an error, permission needed, or waiting for approval |
| 🔴 Failed | Red still | Something went wrong, needs human |
| ⚪ Compacting | Dim | Auto-compaction in progress (context getting long) |

**Why this matters:** Boris's workflow is "queue work, check what's ripe." The status system tells him which fruit to pick without opening any terminal. The Rudel analytics data (1,573 sessions) shows 26% of sessions are abandoned — meaning people lose track. Rich status prevents that.

#### 2. "What Needs Me?" Priority Queue
Instead of scanning all cards visually, a single floating indicator: **"2 sessions need you"** with the most urgent one highlighted. Click it, you're in that terminal. Resolve it, you're back to calm.

This is the **Weiser/Seely Brown "periphery to center" pattern** — information stays in your peripheral awareness until it's relevant, then smoothly moves to your attention.

**Nobody else does this.** Claude Squad shows status per session. Agent Deck shows a grid. But none of them answer the simple question: "What needs me right now, in what order?"

#### 3. Session Context Preview (Hover Cards)
Hover over a card → see the last 3-5 lines of Claude's output without opening the terminal. You get enough context to decide: "Do I need to engage, or can this wait?"

This reduces the cognitive cost of **checking** a session from:
- Current: switch tab → read terminal → context-switch → switch back (30-60 seconds, cognitive residue)
- NextDialog: hover → read 3 lines → move on (3 seconds, no residue)

#### 4. Session Grouping by Project
Boris works across multiple repos. Sessions should auto-group by working directory / git repo. Visual clusters, not a flat list.

```
📁 carehub-therapy (3 sessions)
   🟢 Note editing workflow
   🔵 Intake form expansion  
   🟡 Intelligence assistant — needs review

📁 nextdialog (2 sessions)
   🔵 Terminal integration
   🟢 Status detection
```

**opcode and Agent Deck have grouping, but they require manual configuration.** NextDialog should auto-detect from the working directory.

---

### Tier 2: Workflow Intelligence (What Makes It Sticky)

#### 5. Session Timeline / Activity Sparkline
Each card shows a tiny sparkline — a visual pulse of activity over the last hour. You can see at a glance: "This session has been idle for 40 minutes" vs "This session has been churning through tool calls for 20 minutes."

Boris mentioned he starts mobile sessions in the morning and checks them later. The sparkline shows whether that session did meaningful work or stalled.

**Rudel (Show HN yesterday) built analytics.** But they built it as a separate dashboard. NextDialog should embed the insight directly on the card. Don't make people go somewhere else to understand their sessions.

#### 6. Token Burn Indicator
Subtle indicator showing how much context each session has consumed. When a session is approaching compaction, warn early — before it auto-compacts and potentially loses important context.

From the Rudel data: sessions average ~9,500 tokens per interaction. At 200K context (or 1M with the new GA), knowing where you are in the context window matters. Nobody visualizes this today.

#### 7. Plan Mode Integration
When Claude is in Plan Mode and produces a plan, surface the plan summary on the card itself — not just "needs review" but **what** needs review. "Claude has a plan for refactoring the auth middleware. 4 files, ~200 lines. Approve?"

This connects directly to Boris's workflow: "iterate on the plan until it's good, then let it one-shot." NextDialog could show the plan outline without opening the terminal.

#### 8. Cross-Session Awareness
If Session A modifies a file that Session B is also working on, flag it. "⚠️ Both sessions touched `src/auth.ts`." This is a real problem in parallel agent workflows — merge conflicts and stepping on each other's work.

**Nobody does this.** Not Claude Code Desktop, not Claude Squad, not opcode. It requires reading git state across worktrees. It's hard. And it's incredibly valuable.

---

### Tier 3: Ambient & Calm Layer (What Makes It Beautiful)

#### 9. Adaptive Background
The gradient isn't decorative — it's informational. Subtle shifts based on aggregate state:
- All sessions idle → warm, calm gradient
- Sessions working → slightly cooler, more focused
- Session needs attention → gentle amber warmth enters from the direction of that card
- Error state → subtle tension without being alarming

This is Conductor philosophy in a developer tool. The environment reflects the state of your work without demanding you read anything.

#### 10. Sound Design
Optional, subtle audio cues:
- Soft chime when a session completes a plan (→ "check when you're ready")
- Distinct tone when a session errors (→ "something went wrong")
- Ambient generative audio when all sessions are working (→ "everything's fine, relax")

**NOT notifications.** Not dings and pops. Think: macOS Focus sounds, or the ambient tones in the Calm app. A developer headphone layer that adds to focus rather than disrupting it.

#### 11. Session Naming Intelligence
Auto-generate meaningful session names from the first prompt or CLAUDE.md context. Instead of "Session 1, Session 2, Session 3," you get "Auth refactor," "API migration," "Test coverage." The card is instantly scannable.

#### 12. "Return to Calm" Transition
When you close a terminal overlay, the transition back to the card view is intentional — a 300ms ease-out with a subtle scale animation. You feel the shift from "engaged with this session" to "overseeing all sessions." 

The transition IS the cognitive context-switch. It's a designed moment that helps your brain shift modes.

---

### Tier 0: The Unlock — Agent-Agnostic Custom Sessions

#### 0. Custom Session Types (Roster System)
NextDialog is NOT a Claude Code wrapper. It's a **calm session manager for any terminal-based AI agent or process.**

New Session presents a roster:
```
🟣 Claude Code     (built-in)
🦞 OpenClaw        (custom)
🔵 Codex CLI       (custom)
🟢 Aider           (custom)
🔶 Gemini CLI      (custom)
⚡ Terminal         (plain shell)
＋ Add custom type...
```

Each session type is a simple config:
```json
{
  "id": "openclaw",
  "name": "OpenClaw",
  "command": "openclaw tui",
  "icon": "🦞",
  "color": "#ef4444",
  "defaultCwd": "~/.openclaw/workspace",
  "env": { "OPENCLAW_MODE": "interactive" },
  "statusPatterns": {
    "idle": ["ready", "heartbeat", "❯"],
    "working": ["thinking", "running", "generating"],
    "needsInput": ["approve", "confirm", "\\?$"],
    "error": ["error", "failed", "FATAL"]
  }
}
```

**Why this is Tier 0 (foundational, not optional):**

1. **Breaks platform dependency.** Every competitor is coupled to Claude Code. If Anthropic ships better native multi-session (they will), those tools die. NextDialog survives because it manages ALL agents.

2. **Expands TAM 5-10x.** Not just Claude Code users (~500K-1M). Aider users, Codex users, Cursor CLI users, OpenClaw users, anyone running multiple AI agents in terminals.

3. **Creates a moat.** Community-contributed session type configs become a mini-ecosystem. "Here's my Aider status pattern." "Here's my Gemini CLI config." Network effects from shared configs.

4. **Serves Boris's actual workflow.** He runs sessions in terminal AND browser AND mobile. He needs one dashboard for everything, not another Claude Code-only wrapper.

5. **Enables the real pitch:** *"A calm interface for managing AI coding agents. All of them."*

**Implementation complexity: Low.** PTY spawn is already parameterized — just make the command configurable. Status detection is already pattern-matching — just make patterns configurable. Cards are already generic — add icon/color properties. ~2-3 hours on top of existing architecture.

**Competitive uniqueness: High.** Claude Squad can't do this (tmux + Claude-specific). opcode can't (architecturally coupled to Claude Code API). 1Code can't (building an IDE). NextDialog is the only tool that says: bring whatever agents you use.

**Config distribution:**
- Ship with built-in configs for: Claude Code, Codex CLI, Aider, Gemini CLI, plain terminal
- Community configs via GitHub repo or embedded marketplace
- Users create custom types for their own tools (OpenClaw, data-test, custom scripts, `npm run dev`, Docker containers)

#### Create Custom Session Type Workflow

When a user clicks "＋ Add custom type...", they get a guided creation flow — not a JSON editor. The workflow should feel as polished as the rest of the app:

**Step 1 — Identity**
```
Name: _______________     (e.g. "OpenClaw")
Icon: 🦞  [pick emoji]
Color: ● [color picker]   (card accent color)
```

**Step 2 — Command**
```
Launch command: _______________  (e.g. "openclaw tui")
Working directory: [~/dev/...]  (optional default)
Environment variables:          (optional key=value pairs)
  + Add variable
```

**Step 3 — Status Detection**
Guided pattern builder with live preview. User runs a test session and the app highlights terminal output in real-time, letting them click to tag patterns:

```
How should NextDialog detect this agent's state?

When idle (waiting for input):
  [❯]  [ready]  [+ add pattern]

When working (agent is executing):
  [thinking]  [running]  [⠋]  [+ add pattern]

When needs your input:
  [approve]  [confirm]  [?]  [+ add pattern]

When error:
  [error]  [failed]  [+ add pattern]
```

Alternatively: a **"Learn" mode** where the user launches a test session inside the workflow, interacts with it normally, and NextDialog watches the terminal output. It suggests patterns automatically: "I noticed `❯` appears when the agent is idle. Use this as the idle pattern?" The user confirms or adjusts.

**Step 4 — Preview & Save**
Shows a mock card with the configured icon, color, and name. User sees exactly how it'll look on the canvas before saving.

```
┌────────────────────┐
│  🦞 OpenClaw       │
│  ● idle            │
│  ~/.openclaw/...   │
└────────────────────┘

[Save]   [Test Session]   [Cancel]
```

**"Test Session"** spawns a real instance so the user can verify status detection works before committing.

**Post-save options:**
- Export as `.nextdialog-session.json` for sharing
- Submit to community config library (future)

**Why a guided workflow, not a config file:**
- Config files are for power users. Boris will edit JSON. Most developers won't.
- The "Learn" mode — where the app watches terminal output and suggests patterns — is genuinely novel. No competitor does this. It makes custom agent support feel effortless.
- The visual preview closes the loop: you see exactly what the card will look like before you commit.
- Lowers the barrier from "read docs, write JSON, restart app" to "click, type command, confirm patterns, done."

---

## Features That DON'T Belong in NextDialog

Ruthlessly exclude:

| Feature | Why Not |
|---|---|
| Built-in file viewer / diff panel | That's an IDE. You have VS Code. |
| Git worktree management UI | Claude Code handles this. Don't duplicate. |
| MCP server configuration | Tool configuration ≠ session management |
| Custom agent builder | opcode's territory. Not the problem you're solving. |
| Code execution sandbox | Safety is Claude Code's job, not the shell's |
| Billing / usage dashboard | Anthropic's console does this |
| Chat/messaging between sessions | Over-engineering. Sessions are independent workers. |

**Every feature you add dilutes the "calm" premise.** The constraint IS the product. A gradient, cards, status, and a terminal. That's it.

---

## What Would Make Boris Cherny Take Notice

Boris ships 20-30 PRs/day across 5+ parallel sessions. He lives in terminals. He values:
1. **Productivity through systems** (lint rules from repeated review comments, CLAUDE.md as team memory)
2. **Reducing human oversight cost** ("pay compute to reduce human oversight load")
3. **Plan-first workflow** (plan mode → iterate → one-shot implementation)
4. **Unfinished problems** — he said context-switching is the new skill. He hasn't solved it elegantly. He's doing it manually.

**The pitch to Boris isn't "look at this pretty app."** It's:

> "You said the job is now about context-switching between parallel agents. Every tool in the ecosystem makes it easier to run more agents. NextDialog is the only one that makes it easier to switch between them without losing your mind. And it works with ALL of them — Claude Code, Codex, Aider, OpenClaw, anything you run in a terminal. The priority queue tells you what needs you. The hover previews let you decide without opening anything. The cross-session conflict detection catches the bugs parallel agents create. And when nothing needs you, the screen is calm — because the most productive thing you can do while agents are working is not be anxious about them."

---

## GTM Angle: The Cherny Connection

Boris's interview dropped 1 week ago. It's the hottest content in the Claude Code ecosystem right now. Timing:

1. **Reference him directly** in the README and launch blog: "Boris Cherny said context-switching is the new core skill. We built for that."
2. **Quote the BCG research** he's indirectly validating — 3-agent cliff, cognitive fatigue
3. **Post in r/ClaudeCode** (not just r/ClaudeAI) — that's where the multi-session conversation is happening RIGHT NOW
4. **Tag him on X** (@bcherny) with a demo video. He's active and responsive. If it's genuinely good, he'll engage.
5. **The Pragmatic Engineer angle** — Gergely Orosz covers developer tools. A "Show HN" success + Boris engagement = potential Pragmatic Engineer mention.

---

## Novel Technical Differentiators (Not Just Design)

### Cross-Session Dependency Graph
Build a lightweight dependency graph: which sessions modify which files, which sessions' output feeds into other sessions' input. Visualize it as faint connecting lines between cards. This is **unique** — no tool tracks cross-session dependencies.

### Smart Session Parking
When you have 10 sessions but can only mentally track 3-4 (BCG data), let the system "park" low-priority sessions. They still run, but they move to a subtle peripheral dock. Only active sessions occupy the main canvas. When a parked session needs attention, it smoothly animates back into focus.

This is the Weiser calm technology principle: **"technology should inform but not demand focus."** Parked sessions inform (they're there, they're running) without demanding (they're not cluttering your primary view).

### Session Handoff Notes
When you close a session or park it, NextDialog auto-captures the last state: what Claude was doing, what it produced, what's pending. When you return (maybe hours later), you see a one-line summary: "Left off: Auth refactor complete, 3 tests failing, Claude suggested fixing the mock." Zero ramp-up time.

This solves the problem from the Medium post: "Claude Code forgets everything between sessions." The TOOL remembers, even when the model doesn't.

---

## Priority Build Order

If Brian is prototyping today, build in this order:

1. **Glass cards on gradient + status dots** (the visual identity — 2 hours)
2. **PTY spawn + xterm.js overlay** (functional terminal — 3 hours)
3. **Custom session type config** (roster system, configurable commands — 2 hours)
4. **Configurable status detection** (pattern-matching from session type config — 2 hours)
5. **Hover preview** (last 3-5 lines on hover — 1 hour)
6. **Priority queue indicator** ("2 sessions need you" — 1 hour)
7. **Session auto-naming** (from first prompt — 30 min)
8. **Project grouping** (from working directory — 1 hour)
9. **Return-to-calm transition** (300ms ease animation — 30 min)
10. **Ship built-in configs** for Claude Code, Codex, Aider, Gemini CLI, plain terminal — 1 hour

Total: ~14 hours for a prototype that's genuinely differentiated from everything in the market. The custom session type system is foundational — build it early, not as an afterthought.

---

*"Technology should inform but not demand our focus or attention."*
*— Mark Weiser & John Seely Brown, Xerox PARC*
