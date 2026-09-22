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
    #[serde(default = "default_mood_theme")]
    pub mood_theme: String,
    /// xterm font size in px, shared by every terminal pane. Clamped to
    /// [TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX] on write.
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u16,
}

pub const TERMINAL_FONT_SIZE_MIN: u16 = 9;
pub const TERMINAL_FONT_SIZE_MAX: u16 = 24;
pub const TERMINAL_FONT_SIZE_DEFAULT: u16 = 13;

fn default_terminal_font_size() -> u16 {
    TERMINAL_FONT_SIZE_DEFAULT
}

pub fn clamp_terminal_font_size(size: u16) -> u16 {
    size.clamp(TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX)
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

fn default_mood_theme() -> String {
    "zen".to_string()
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
            mood_theme: "zen".to_string(),
            terminal_font_size: TERMINAL_FONT_SIZE_DEFAULT,
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

    /// Read-modify-write a single field under the lock. Unlike `save`, this
    /// can't clobber fields another caller changed since the frontend last
    /// read the full struct (e.g. a Cmd+= zoom racing a theme change).
    pub fn update<F: FnOnce(&mut Settings)>(&self, mutate: F) -> Settings {
        let mut guard = self.settings.lock().unwrap();
        mutate(&mut guard);
        if let Ok(data) = serde_json::to_string_pretty(&*guard) {
            if let Err(err) = fs::write(&self.storage_path, data) {
                eprintln!("[settings] failed to persist settings.json: {err}");
            }
        }
        guard.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_font_size_defaults_when_missing_from_old_settings_file() {
        let settings: Settings = serde_json::from_str(r#"{"mood_theme":"zen"}"#).unwrap();
        assert_eq!(settings.terminal_font_size, TERMINAL_FONT_SIZE_DEFAULT);
    }

    #[test]
    fn terminal_font_size_is_clamped() {
        assert_eq!(clamp_terminal_font_size(2), TERMINAL_FONT_SIZE_MIN);
        assert_eq!(clamp_terminal_font_size(99), TERMINAL_FONT_SIZE_MAX);
        assert_eq!(clamp_terminal_font_size(15), 15);
    }
}
