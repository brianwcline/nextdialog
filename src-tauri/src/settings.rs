use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub default_directory: String,
    #[serde(default)]
    pub default_skip_permissions: bool,
    #[serde(default)]
    pub intelligence_enabled: bool,
    #[serde(default)]
    pub intelligence_provider: String,
    #[serde(default)]
    pub intelligence_api_key: String,
    #[serde(default)]
    pub intelligence_api_url: String,
    #[serde(default)]
    pub machine_id: String,
    #[serde(default)]
    pub telemetry_enabled: bool,
    #[serde(default = "default_hooks_enabled")]
    pub hooks_enabled: bool,
    #[serde(default = "default_hook_port_start")]
    pub hook_port_start: u16,
    #[serde(default = "default_hook_port_end")]
    pub hook_port_end: u16,
    #[serde(default = "default_background_mode")]
    pub background_mode: String,
    #[serde(default)]
    pub background_image_path: String,
}

fn default_hooks_enabled() -> bool {
    true
}

fn default_hook_port_start() -> u16 {
    7432
}

fn default_hook_port_end() -> u16 {
    7499
}

fn default_background_mode() -> String {
    "gradient".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_directory: String::new(),
            default_skip_permissions: false,
            intelligence_enabled: false,
            intelligence_provider: String::new(),
            intelligence_api_key: String::new(),
            intelligence_api_url: String::new(),
            machine_id: Uuid::new_v4().to_string(),
            telemetry_enabled: false,
            hooks_enabled: true,
            hook_port_start: 7432,
            hook_port_end: 7499,
            background_mode: "gradient".to_string(),
            background_image_path: String::new(),
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

        let mut settings: Settings = if storage_path.exists() {
            let data = fs::read_to_string(&storage_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Settings::default()
        };

        // Auto-generate machine_id on first launch (or upgrade from older config)
        if settings.machine_id.is_empty() {
            settings.machine_id = Uuid::new_v4().to_string();
            if let Ok(data) = serde_json::to_string_pretty(&settings) {
                let _ = fs::write(&storage_path, data);
            }
        }

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
