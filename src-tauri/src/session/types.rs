use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

fn default_enabled() -> bool {
    true
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
}

fn builtin_types() -> Vec<SessionType> {
    vec![
        SessionType {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            command: "claude".to_string(),
            args: vec![],
            icon: "/icons/anthropic.svg".to_string(),
            color: "#6366f1".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::new(),
            builtin: true,
            enabled: true,
        },
        SessionType {
            id: "aider".to_string(),
            name: "Aider".to_string(),
            command: "aider".to_string(),
            args: vec![],
            icon: "/icons/aider.svg".to_string(),
            color: "#10b981".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::from([
                ("idle".to_string(), r"^>\s*$".to_string()),
                ("waiting".to_string(), r"\?\s*$|\(y/n\)".to_string()),
            ]),
            builtin: true,
            enabled: true,
        },
        SessionType {
            id: "codex-cli".to_string(),
            name: "Codex CLI".to_string(),
            command: "codex".to_string(),
            args: vec![],
            icon: "/icons/openai.svg".to_string(),
            color: "#0ea5e9".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::new(),
            builtin: true,
            enabled: true,
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
        },
        SessionType {
            id: "openclaw".to_string(),
            name: "OpenClaw".to_string(),
            command: "openclaw".to_string(),
            args: vec!["tui".to_string()],
            icon: "/icons/openclaw.svg".to_string(),
            color: "#dc2626".to_string(),
            env: HashMap::new(),
            status_patterns: HashMap::new(),
            builtin: true,
            enabled: true,
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
            // Ensure all builtins exist (merge)
            let builtins = builtin_types();
            for builtin in &builtins {
                if let Some(existing) = saved.iter_mut().find(|t| t.id == builtin.id) {
                    // Update builtin fields but preserve user's enabled state
                    let user_enabled = existing.enabled;
                    *existing = builtin.clone();
                    existing.enabled = user_enabled;
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
            // For built-ins, only allow toggling enabled
            existing.enabled = session_type.enabled;
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
