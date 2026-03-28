pub mod provider;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use crate::settings::SettingsManager;

pub struct IntelligenceManager {
    annotations: Arc<Mutex<HashMap<String, String>>>,
    inflight: Arc<Mutex<HashMap<String, bool>>>,
    last_call: Arc<Mutex<HashMap<String, Instant>>>,
    client: reqwest::blocking::Client,
}

impl IntelligenceManager {
    pub fn new() -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            annotations: Arc::new(Mutex::new(HashMap::new())),
            inflight: Arc::new(Mutex::new(HashMap::new())),
            last_call: Arc::new(Mutex::new(HashMap::new())),
            client,
        }
    }

    pub fn request_annotation(
        &self,
        id: &str,
        preview_lines: Vec<String>,
        settings_manager: &SettingsManager,
        app_handle: &AppHandle,
    ) {
        let settings = settings_manager.get();

        if !settings.intelligence_enabled || settings.intelligence_api_key.is_empty() {
            return;
        }

        // Check cooldown (10s per session)
        {
            let last = self.last_call.lock().unwrap();
            if let Some(t) = last.get(id) {
                if t.elapsed().as_secs() < 10 {
                    return;
                }
            }
        }

        // Check inflight guard
        {
            let inf = self.inflight.lock().unwrap();
            if inf.get(id) == Some(&true) {
                return;
            }
        }

        // Set inflight
        self.inflight.lock().unwrap().insert(id.to_string(), true);

        // Emit analyzing state
        let _ = app_handle.emit(&format!("session-annotation-{id}"), "__analyzing__");

        // Clone what we need for the thread
        let session_id = id.to_string();
        let provider = settings.intelligence_provider.clone();
        let api_key = settings.intelligence_api_key.clone();
        let api_url = settings.intelligence_api_url.clone();
        let client = self.client.clone();
        let annotations = self.annotations.clone();
        let inflight = self.inflight.clone();
        let last_call = self.last_call.clone();
        let handle = app_handle.clone();

        let prompt_text = preview_lines.join("\n");

        std::thread::spawn(move || {
            let result = provider::call_annotation(&client, &provider, &api_key, &api_url, &prompt_text);

            match result {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    annotations.lock().unwrap().insert(session_id.clone(), trimmed.clone());
                    let _ = handle.emit(&format!("session-annotation-{session_id}"), &trimmed);
                }
                Err(_) => {
                    // Silently fail — clear analyzing state
                    let _ = handle.emit(&format!("session-annotation-{session_id}"), "");
                }
            }

            inflight.lock().unwrap().insert(session_id.clone(), false);
            last_call.lock().unwrap().insert(session_id, Instant::now());
        });
    }

    pub fn get_annotation(&self, id: &str) -> Option<String> {
        self.annotations.lock().unwrap().get(id).cloned()
    }

    pub fn clear_annotation(&self, id: &str) {
        self.annotations.lock().unwrap().remove(id);
    }

    /// Synchronously summarize timeline entries for "catch me up" feature.
    /// No cooldown or inflight guard — this is user-initiated.
    pub fn summarize_sync(
        &self,
        settings_manager: &SettingsManager,
        entries_text: &str,
    ) -> Result<String, String> {
        let settings = settings_manager.get();

        if !settings.intelligence_enabled || settings.intelligence_api_key.is_empty() {
            return Err("Intelligence is not configured. Enable it in Settings to use Catch Me Up.".to_string());
        }

        let system = "You are summarizing what happened in a coding session. Given recent actions, provide a 2-3 sentence catch-me-up summary. Be specific about what was worked on. Focus on outcomes, not process. Reply with only the summary.";

        provider::call_llm(
            &self.client,
            &settings.intelligence_provider,
            &settings.intelligence_api_key,
            &settings.intelligence_api_url,
            system,
            entries_text,
            150,
        )
        .map(|s| s.trim().to_string())
    }
}
