use std::collections::HashMap;

use regex::Regex;

use crate::hooks::payloads::{HookEvent, HookPayload};
use crate::timeline::ledger::TimelineEntry;

use super::{AgentAdapter, HookConfig, HookConfigTarget, StatusHint};

/// Claude Code adapter — richest integration via HTTP hooks + PTY patterns.
pub struct ClaudeCodeAdapter;

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl AgentAdapter for ClaudeCodeAdapter {
    fn extract_timeline(&self, _line: &str) -> Vec<TimelineEntry> {
        // Claude Code uses hooks for timeline data, not PTY scraping
        vec![]
    }

    fn detect_prompt(&self, line: &str) -> Option<String> {
        let trimmed = line.trim();
        let text = trimmed
            .strip_prefix('❯')
            .or_else(|| trimmed.strip_prefix('›'))
            .or_else(|| trimmed.strip_prefix("> "))
            .map(|rest| rest.trim());

        match text {
            Some(t) if t.len() >= 5 && t.len() <= 200 => Some(t.to_string()),
            _ => None,
        }
    }

    fn detect_status(&self, line: &str) -> Option<StatusHint> {
        let trimmed = line.trim();

        // Idle: empty prompt
        if trimmed == "❯" || trimmed == "›" {
            return Some(StatusHint::Idle);
        }

        // Planning mode
        if trimmed.to_lowercase().contains("plan mode") {
            return Some(StatusHint::Planning);
        }

        // Waiting patterns
        if trimmed.ends_with("? ")
            || trimmed.contains("(y/n)")
            || trimmed.contains("allow once")
            || trimmed.contains("press Enter")
        {
            return Some(StatusHint::Waiting);
        }

        None
    }

    fn supports_hooks(&self) -> bool {
        true
    }

    fn hook_config(&self) -> Option<HookConfig> {
        let mut event_names = HashMap::new();
        event_names.insert("PostToolUse".to_string(), "PostToolUse".to_string());
        event_names.insert("Stop".to_string(), "Stop".to_string());
        event_names.insert("Notification".to_string(), "Notification".to_string());
        event_names.insert("SessionStart".to_string(), "SessionStart".to_string());
        event_names.insert("SessionEnd".to_string(), "SessionEnd".to_string());
        event_names.insert("PostCompact".to_string(), "PostCompact".to_string());

        Some(HookConfig {
            target: HookConfigTarget::ClaudeLocal,
            event_names,
        })
    }

    fn process_hook(&self, payload: &HookPayload) -> Vec<TimelineEntry> {
        let mut entries = Vec::new();

        match payload.event() {
            HookEvent::PostToolUse => {
                if let Some(entry) = process_tool_use(payload) {
                    entries.push(entry);
                }
            }
            HookEvent::Stop => {
                entries.push(TimelineEntry::new("status", "Went idle"));
            }
            HookEvent::Notification => {
                let summary = payload
                    .message
                    .as_deref()
                    .map(|m| if m.len() > 80 { &m[..80] } else { m })
                    .unwrap_or("Waiting for input")
                    .to_string();
                entries.push(TimelineEntry::new("notification", &summary));
            }
            HookEvent::SessionStart => {
                entries.push(TimelineEntry::new("lifecycle", "Session started"));
            }
            HookEvent::SessionEnd => {
                entries.push(TimelineEntry::new("lifecycle", "Session ended"));
            }
            HookEvent::PostCompact => {
                if let (Some(before), Some(after)) = (payload.tokens_before, payload.tokens_after) {
                    entries.push(
                        TimelineEntry::new(
                            "compact",
                            &format!("Context compacted: {before} → {after} tokens"),
                        )
                        .with_details(serde_json::json!({
                            "tokens_before": before,
                            "tokens_after": after,
                        })),
                    );
                }
            }
            HookEvent::Unknown(_) => {}
        }

        entries
    }

    fn is_noise(&self, line: &str) -> bool {
        let trimmed = line.trim();

        // Claude Code status bar
        if trimmed.starts_with("connected |") {
            return true;
        }

        // Token/session header
        if trimmed.starts_with("agent ")
            && trimmed.contains("| session ")
            && trimmed.contains("| tokens ")
        {
            return true;
        }

        // Spinner lines
        is_claude_spinner_line(trimmed)
    }
}

fn process_tool_use(payload: &HookPayload) -> Option<TimelineEntry> {
    let tool = payload.tool_name.as_deref().unwrap_or("");

    match tool {
        "Write" | "Edit" | "NotebookEdit" => {
            let path = payload.file_path()?;
            let basename = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&path);
            Some(
                TimelineEntry::new("file_write", &format!("Edited {basename}"))
                    .with_details(serde_json::json!({"path": path})),
            )
        }
        "Bash" => {
            let cmd = payload.bash_command()?;
            let activity = classify_bash(&cmd);
            let summary = match activity {
                "test" => format!("Ran tests: {}", truncate_cmd(&cmd, 40)),
                "build" => format!("Built: {}", truncate_cmd(&cmd, 40)),
                "deploy" => format!("Deployed: {}", truncate_cmd(&cmd, 40)),
                "lint" => format!("Lint: {}", truncate_cmd(&cmd, 40)),
                _ => format!("$ {}", truncate_cmd(&cmd, 50)),
            };
            Some(
                TimelineEntry::new("bash", &summary)
                    .with_details(serde_json::json!({
                        "command": cmd,
                        "activity": activity,
                    })),
            )
        }
        // Skip noisy internal tools
        "ToolSearch" | "TaskCreate" | "TaskUpdate" | "TaskGet" | "TaskList" | "TaskStop"
        | "TaskOutput" => None,
        _ if !tool.is_empty() => {
            let summary = describe_tool(tool, payload.tool_input.as_ref());
            Some(
                TimelineEntry::new("tool", &summary)
                    .with_details(serde_json::json!({"tool": tool})),
            )
        }
        _ => None,
    }
}

fn describe_tool(tool: &str, input: Option<&serde_json::Value>) -> String {
    let input = match input {
        Some(v) => v,
        None => return format!("Used {tool}"),
    };

    match tool {
        "Read" => {
            let path = input
                .get("file_path")
                .or_else(|| input.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if path.is_empty() {
                "Read file".to_string()
            } else {
                let basename = std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path);
                format!("Read {basename}")
            }
        }
        "Grep" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            if pattern.is_empty() {
                "Searched code".to_string()
            } else {
                format!("Searched for '{}'", truncate_str(pattern, 30))
            }
        }
        "Glob" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            if pattern.is_empty() {
                "Found files".to_string()
            } else {
                format!("Found files: {}", truncate_str(pattern, 30))
            }
        }
        "Agent" => {
            let desc = input
                .get("description")
                .and_then(|v| v.as_str())
                .or_else(|| input.get("prompt").and_then(|v| v.as_str()))
                .unwrap_or("");
            if desc.is_empty() {
                "Ran agent".to_string()
            } else {
                truncate_str(desc, 60).to_string()
            }
        }
        "EnterPlanMode" => "Entered planning mode".to_string(),
        "ExitPlanMode" => "Plan ready for review".to_string(),
        "WebSearch" => {
            let query = input.get("query").and_then(|v| v.as_str()).unwrap_or("");
            if query.is_empty() {
                "Web search".to_string()
            } else {
                format!("Searched web: {}", truncate_str(query, 40))
            }
        }
        "WebFetch" => {
            let url = input.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                "Fetched URL".to_string()
            } else {
                format!("Fetched {}", truncate_str(url, 40))
            }
        }
        "Skill" => {
            let skill = input.get("skill").and_then(|v| v.as_str()).unwrap_or("");
            if skill.is_empty() {
                "Used skill".to_string()
            } else {
                format!("Ran /{skill}")
            }
        }
        "AskUserQuestion" => "Asked a question".to_string(),
        _ => format!("Used {tool}"),
    }
}

fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}

fn truncate_cmd(cmd: &str, max: usize) -> String {
    let first_line = cmd.lines().next().unwrap_or(cmd);
    if first_line.len() <= max {
        first_line.to_string()
    } else {
        format!("{}…", &first_line[..max])
    }
}

fn classify_bash(cmd: &str) -> &'static str {
    thread_local! {
        static TEST_RE: Regex = Regex::new(r"(?i)\b(test|spec|jest|pytest|cargo\s+test|npm\s+test|vitest)\b").unwrap();
        static BUILD_RE: Regex = Regex::new(r"(?i)\b(build|compile|cargo\s+build|npm\s+run\s+build|tsc|webpack|vite\s+build)\b").unwrap();
        static DEPLOY_RE: Regex = Regex::new(r"(?i)\b(deploy|push|publish|release)\b").unwrap();
        static LINT_RE: Regex = Regex::new(r"(?i)\b(lint|clippy|eslint|prettier|fmt)\b").unwrap();
    }

    if TEST_RE.with(|re| re.is_match(cmd)) {
        "test"
    } else if BUILD_RE.with(|re| re.is_match(cmd)) {
        "build"
    } else if DEPLOY_RE.with(|re| re.is_match(cmd)) {
        "deploy"
    } else if LINT_RE.with(|re| re.is_match(cmd)) {
        "lint"
    } else {
        "command"
    }
}

fn is_claude_spinner_line(line: &str) -> bool {
    let lower = line.to_lowercase();

    // Spinner verbs ending with … or ...
    if lower.ends_with('…') || lower.ends_with("...") {
        let word_count = line.split_whitespace().count();
        if word_count <= 3 {
            return true;
        }
    }

    // Duration lines: "Sautéed for 1m 30s"
    if (lower.contains(" for ") && (lower.contains("m ") || lower.contains("s")))
        && lower.split_whitespace().count() <= 5
        && lower.chars().any(|c| c.is_ascii_digit())
    {
        return true;
    }

    // Mode/UI indicator lines
    if lower.starts_with("plan mode")
        || lower.starts_with("bypass permissions")
        || lower.starts_with("auto-accept")
        || lower.contains("shift+tab to cycle")
        || lower.contains("esc to interrupt")
        || lower.contains("esc to cancel")
        || lower.contains("ctrl+o to expand")
        || lower.contains("image in clipboard")
    {
        return true;
    }

    false
}
