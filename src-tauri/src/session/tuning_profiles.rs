use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::tuning::SessionTuning;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuningProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// Which agent type this profile is for: "claude-code", "cursor-agent", "gemini-cli", or "*"
    pub agent_type: String,
    pub tuning: SessionTuning,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct TuningProfileManager {
    profiles: Mutex<Vec<TuningProfile>>,
    storage_path: PathBuf,
}

impl TuningProfileManager {
    pub fn new() -> Self {
        let config_dir = dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".nextdialog");

        fs::create_dir_all(&config_dir).expect("Could not create config directory");

        let storage_path = config_dir.join("tuning_profiles.json");

        let profiles: Vec<TuningProfile> = if storage_path.exists() {
            let data = fs::read_to_string(&storage_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Vec::new()
        };

        Self {
            profiles: Mutex::new(profiles),
            storage_path,
        }
    }

    fn persist(&self, profiles: &[TuningProfile]) {
        if let Ok(data) = serde_json::to_string_pretty(profiles) {
            let _ = fs::write(&self.storage_path, data);
        }
    }

    /// List all profiles, optionally filtered by agent type.
    pub fn list(&self, agent_type: Option<&str>) -> Vec<TuningProfile> {
        let profiles = self.profiles.lock().unwrap();
        match agent_type {
            Some(at) => profiles
                .iter()
                .filter(|p| p.agent_type == at || p.agent_type == "*")
                .cloned()
                .collect(),
            None => profiles.clone(),
        }
    }

    pub fn get(&self, id: &str) -> Option<TuningProfile> {
        self.profiles.lock().unwrap().iter().find(|p| p.id == id).cloned()
    }

    pub fn create(
        &self,
        name: String,
        description: Option<String>,
        agent_type: String,
        tuning: SessionTuning,
        tags: Vec<String>,
    ) -> TuningProfile {
        let now = Utc::now();
        let profile = TuningProfile {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            agent_type,
            tuning,
            tags,
            created_at: now,
            updated_at: now,
        };

        let mut profiles = self.profiles.lock().unwrap();
        profiles.push(profile.clone());
        self.persist(&profiles);
        profile
    }

    pub fn update(&self, id: &str, profile: TuningProfile) -> Result<TuningProfile, String> {
        let mut profiles = self.profiles.lock().unwrap();
        let existing = profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Profile not found: {id}"))?;

        existing.name = profile.name;
        existing.description = profile.description;
        existing.agent_type = profile.agent_type;
        existing.tuning = profile.tuning;
        existing.tags = profile.tags;
        existing.updated_at = Utc::now();

        let updated = existing.clone();
        self.persist(&profiles);
        Ok(updated)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut profiles = self.profiles.lock().unwrap();
        let before = profiles.len();
        profiles.retain(|p| p.id != id);
        if profiles.len() == before {
            return Err(format!("Profile not found: {id}"));
        }
        self.persist(&profiles);
        Ok(())
    }
}
