use std::sync::{Arc, Mutex};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const API_URL: &str = env!("ND_API_URL");
const API_KEY: &str = env!("ND_API_KEY");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub machine_id: String,
    pub session_id: Option<String>,
    pub event_name: String,
    pub feature_id: String,
    pub properties: Option<Value>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize)]
struct FeedbackPayload {
    machine_id: String,
    app_version: String,
    text: String,
    severity: String,
    category: Option<String>,
    app_state: Option<Value>,
}

#[derive(Debug, Serialize)]
struct TelemetryBatch {
    events: Vec<TelemetryEvent>,
}

#[derive(Clone)]
pub struct TelemetryClient {
    buffer: Arc<Mutex<Vec<TelemetryEvent>>>,
    machine_id: String,
    client: Client,
}

impl TelemetryClient {
    pub fn new(machine_id: String) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            machine_id,
            client,
        }
    }

    pub fn queue_event(
        &self,
        event_name: String,
        feature_id: String,
        properties: Option<Value>,
        session_id: Option<String>,
        timestamp: Option<String>,
    ) {
        let event = TelemetryEvent {
            machine_id: self.machine_id.clone(),
            session_id,
            event_name,
            feature_id,
            properties,
            timestamp,
        };
        self.buffer.lock().unwrap().push(event);
    }

    pub fn flush(&self) -> Result<(), String> {
        let events: Vec<TelemetryEvent> = {
            let mut buf = self.buffer.lock().unwrap();
            if buf.is_empty() {
                return Ok(());
            }
            std::mem::take(&mut *buf)
        };

        let batch = TelemetryBatch { events: events.clone() };

        let response = self.client
            .post(format!("{API_URL}/telemetry"))
            .header("X-API-Key", API_KEY)
            .json(&batch)
            .send();

        match response {
            Ok(resp) if resp.status().is_success() => Ok(()),
            Ok(resp) => {
                self.buffer.lock().unwrap().extend(events);
                Err(format!("Telemetry flush failed: HTTP {}", resp.status()))
            }
            Err(e) => {
                self.buffer.lock().unwrap().extend(events);
                Err(format!("Failed to flush telemetry: {e}"))
            }
        }
    }

    pub fn submit_feedback(
        &self,
        text: String,
        severity: String,
        category: Option<String>,
        app_state: Option<Value>,
    ) -> Result<(), String> {
        let payload = FeedbackPayload {
            machine_id: self.machine_id.clone(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            text,
            severity,
            category,
            app_state,
        };

        let response = self.client
            .post(format!("{API_URL}/feedback"))
            .header("X-API-Key", API_KEY)
            .json(&payload)
            .send()
            .map_err(|e| format!("Failed to submit feedback: {e}"))?;

        if !response.status().is_success() {
            return Err(format!("Feedback submission failed: HTTP {}", response.status()));
        }

        Ok(())
    }
}
