use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::Utc;
use uuid::Uuid;

use super::config::{CreateSessionRequest, SessionConfig};
use super::tuning::SessionTuning;

/// Longest group name we store; longer input is cut on a char boundary.
const MAX_GROUP_NAME_CHARS: usize = 40;

/// Trim a group name and cap its length; blank means "no group".
fn normalize_group_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_GROUP_NAME_CHARS).collect())
}

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

        Self::load(config_dir.join("sessions.json"))
    }

    fn load(storage_path: PathBuf) -> Self {
        let mut sessions: Vec<SessionConfig> = if storage_path.exists() {
            let data = fs::read_to_string(&storage_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Vec::new()
        };

        // No PTY is running on fresh launch — reset all to "ready"
        for s in &mut sessions {
            s.status = "ready".to_string();
        }

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
            status: "ready".to_string(),
            session_type: req.session_type,
            parked: false,
            parent_id: req.parent_id,
            tuning: None,
            current_prompt: None,
            group: None,
        };

        let mut sessions = self.sessions.lock().unwrap();
        sessions.push(session.clone());
        self.persist(&sessions);

        Ok(session)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let before = sessions.len();
        // Cascade: also remove companions whose parent_id matches
        sessions.retain(|s| s.id != id && s.parent_id.as_deref() != Some(id));
        if sessions.len() == before {
            return Err(format!("Session not found: {id}"));
        }
        self.persist(&sessions);
        Ok(())
    }

    pub fn list_companions(&self, parent_id: &str) -> Vec<SessionConfig> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .filter(|s| s.parent_id.as_deref() == Some(parent_id))
            .cloned()
            .collect()
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

    pub fn set_parked(&self, id: &str, parked: bool) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.iter_mut().find(|s| s.id == id) {
            session.parked = parked;
        }
        self.persist(&sessions);
    }

    /// Put a session in a named group, or take it out with `None`. Names are
    /// trimmed; blank means ungrouped.
    pub fn set_group(&self, id: &str, group: Option<&str>) -> Result<Option<String>, String> {
        let normalized = group.and_then(normalize_group_name);
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("Session not found: {id}"))?;
        session.group = normalized.clone();
        self.persist(&sessions);
        Ok(normalized)
    }

    /// Rename a group by moving every member to the new name in one write.
    /// Returns the stored name and how many sessions moved.
    pub fn rename_group(&self, from: &str, to: &str) -> Result<(String, usize), String> {
        let to = normalize_group_name(to).ok_or("Group name can't be blank")?;
        let mut sessions = self.sessions.lock().unwrap();
        let mut moved = 0;
        for session in sessions.iter_mut().filter(|s| s.group.as_deref() == Some(from)) {
            session.group = Some(to.clone());
            moved += 1;
        }
        if moved > 0 {
            self.persist(&sessions);
        }
        Ok((to, moved))
    }

    pub fn update_tuning(
        &self,
        id: &str,
        tuning: Option<SessionTuning>,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("Session not found: {id}"))?;
        session.tuning = tuning;
        session.last_active = Utc::now();
        self.persist(&sessions);
        Ok(())
    }

    /// Record the latest user prompt on a session. The smart layout renders
    /// this as a subtitle on the focused hero card; dock cards ignore it.
    /// Every new prompt overwrites the previous one because the field
    /// describes "what's happening now," not a frozen title.
    /// Returns the stored preview if applied, `None` if skipped.
    pub fn update_current_prompt(&self, id: &str, prompt: &str) -> Option<String> {
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            return None;
        }
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.iter_mut().find(|s| s.id == id)?;
        session.current_prompt = Some(trimmed.to_string());
        session.last_active = Utc::now();
        let stored = session.current_prompt.clone();
        self.persist(&sessions);
        stored
    }

    pub fn get_tuning(&self, id: &str) -> Option<SessionTuning> {
        self.sessions
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| s.tuning.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager_in(dir: &std::path::Path) -> SessionManager {
        SessionManager::load(dir.join("sessions.json"))
    }

    fn create_session(manager: &SessionManager, dir: &std::path::Path) -> String {
        manager
            .create(CreateSessionRequest {
                name: "demo".to_string(),
                working_directory: dir.to_string_lossy().into_owned(),
                skip_permissions: false,
                initial_prompt: None,
                session_type: "claude-code".to_string(),
                parent_id: None,
            })
            .unwrap()
            .id
    }

    #[test]
    fn set_group_trims_and_persists() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = manager_in(tmp.path());
        let id = create_session(&manager, tmp.path());

        assert_eq!(manager.set_group(&id, Some("  Clients ")).unwrap().as_deref(), Some("Clients"));

        let reloaded = manager_in(tmp.path());
        assert_eq!(reloaded.get(&id).unwrap().group.as_deref(), Some("Clients"));
    }

    #[test]
    fn blank_or_none_clears_group() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = manager_in(tmp.path());
        let id = create_session(&manager, tmp.path());

        manager.set_group(&id, Some("Clients")).unwrap();
        assert_eq!(manager.set_group(&id, Some("   ")).unwrap(), None);
        manager.set_group(&id, Some("Clients")).unwrap();
        assert_eq!(manager.set_group(&id, None).unwrap(), None);
        assert_eq!(manager.get(&id).unwrap().group, None);
    }

    #[test]
    fn long_group_names_are_capped_on_char_boundaries() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = manager_in(tmp.path());
        let id = create_session(&manager, tmp.path());

        let stored = manager.set_group(&id, Some(&"é".repeat(60))).unwrap().unwrap();
        assert_eq!(stored.chars().count(), MAX_GROUP_NAME_CHARS);
    }

    #[test]
    fn rename_group_moves_every_member() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = manager_in(tmp.path());
        let a = create_session(&manager, tmp.path());
        let b = create_session(&manager, tmp.path());
        let c = create_session(&manager, tmp.path());
        manager.set_group(&a, Some("Clients")).unwrap();
        manager.set_group(&b, Some("Clients")).unwrap();
        manager.set_group(&c, Some("Personal")).unwrap();

        let (stored, moved) = manager.rename_group("Clients", " Acme ").unwrap();
        assert_eq!((stored.as_str(), moved), ("Acme", 2));

        let reloaded = manager_in(tmp.path());
        assert_eq!(reloaded.get(&a).unwrap().group.as_deref(), Some("Acme"));
        assert_eq!(reloaded.get(&b).unwrap().group.as_deref(), Some("Acme"));
        assert_eq!(reloaded.get(&c).unwrap().group.as_deref(), Some("Personal"));
    }

    #[test]
    fn rename_group_rejects_blank_and_ignores_unknown() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = manager_in(tmp.path());
        let a = create_session(&manager, tmp.path());
        manager.set_group(&a, Some("Clients")).unwrap();

        assert!(manager.rename_group("Clients", "   ").is_err());
        assert_eq!(manager.rename_group("Nope", "Other").unwrap().1, 0);
        assert_eq!(manager.get(&a).unwrap().group.as_deref(), Some("Clients"));
    }

    #[test]
    fn unknown_session_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        let manager = manager_in(tmp.path());
        assert!(manager.set_group("missing", Some("Clients")).is_err());
    }

    #[test]
    fn sessions_file_without_group_field_still_loads() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = serde_json::json!([{
            "id": "s1",
            "name": "old",
            "working_directory": "/tmp",
            "skip_permissions": false,
            "created_at": "2026-01-01T00:00:00Z",
            "last_active": "2026-01-01T00:00:00Z"
        }]);
        fs::write(tmp.path().join("sessions.json"), legacy.to_string()).unwrap();

        let manager = manager_in(tmp.path());
        let session = manager.get("s1").unwrap();
        assert_eq!(session.group, None);
    }
}
