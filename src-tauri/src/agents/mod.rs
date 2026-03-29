pub mod claude_code;
pub mod cursor_agent;
pub mod gemini_cli;
pub mod generic;

use std::collections::HashMap;
use std::path::PathBuf;

use crate::hooks::payloads::HookPayload;
use crate::timeline::ledger::TimelineEntry;

/// Status hint extracted from agent output.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StatusHint {
    Working,
    Idle,
    Waiting,
    Planning,
}

/// Where to inject hook configuration for an agent.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum HookConfigTarget {
    /// `.claude/settings.local.json` in the session's working directory
    ClaudeLocal,
    /// `~/.gemini/settings.json` (global Gemini config)
    GeminiGlobal,
    /// Custom path
    Custom(PathBuf),
}

/// Hook configuration for an agent: where to write and how to map event names.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct HookConfig {
    pub target: HookConfigTarget,
    /// Maps NextDialog internal event names to agent-specific event names.
    /// e.g., "PostToolUse" → "AfterTool" for Gemini
    pub event_names: HashMap<String, String>,
}

/// Trait that each agent type implements for extracting structured data
/// from its specific output format and integration capabilities.
#[allow(dead_code)]
pub trait AgentAdapter: Send + Sync {
    /// Extract timeline entries from a line of PTY output.
    fn extract_timeline(&self, line: &str) -> Vec<TimelineEntry>;

    /// Detect user prompt. Returns the user's input text if this line is a prompt.
    fn detect_prompt(&self, line: &str) -> Option<String>;

    /// Detect status from a line of output.
    fn detect_status(&self, line: &str) -> Option<StatusHint>;

    /// Whether this agent supports hooks (enables hook server setup).
    fn supports_hooks(&self) -> bool;

    /// Hook configuration: where to write config and event name mapping.
    fn hook_config(&self) -> Option<HookConfig>;

    /// Process a hook payload into timeline entries.
    /// Only called if `supports_hooks()` is true.
    fn process_hook(&self, payload: &HookPayload) -> Vec<TimelineEntry>;

    /// Whether a line is UI chrome/noise that should be filtered from the preview buffer.
    fn is_noise(&self, line: &str) -> bool;
}

/// Create the appropriate adapter for a session type.
pub fn create_adapter(session_type: &str) -> Box<dyn AgentAdapter> {
    match session_type {
        "claude-code" => Box::new(claude_code::ClaudeCodeAdapter::new()),
        "cursor-agent" => Box::new(cursor_agent::CursorAgentAdapter::new()),
        "gemini-cli" => Box::new(gemini_cli::GeminiCliAdapter::new()),
        _ => Box::new(generic::GenericAdapter::new()),
    }
}
