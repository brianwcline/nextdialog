use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    #[serde(default)]
    pub default_directory: String,
    #[serde(default)]
    pub default_skip_permissions: bool,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            notifications_enabled: true,
            default_directory: String::new(),
            default_skip_permissions: false,
        }
    }
}

pub struct SettingsManager {
    settings: Mutex<Settings>,
    storage_path: PathBuf,
}

impl SettingsManager {
    pub fn new() -> Self {
        let config_dir = dirs::home_dir()
            .expect("Could not determine home directory")
            .join(".nextdialog");

        fs::create_dir_all(&config_dir).expect("Could not create config directory");

        let storage_path = config_dir.join("settings.json");

        let settings = if storage_path.exists() {
            let data = fs::read_to_string(&storage_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Settings::default()
        };

        Self {
            settings: Mutex::new(settings),
            storage_path,
        }
    }

    pub fn get(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn save(&self, settings: Settings) {
        if let Ok(data) = serde_json::to_string_pretty(&settings) {
            let _ = fs::write(&self.storage_path, data);
        }
        *self.settings.lock().unwrap() = settings;
    }
}
