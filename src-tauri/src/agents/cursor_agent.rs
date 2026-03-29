use regex::Regex;

use crate::hooks::payloads::HookPayload;
use crate::timeline::ledger::TimelineEntry;

use super::{AgentAdapter, HookConfig, StatusHint};

/// Cursor Agent adapter — PTY scraping from interactive TUI output.
///
/// Patterns captured from live testing (2026-03-29):
/// - Read: `⬡ Reading {file}` → `⬢ Read {file}`
/// - Edit: `│ Editing {file}` → `│ {file} +{n} -{n}`
/// - Shell: `⬡ Running` / `⬢ Running`
/// - Prompt: detected via state transition (plain text before `⬡ Generating`)
/// - Idle: `│ → Plan, search, build anything` or `│ → Add a follow-up`
/// - Working: `⬡ Generating` / `⬢ Generating`
///
/// NOTE: Cursor's TUI redraws the `│ → {text}` prompt line on every keystroke,
/// making character-by-character detection unreliable. Instead, we track the
/// last candidate prompt and emit it when the agent starts working.
pub struct CursorAgentAdapter {
    /// Tracks the last candidate prompt text (set from `│ →` lines, emitted on work start)
    last_candidate: std::sync::Mutex<Option<String>>,
}

impl CursorAgentAdapter {
    pub fn new() -> Self {
        Self {
            last_candidate: std::sync::Mutex::new(None),
        }
    }
}

impl AgentAdapter for CursorAgentAdapter {
    fn extract_timeline(&self, line: &str) -> Vec<TimelineEntry> {
        let trimmed = line.trim();
        let mut entries = Vec::new();

        thread_local! {
            static READ_RE: Regex = Regex::new(r"^[⬡⬢] Read(?:ing)?\s+(.+?)(?:\s+\d+\s+tokens)?$").unwrap();
            static EDIT_RE: Regex = Regex::new(r"^│\s+Editing\s+(.+?)\s*│?$").unwrap();
            static EDIT_RESULT_RE: Regex = Regex::new(r"^│\s+(\S+)\s+\+(\d+)\s+-(\d+)\s*│?$").unwrap();
            static RUNNING_RE: Regex = Regex::new(r"^[⬡⬢] Running").unwrap();
            static WORKING_RE: Regex = Regex::new(r"^[⬡⬢] (Generating|Reading|Editing|Running)").unwrap();
        }

        // Track candidate prompts from │ → lines (don't emit — too noisy)
        if let Some(rest) = trimmed.strip_prefix("│").map(|s| s.trim()) {
            if let Some(text) = rest.strip_prefix("→").map(|s| s.trim()) {
                if !text.starts_with("Plan, search")
                    && !text.starts_with("Add a follow-up")
                    && text.len() >= 5
                    && text.len() <= 200
                {
                    *self.last_candidate.lock().unwrap() = Some(text.to_string());
                }
            }
        }

        // When agent starts working, emit the tracked candidate as user_input
        if WORKING_RE.with(|re| re.is_match(trimmed)) {
            if let Some(prompt) = self.last_candidate.lock().unwrap().take() {
                entries.push(TimelineEntry::new("user_input", &prompt));
            }
        }

        // File read
        if let Some(file) = READ_RE.with(|re| {
            re.captures(trimmed).map(|c| c[1].to_string())
        }) {
            let basename = std::path::Path::new(&file)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file);
            entries.push(
                TimelineEntry::new("tool", &format!("Read {basename}"))
                    .with_details(serde_json::json!({"path": file})),
            );
            return entries;
        }

        // File edit started
        if let Some(file) = EDIT_RE.with(|re| {
            re.captures(trimmed).map(|c| c[1].to_string())
        }) {
            let basename = std::path::Path::new(&file)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file);
            entries.push(
                TimelineEntry::new("file_write", &format!("Edited {basename}"))
                    .with_details(serde_json::json!({"path": file})),
            );
            return entries;
        }

        // Edit result with diff stats
        if let Some(caps) = EDIT_RESULT_RE.with(|re| re.captures(trimmed).map(|c| {
            (c[1].to_string(), c[2].to_string(), c[3].to_string())
        })) {
            let (file, added, removed) = caps;
            let basename = std::path::Path::new(&file)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&file);
            entries.push(
                TimelineEntry::new("file_write", &format!("Edited {basename} (+{added} -{removed})"))
                    .with_details(serde_json::json!({"path": file, "added": added, "removed": removed})),
            );
            return entries;
        }

        // Shell command running
        if RUNNING_RE.with(|re| re.is_match(trimmed)) {
            entries.push(TimelineEntry::new("bash", "Running command"));
            return entries;
        }

        entries
    }

    fn detect_prompt(&self, _line: &str) -> Option<String> {
        // Cursor's TUI redraws the │ → line on every keystroke, making
        // character-by-character prompt detection unreliable. Instead,
        // prompt detection is handled in extract_timeline() — we track
        // candidate prompts and emit them when the agent starts working.
        None
    }

    fn detect_status(&self, line: &str) -> Option<StatusHint> {
        let trimmed = line.trim();

        // Idle: placeholder prompts
        if trimmed.contains("→ Plan, search, build anything")
            || trimmed.contains("→ Add a follow-up")
        {
            return Some(StatusHint::Idle);
        }

        // Working: generating/thinking
        if trimmed.starts_with("⬡ Generating") || trimmed.starts_with("⬢ Generating") {
            return Some(StatusHint::Working);
        }

        // Working: reading/editing/running
        if trimmed.starts_with("⬡ Reading")
            || trimmed.starts_with("⬢ Reading")
            || trimmed.starts_with("⬡ Running")
            || trimmed.starts_with("⬢ Running")
        {
            return Some(StatusHint::Working);
        }

        None
    }

    fn supports_hooks(&self) -> bool {
        false
    }

    fn hook_config(&self) -> Option<HookConfig> {
        None
    }

    fn process_hook(&self, _payload: &HookPayload) -> Vec<TimelineEntry> {
        vec![]
    }

    fn is_noise(&self, line: &str) -> bool {
        let trimmed = line.trim();

        // Model/thinking header
        if trimmed.starts_with("Opus 4.6") || trimmed.contains("1M Thinking") {
            return true;
        }

        // Navigation hint bar
        if trimmed.starts_with("/ commands") || trimmed.contains("@ files · ! shell") {
            return true;
        }

        // Fragmented nav bar pieces
        if trimmed == "/ comman" || trimmed == "ds · @ files · ! shell"
            || trimmed == "les · ! shell" || trimmed.starts_with("/ commands · @ fi")
        {
            return true;
        }

        // Interactive hints
        if trimmed.contains("ctrl+c to stop") || trimmed.contains("ctrl+r to review") {
            return true;
        }

        // Spinner dots
        if trimmed.starts_with("⬡ Generating") || trimmed.starts_with("⬢ Generating") {
            return true;
        }

        // Token count fragments
        if trimmed.ends_with("tokens") && trimmed.len() < 20 {
            return true;
        }

        false
    }
}
