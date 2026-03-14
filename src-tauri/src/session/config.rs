use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub id: String,
    pub name: String,
    pub working_directory: String,
    pub skip_permissions: bool,
    #[serde(default)]
    pub initial_prompt: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_status() -> String {
    "stopped".to_string()
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub name: String,
    pub working_directory: String,
    #[serde(default)]
    pub skip_permissions: bool,
    pub initial_prompt: Option<String>,
}
