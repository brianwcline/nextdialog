use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use uuid::Uuid;

use super::config::{CreateSessionRequest, SessionConfig};

pub struct SessionManager {
    sessions: Mutex<Vec<SessionConfig>>,
    storage_path: PathBuf,
}

impl SessionManager {
    pub fn new() -> Self {
        let config_dir = dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".nextdialog");

        fs::create_dir_all(&config_dir).expect("Could not create config directory");

        let storage_path = config_dir.join("sessions.json");

        let sessions = if storage_path.exists() {
            let data = fs::read_to_string(&storage_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Vec::new()
        };

        Self {
            sessions: Mutex::new(sessions),
            storage_path,
        }
    }

    fn persist(&self, sessions: &[SessionConfig]) {
        if let Ok(data) = serde_json::to_string_pretty(sessions) {
            let _ = fs::write(&self.storage_path, data);
        }
    }

    pub fn list(&self) -> Vec<SessionConfig> {
        self.sessions.lock().unwrap().clone()
    }

    pub fn create(&self, req: CreateSessionRequest) -> Result<SessionConfig, String> {
        // Validate directory exists
        let path = PathBuf::from(&req.working_directory);
        if !path.is_dir() {
            return Err(format!(
                "Directory does not exist: {}",
                req.working_directory
            ));
        }

        let now = Utc::now();
        let session = SessionConfig {
            id: Uuid::new_v4().to_string(),
            name: req.name,
            working_directory: req.working_directory,
            skip_permissions: req.skip_permissions,
            initial_prompt: req.initial_prompt,
            created_at: now,
            last_active: now,
            status: "stopped".to_string(),
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.push(session.clone());
        self.persist(&sessions);

        Ok(session)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let before = sessions.len();
        sessions.retain(|s| s.id != id);
        if sessions.len() == before {
            return Err(format!("Session not found: {id}"));
        }
        self.persist(&sessions);
        Ok(())
    }

    pub fn update_status(&self, id: &str, status: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.iter_mut().find(|s| s.id == id) {
            session.status = status.to_string();
            session.last_active = Utc::now();
        }
        self.persist(&sessions);
    }

    pub fn get(&self, id: &str) -> Option<SessionConfig> {
        self.sessions.lock().unwrap().iter().find(|s| s.id == id).cloned()
    }
}
