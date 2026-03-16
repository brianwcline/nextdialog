use serde::Deserialize;

/// Top-level hook payload from Claude Code.
/// Parsed defensively — all fields optional except `hook_type`.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct HookPayload {
    /// The hook event type: "PostToolUse", "Stop", "Notification", etc.
    #[serde(alias = "type")]
    pub hook_type: Option<String>,

    // ── PostToolUse fields ──
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub tool_response: Option<serde_json::Value>,

    // ── Notification fields ──
    pub notification_type: Option<String>,
    pub message: Option<String>,

    // ── Session lifecycle fields ──
    pub session_id: Option<String>,

    // ── PostCompact fields (v2.1.76+, not fully documented) ──
    pub tokens_before: Option<u64>,
    pub tokens_after: Option<u64>,

    // Catch-all for unknown fields
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// Parsed event type for routing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HookEvent {
    PostToolUse,
    Stop,
    Notification,
    SessionStart,
    SessionEnd,
    PostCompact,
    Unknown(String),
}

impl HookPayload {
    pub fn event(&self) -> HookEvent {
        match self.hook_type.as_deref() {
            Some("PostToolUse") => HookEvent::PostToolUse,
            Some("Stop") => HookEvent::Stop,
            Some("Notification") => HookEvent::Notification,
            Some("SessionStart") => HookEvent::SessionStart,
            Some("SessionEnd") => HookEvent::SessionEnd,
            Some("PostCompact") => HookEvent::PostCompact,
            Some(other) => HookEvent::Unknown(other.to_string()),
            None => HookEvent::Unknown("(missing)".to_string()),
        }
    }

    /// Extract the file path from a Write or Edit tool use.
    pub fn file_path(&self) -> Option<String> {
        let input = self.tool_input.as_ref()?;
        input
            .get("file_path")
            .or_else(|| input.get("path"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }

    /// Extract the command from a Bash tool use.
    pub fn bash_command(&self) -> Option<String> {
        let input = self.tool_input.as_ref()?;
        input
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_post_tool_use() {
        let json = r#"{
            "type": "PostToolUse",
            "tool_name": "Write",
            "tool_input": {"file_path": "/tmp/test.rs", "content": "fn main() {}"},
            "tool_response": {"status": "ok"}
        }"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event(), HookEvent::PostToolUse);
        assert_eq!(payload.tool_name.as_deref(), Some("Write"));
        assert_eq!(payload.file_path(), Some("/tmp/test.rs".to_string()));
    }

    #[test]
    fn parse_notification() {
        let json = r#"{
            "type": "Notification",
            "notification_type": "input_needed",
            "message": "Claude is waiting for your input"
        }"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event(), HookEvent::Notification);
        assert_eq!(
            payload.message.as_deref(),
            Some("Claude is waiting for your input")
        );
    }

    #[test]
    fn parse_stop() {
        let json = r#"{"type": "Stop"}"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.event(), HookEvent::Stop);
    }

    #[test]
    fn parse_bash_command() {
        let json = r#"{
            "type": "PostToolUse",
            "tool_name": "Bash",
            "tool_input": {"command": "npm test"}
        }"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert_eq!(payload.bash_command(), Some("npm test".to_string()));
    }

    #[test]
    fn unknown_fields_preserved() {
        let json = r#"{"type": "PostToolUse", "tool_name": "Read", "future_field": 42}"#;
        let payload: HookPayload = serde_json::from_str(json).unwrap();
        assert!(payload.extra.contains_key("future_field"));
    }
}
