use crate::hooks::payloads::HookPayload;
use crate::timeline::ledger::TimelineEntry;

use super::{AgentAdapter, HookConfig, StatusHint};

/// Fallback adapter for terminal sessions and custom/unknown agent types.
/// Provides basic prompt detection and silence-based idle detection only.
pub struct GenericAdapter;

impl GenericAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl AgentAdapter for GenericAdapter {
    fn extract_timeline(&self, _line: &str) -> Vec<TimelineEntry> {
        vec![]
    }

    fn detect_prompt(&self, line: &str) -> Option<String> {
        let trimmed = line.trim();
        // Common shell prompts: >, $, %, #
        let text = trimmed
            .strip_prefix("> ")
            .or_else(|| trimmed.strip_prefix("$ "))
            .or_else(|| trimmed.strip_prefix("% "))
            .map(|rest| rest.trim());

        match text {
            Some(t) if t.len() >= 5 && t.len() <= 200 => Some(t.to_string()),
            _ => None,
        }
    }

    fn detect_status(&self, line: &str) -> Option<StatusHint> {
        let trimmed = line.trim();
        // Basic idle detection for shell prompts
        if trimmed == ">" || trimmed == "$" || trimmed == "%" || trimmed == "#" {
            return Some(StatusHint::Idle);
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

    fn is_noise(&self, _line: &str) -> bool {
        false
    }
}
