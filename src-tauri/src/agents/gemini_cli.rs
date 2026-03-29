use std::collections::HashMap;

use regex::Regex;

use crate::hooks::payloads::HookPayload;
use crate::timeline::ledger::TimelineEntry;

use super::{AgentAdapter, HookConfig, HookConfigTarget, StatusHint};

/// Gemini CLI adapter — native hooks (AfterTool, SessionStart, etc.) + PTY fallback.
///
/// Gemini CLI supports hooks via `~/.gemini/settings.json` with event names
/// mapped from Claude's conventions (PostToolUse → AfterTool, etc.).
///
/// PTY patterns captured from live testing (2026-03-29):
/// - Tool pending: `│ ⊶  {ToolName} {args}`
/// - Tool complete: `│ ✓  {ToolName} {args}`
/// - Tool approval: `│ ?  {ToolName} {args}`
/// - Tool names: ReadFile, WriteFile, Shell, SearchText
/// - Thinking: `✦ {text}`
/// - Prompt: `> {text}`
/// - Idle: `>   Type your message or @path/to/file`
pub struct GeminiCliAdapter {
    last_candidate: std::sync::Mutex<Option<String>>,
}

impl GeminiCliAdapter {
    pub fn new() -> Self {
        Self {
            last_candidate: std::sync::Mutex::new(None),
        }
    }
}

impl AgentAdapter for GeminiCliAdapter {
    fn extract_timeline(&self, line: &str) -> Vec<TimelineEntry> {
        let trimmed = line.trim();
        let mut entries = Vec::new();

        thread_local! {
            static TOOL_COMPLETE_RE: Regex = Regex::new(
                r"^│\s*✓\s+(\w+)\s+(.+?)\s*│?$"
            ).unwrap();
            static TOOL_PENDING_RE: Regex = Regex::new(
                r"^│\s*⊶\s+(\w+)\s+(.+?)\s*│?$"
            ).unwrap();
        }

        // Track candidate prompts from > lines
        if let Some(text) = trimmed.strip_prefix("> ").map(|s| s.trim()) {
            if !text.starts_with("Type your message")
                && !text.is_empty()
                && text.len() >= 5
                && text.len() <= 200
            {
                *self.last_candidate.lock().unwrap() = Some(text.to_string());
            }
        }

        // When Gemini starts thinking, emit the tracked candidate as user_input
        if trimmed.starts_with('✦') {
            if let Some(prompt) = self.last_candidate.lock().unwrap().take() {
                entries.push(TimelineEntry::new("user_input", &prompt));
            }
        }

        // Tool completed (✓)
        if let Some((tool, args)) = TOOL_COMPLETE_RE.with(|re| {
            re.captures(trimmed).map(|c| (c[1].to_string(), c[2].to_string()))
        }) {
            entries.push(gemini_tool_to_entry(&tool, &args));
            return entries;
        }

        // Tool pending (⊶) — capture Shell commands (they have the full command text)
        if let Some((tool, args)) = TOOL_PENDING_RE.with(|re| {
            re.captures(trimmed).map(|c| (c[1].to_string(), c[2].to_string()))
        }) {
            if tool == "Shell" {
                entries.push(gemini_tool_to_entry(&tool, &args));
                return entries;
            }
        }

        entries
    }

    fn detect_prompt(&self, _line: &str) -> Option<String> {
        // Gemini's TUI redraws the > line on every keystroke.
        // Prompt detection is handled in extract_timeline() — we track
        // candidates and emit when the ✦ thinking indicator appears.
        None
    }

    fn detect_status(&self, line: &str) -> Option<StatusHint> {
        let trimmed = line.trim();

        // Idle: placeholder prompt
        if trimmed.contains("Type your message or @path/to/file") {
            return Some(StatusHint::Idle);
        }

        // Idle: bare prompt
        if trimmed == ">" {
            return Some(StatusHint::Idle);
        }

        // Working: thinking indicator
        if trimmed.starts_with('✦') {
            return Some(StatusHint::Working);
        }

        // Working: tool in progress
        if trimmed.contains("│") && (trimmed.contains("⊶") || trimmed.contains("o ")) {
            return Some(StatusHint::Working);
        }

        // Waiting: approval prompt
        if trimmed.contains("│") && trimmed.contains("? ") {
            return Some(StatusHint::Waiting);
        }

        None
    }

    fn supports_hooks(&self) -> bool {
        true
    }

    fn hook_config(&self) -> Option<HookConfig> {
        let mut event_names = HashMap::new();
        // Map NextDialog internal names → Gemini CLI hook event names
        event_names.insert("PostToolUse".to_string(), "AfterTool".to_string());
        event_names.insert("SessionStart".to_string(), "SessionStart".to_string());
        event_names.insert("SessionEnd".to_string(), "SessionEnd".to_string());

        Some(HookConfig {
            target: HookConfigTarget::GeminiGlobal,
            event_names,
        })
    }

    fn process_hook(&self, payload: &HookPayload) -> Vec<TimelineEntry> {
        // Gemini's hook payloads should be similar enough to Claude's
        // that we can reuse the same processing logic.
        // The event names differ but the payload structure is comparable.
        use crate::hooks::payloads::HookEvent;

        let mut entries = Vec::new();

        match payload.event() {
            // Gemini sends AfterTool, which we map to PostToolUse in the hook server
            HookEvent::PostToolUse => {
                let tool = payload.tool_name.as_deref().unwrap_or("");
                if let Some(path) = payload.file_path() {
                    let basename = std::path::Path::new(&path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&path);
                    entries.push(
                        TimelineEntry::new("file_write", &format!("Edited {basename}"))
                            .with_details(serde_json::json!({"path": path})),
                    );
                } else if let Some(cmd) = payload.bash_command() {
                    entries.push(
                        TimelineEntry::new("bash", &format!("$ {}", truncate(&cmd, 50)))
                            .with_details(serde_json::json!({"command": cmd})),
                    );
                } else if !tool.is_empty() {
                    entries.push(
                        TimelineEntry::new("tool", &format!("Used {tool}"))
                            .with_details(serde_json::json!({"tool": tool})),
                    );
                }
            }
            HookEvent::SessionStart => {
                entries.push(TimelineEntry::new("lifecycle", "Session started"));
            }
            HookEvent::SessionEnd => {
                entries.push(TimelineEntry::new("lifecycle", "Session ended"));
            }
            _ => {}
        }

        entries
    }

    fn is_noise(&self, line: &str) -> bool {
        let trimmed = line.trim();

        // Navigation hints
        if trimmed == "? for shortcuts" || trimmed.starts_with("Shift+Tab to accept") {
            return true;
        }

        // Status bar
        if trimmed.starts_with("workspace (/directory)") || trimmed.contains("branch") && trimmed.contains("sandbox") {
            return true;
        }

        // Model display
        if trimmed.contains("gemini-") && trimmed.contains("flash") {
            return true;
        }

        // Residual ANSI fragments
        if trimmed.starts_with("55;255") || trimmed.starts_with("38;2;") || trimmed.starts_with("[38;") {
            return true;
        }

        // Skill count
        if trimmed.ends_with("skill") && trimmed.len() < 15 {
            return true;
        }

        // Auth spinner
        if trimmed.contains("Waiting for authentication") {
            return true;
        }

        false
    }
}

/// Convert a Gemini tool name + args into a timeline entry.
fn gemini_tool_to_entry(tool: &str, args: &str) -> TimelineEntry {
    match tool {
        "ReadFile" => {
            let file = args.trim();
            TimelineEntry::new("tool", &format!("Read {file}"))
                .with_details(serde_json::json!({"path": file}))
        }
        "WriteFile" => {
            // Args format: "Writing to {file}"
            let file = args.strip_prefix("Writing to ").unwrap_or(args).trim();
            TimelineEntry::new("file_write", &format!("Wrote {file}"))
                .with_details(serde_json::json!({"path": file}))
        }
        "Shell" => {
            // Args format: "ls -la [current working directory ...]  (description)"
            let cmd = args.split('[').next().unwrap_or(args).trim();
            TimelineEntry::new("bash", &format!("$ {}", truncate(cmd, 50)))
                .with_details(serde_json::json!({"command": cmd}))
        }
        "SearchText" => {
            TimelineEntry::new("tool", &format!("Searched: {}", truncate(args, 50)))
                .with_details(serde_json::json!({"query": args}))
        }
        _ => {
            TimelineEntry::new("tool", &format!("{tool} {}", truncate(args, 40)))
                .with_details(serde_json::json!({"tool": tool}))
        }
    }
}

fn truncate(s: &str, max: usize) -> &str {
    if s.len() <= max { s } else { &s[..max] }
}
