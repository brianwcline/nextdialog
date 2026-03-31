use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::types::AgentConfig;

/// Per-session tuning — overrides on top of SessionType.agent_config.
/// Fields set to None/empty inherit from the SessionType baseline.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionTuning {
    /// Profile this tuning was loaded from (if any)
    #[serde(default)]
    pub profile_id: Option<String>,

    /// CLI flag overrides (all Optional — None = inherit from SessionType)
    #[serde(default)]
    pub config_overrides: AgentConfigOverrides,

    /// File-based configs to install persistently to the project directory
    #[serde(default)]
    pub file_configs: Vec<FileConfig>,

    /// Commands typed into the session after the agent is ready
    #[serde(default)]
    pub startup_commands: Vec<String>,
}

/// Every field is Option — None means "inherit from SessionType.agent_config".
/// This is the override layer, not a replacement.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentConfigOverrides {
    /// Permission mode: "default", "acceptEdits", "plan", "bypassPermissions", "dontAsk"
    #[serde(default)]
    pub permission_mode: Option<String>,

    /// Specific tools to auto-allow (--allowedTools)
    #[serde(default)]
    pub allowed_tools: Option<Vec<String>>,

    /// Specific tools to block (--disallowedTools)
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,

    /// Model alias or full ID (--model)
    #[serde(default)]
    pub model: Option<String>,

    /// Effort level: "low", "medium", "high", "max" (--effort)
    #[serde(default)]
    pub effort: Option<String>,

    /// Path to MCP config JSON (--mcp-config)
    #[serde(default)]
    pub mcp_config_path: Option<String>,

    /// Appended to system prompt (--append-system-prompt)
    #[serde(default)]
    pub append_system_prompt: Option<String>,

    /// Max agentic turns (--max-turns)
    #[serde(default)]
    pub max_turns: Option<u32>,

    /// Enable verbose output (--verbose)
    #[serde(default)]
    pub verbose: Option<bool>,

    /// Enable Chrome browser integration (--chrome / --no-chrome)
    #[serde(default)]
    pub chrome_enabled: Option<bool>,

    /// Thinking mode: "enabled", "adaptive", "disabled" (--thinking)
    #[serde(default)]
    pub thinking_mode: Option<String>,

    /// Additional directories (--add-dir)
    #[serde(default)]
    pub additional_dirs: Option<Vec<String>>,

    /// Use a custom agent as main thread (--agent)
    #[serde(default)]
    pub agent: Option<String>,

    /// Enable git worktree isolation (--worktree)
    #[serde(default)]
    pub worktree: Option<bool>,

    /// Raw custom CLI args (escape hatch)
    #[serde(default)]
    pub custom_args: Option<Vec<String>>,

    /// Custom env vars
    #[serde(default)]
    pub custom_env: Option<HashMap<String, String>>,
}

/// A file that NextDialog manages on behalf of a tuning configuration.
/// Installed persistently to the project directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileConfig {
    /// What kind of file this is (determines agent-specific handling)
    pub kind: FileConfigKind,

    /// Relative path within the working directory
    /// e.g., ".claude/commands/review.md", ".cursor/rules/testing.md"
    pub relative_path: String,

    /// File content (including frontmatter for markdown files)
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileConfigKind {
    // Claude Code
    Command,      // .claude/commands/*.md
    Agent,        // .claude/agents/*.md
    Skill,        // .claude/skills/*/SKILL.md
    OutputStyle,  // .claude/output-styles/*.md

    // Cursor Agent
    Rule,         // .cursor/rules/*.md
    CursorHook,   // .cursor/hooks.json
    CursorSkill,  // .cursor/skills/*/SKILL.md

    // Gemini CLI
    GeminiCommand, // .gemini/commands/*.toml

    // Cross-agent
    ContextFile,  // CLAUDE.md, .gemini/GEMINI.md, etc.
    McpConfig,    // .mcp.json, .cursor/mcp.json
}

/// Merge a SessionType's base AgentConfig with per-session overrides.
/// Override fields that are Some replace the base; None inherits.
pub fn resolve_agent_config(base: &AgentConfig, overrides: &AgentConfigOverrides) -> AgentConfig {
    AgentConfig {
        permission_mode: overrides
            .permission_mode
            .clone()
            .or(base.permission_mode.clone()),
        allowed_tools: overrides
            .allowed_tools
            .clone()
            .unwrap_or_else(|| base.allowed_tools.clone()),
        disallowed_tools: overrides
            .disallowed_tools
            .clone()
            .unwrap_or_else(|| base.disallowed_tools.clone()),
        model: overrides.model.clone().or(base.model.clone()),
        mcp_config_path: overrides
            .mcp_config_path
            .clone()
            .or(base.mcp_config_path.clone()),
        append_system_prompt: overrides
            .append_system_prompt
            .clone()
            .or(base.append_system_prompt.clone()),
        max_turns: overrides.max_turns.or(base.max_turns),
        verbose: overrides.verbose.unwrap_or(base.verbose),
        chrome_enabled: overrides.chrome_enabled.or(base.chrome_enabled),
        additional_dirs: overrides
            .additional_dirs
            .clone()
            .unwrap_or_else(|| base.additional_dirs.clone()),
        custom_args: overrides
            .custom_args
            .clone()
            .unwrap_or_else(|| base.custom_args.clone()),
        custom_env: overrides
            .custom_env
            .clone()
            .unwrap_or_else(|| base.custom_env.clone()),
    }
}

/// Build additional CLI args from override fields that don't map to AgentConfig
/// (effort, thinking_mode, agent, worktree).
/// These get appended to the args list at spawn time.
pub fn extra_args_from_overrides(overrides: &AgentConfigOverrides) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(ref effort) = overrides.effort {
        args.push("--effort".to_string());
        args.push(effort.clone());
    }

    if let Some(ref thinking) = overrides.thinking_mode {
        args.push("--thinking".to_string());
        args.push(thinking.clone());
    }

    if let Some(ref agent) = overrides.agent {
        args.push("--agent".to_string());
        args.push(agent.clone());
    }

    if overrides.worktree == Some(true) {
        args.push("--worktree".to_string());
    }

    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_inherits_base_when_no_overrides() {
        let base = AgentConfig {
            model: Some("opus".to_string()),
            permission_mode: Some("plan".to_string()),
            verbose: true,
            ..Default::default()
        };
        let overrides = AgentConfigOverrides::default();

        let resolved = resolve_agent_config(&base, &overrides);

        assert_eq!(resolved.model, Some("opus".to_string()));
        assert_eq!(resolved.permission_mode, Some("plan".to_string()));
        assert!(resolved.verbose);
    }

    #[test]
    fn test_resolve_overrides_replace_base() {
        let base = AgentConfig {
            model: Some("opus".to_string()),
            permission_mode: Some("plan".to_string()),
            verbose: true,
            allowed_tools: vec!["Bash".to_string()],
            ..Default::default()
        };
        let overrides = AgentConfigOverrides {
            model: Some("haiku".to_string()),
            verbose: Some(false),
            allowed_tools: Some(vec!["Read".to_string(), "Write".to_string()]),
            ..Default::default()
        };

        let resolved = resolve_agent_config(&base, &overrides);

        assert_eq!(resolved.model, Some("haiku".to_string()));
        assert_eq!(resolved.permission_mode, Some("plan".to_string())); // inherited
        assert!(!resolved.verbose); // overridden
        assert_eq!(resolved.allowed_tools, vec!["Read", "Write"]); // overridden
    }

    #[test]
    fn test_extra_args_from_overrides() {
        let overrides = AgentConfigOverrides {
            effort: Some("high".to_string()),
            thinking_mode: Some("adaptive".to_string()),
            worktree: Some(true),
            ..Default::default()
        };

        let args = extra_args_from_overrides(&overrides);

        assert!(args.contains(&"--effort".to_string()));
        assert!(args.contains(&"high".to_string()));
        assert!(args.contains(&"--thinking".to_string()));
        assert!(args.contains(&"adaptive".to_string()));
        assert!(args.contains(&"--worktree".to_string()));
    }

    #[test]
    fn test_session_tuning_default_is_empty() {
        let tuning = SessionTuning::default();

        assert!(tuning.profile_id.is_none());
        assert!(tuning.file_configs.is_empty());
        assert!(tuning.startup_commands.is_empty());
    }

    #[test]
    fn test_session_tuning_serde_roundtrip() {
        let tuning = SessionTuning {
            profile_id: Some("test-profile".to_string()),
            config_overrides: AgentConfigOverrides {
                model: Some("opus".to_string()),
                effort: Some("high".to_string()),
                ..Default::default()
            },
            file_configs: vec![FileConfig {
                kind: FileConfigKind::Command,
                relative_path: ".claude/commands/test.md".to_string(),
                content: "---\ndescription: Test\n---\nRun tests".to_string(),
            }],
            startup_commands: vec!["/loop 5m /test".to_string()],
        };

        let json = serde_json::to_string(&tuning).unwrap();
        let deserialized: SessionTuning = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.profile_id, Some("test-profile".to_string()));
        assert_eq!(
            deserialized.config_overrides.model,
            Some("opus".to_string())
        );
        assert_eq!(deserialized.file_configs.len(), 1);
        assert_eq!(deserialized.file_configs[0].kind, FileConfigKind::Command);
        assert_eq!(deserialized.startup_commands.len(), 1);
    }
}
