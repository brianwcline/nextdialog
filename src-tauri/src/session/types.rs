use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentConfig {
    /// Permission mode: "default", "acceptEdits", "plan", "bypassPermissions"
    #[serde(default)]
    pub permission_mode: Option<String>,
    /// Specific tools to auto-allow (--allowedTools)
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    /// Specific tools to block (--disallowedTools)
    #[serde(default)]
    pub disallowed_tools: Vec<String>,
    /// Model alias or full ID (--model)
    #[serde(default)]
    pub model: Option<String>,
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
    pub verbose: bool,
    /// Enable Chrome browser integration (--chrome / --no-chrome)
    #[serde(default)]
    pub chrome_enabled: Option<bool>,
    /// Additional directories (--add-dir)
    #[serde(default)]
    pub additional_dirs: Vec<String>,
    /// Raw custom CLI args (escape hatch for anything not modeled)
    #[serde(default)]
    pub custom_args: Vec<String>,
    /// Custom env vars (merged with session type env)
    #[serde(default)]
    pub custom_env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionType {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub icon: String,
    pub color: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub status_patterns: HashMap<String, String>,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub agent_config: AgentConfig,
}

fn builtin_types() -> Vec<SessionType> {
    vec![
        SessionType {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            args: vec![],
            icon: "/icons/anthropic.svg".to_string(),
            color: "#e87f5f".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::new(),
            builtin: true,
            enabled: true,
            agent_config: AgentConfig::default(),
        },
        SessionType {
            id: "cursor-agent".to_string(),
            name: "Cursor Agent".to_string(),
            command: "agent".to_string(),
            args: vec![],
            icon: "/icons/cursor.svg".to_string(),
            color: "#0ea5e9".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::from([
                ("idle".to_string(), r"^>\s*$".to_string()),
                ("waiting".to_string(), r"\?\s*$|\(y/n\)".to_string()),
            ]),
            builtin: true,
            enabled: true,
            agent_config: AgentConfig::default(),
        },
        SessionType {
            id: "gemini-cli".to_string(),
            name: "Gemini CLI".to_string(),
            command: "gemini".to_string(),
            args: vec![],
            icon: "/icons/google.svg".to_string(),
            color: "#f59e0b".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::from([
                ("idle".to_string(), r"^>\s*$".to_string()),
            ]),
            builtin: true,
            enabled: true,
            agent_config: AgentConfig::default(),
        },
        SessionType {
            id: "openclaw".to_string(),
            name: "OpenClaw".to_string(),
            command: "openclaw".to_string(),
            args: vec!["tui".to_string()],
            icon: "🦞".to_string(),
            color: "#dc2626".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::new(),
            builtin: true,
            enabled: true,
            agent_config: AgentConfig::default(),
        },
        SessionType {
            id: "terminal".to_string(),
            name: "Terminal".to_string(),
            command: "zsh".to_string(),
            args: vec![],
            icon: "/icons/terminal.svg".to_string(),
            color: "#64748b".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::from([
                ("idle".to_string(), r"[\$%#]\s*$".to_string()),
            ]),
            builtin: true,
            enabled: true,
            agent_config: AgentConfig::default(),
        },
    ]
}

pub struct SessionTypeManager {
    types: Mutex<Vec<SessionType>>,
    storage_path: PathBuf,
}

impl SessionTypeManager {
    pub fn new() -> Self {
        let config_dir = dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".nextdialog");

        fs::create_dir_all(&config_dir).expect("Could not create config directory");

        let storage_path = config_dir.join("session_types.json");

        let types = if storage_path.exists() {
            let data = fs::read_to_string(&storage_path).unwrap_or_default();
            let mut saved: Vec<SessionType> = serde_json::from_str(&data).unwrap_or_default();
            // Sync builtins: add new, update existing, remove stale
            let builtins = builtin_types();
            let builtin_ids: Vec<&str> = builtins.iter().map(|b| b.id.as_str()).collect();
            // Remove saved builtins that are no longer in the builtin list
            saved.retain(|t| !t.builtin || builtin_ids.contains(&t.id.as_str()));
            for builtin in &builtins {
                if let Some(existing) = saved.iter_mut().find(|t| t.id == builtin.id) {
                    // Update builtin fields but preserve user's enabled state and config
                    let user_enabled = existing.enabled;
                    let user_config = existing.agent_config.clone();
                    *existing = builtin.clone();
                    existing.enabled = user_enabled;
                    existing.agent_config = user_config;
                } else {
                    saved.push(builtin.clone());
                }
            }
            saved
        } else {
            let types = builtin_types();
            // Persist initial builtins
            if let Ok(data) = serde_json::to_string_pretty(&types) {
                let _ = fs::write(&storage_path, data);
            }
            types
        };

        Self {
            types: Mutex::new(types),
            storage_path,
        }
    }

    fn persist(&self, types: &[SessionType]) {
        if let Ok(data) = serde_json::to_string_pretty(types) {
            let _ = fs::write(&self.storage_path, data);
        }
    }

    pub fn list(&self) -> Vec<SessionType> {
        self.types.lock().unwrap().clone()
    }

    pub fn get(&self, id: &str) -> Option<SessionType> {
        self.types.lock().unwrap().iter().find(|t| t.id == id).cloned()
    }

    pub fn create(&self, session_type: SessionType) -> Result<SessionType, String> {
        let mut types = self.types.lock().unwrap();
        if types.iter().any(|t| t.id == session_type.id) {
            return Err(format!("Session type already exists: {}", session_type.id));
        }
        let st = SessionType {
            builtin: false,
            ..session_type
        };
        types.push(st.clone());
        self.persist(&types);
        Ok(st)
    }

    pub fn update(&self, session_type: SessionType) -> Result<SessionType, String> {
        let mut types = self.types.lock().unwrap();
        let existing = types
            .iter_mut()
            .find(|t| t.id == session_type.id)
            .ok_or_else(|| format!("Session type not found: {}", session_type.id))?;
        if existing.builtin {
            // For built-ins, allow toggling enabled and updating agent config
            existing.enabled = session_type.enabled;
            existing.agent_config = session_type.agent_config;
        } else {
            *existing = SessionType {
                builtin: false,
                ..session_type
            };
        }
        let updated = existing.clone();
        self.persist(&types);
        Ok(updated)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut types = self.types.lock().unwrap();
        if let Some(t) = types.iter().find(|t| t.id == id) {
            if t.builtin {
                return Err("Cannot delete built-in session types".to_string());
            }
        } else {
            return Err(format!("Session type not found: {id}"));
        }
        types.retain(|t| t.id != id);
        self.persist(&types);
        Ok(())
    }
}
