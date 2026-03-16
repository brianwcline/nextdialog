use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::AppHandle;
use tiny_http::{Header, Response, Server};

use super::payloads::HookPayload;
use super::processor;

pub struct HookServer {
    port: u16,
    stop_flag: Arc<AtomicBool>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
}

impl HookServer {
    /// Start an HTTP hook server on the given port.
    /// Spawns a background thread that accepts POST /hook requests.
    pub fn start(
        port: u16,
        session_id: String,
        app_handle: AppHandle,
    ) -> Result<Self, String> {
        let addr = format!("127.0.0.1:{port}");
        let server = Server::http(&addr).map_err(|e| format!("Failed to bind hook server on {addr}: {e}"))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();

        let thread_handle = std::thread::spawn(move || {
            loop {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }

                let mut request = match server.recv_timeout(std::time::Duration::from_millis(500)) {
                    Ok(Some(req)) => req,
                    Ok(None) => continue, // timeout
                    Err(_) => continue,
                };

                // Always respond 200 immediately to not block Claude Code
                let method = request.method().to_string();
                let url = request.url().to_string();

                // URL format: /hook/{EventType} (e.g. /hook/PostToolUse)
                let event_type = if method == "POST" && url.starts_with("/hook/") {
                    url.strip_prefix("/hook/").map(|s| s.to_string())
                } else {
                    None
                };

                let json_header: Header = "Content-Type: application/json".parse().unwrap();

                if event_type.is_none() {
                    let _ = request.respond(
                        Response::from_string(r#"{"error":"not found"}"#)
                            .with_status_code(404)
                            .with_header(json_header),
                    );
                    continue;
                }
                let event_type = event_type.unwrap();

                // Read body
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let _ = request.respond(
                        Response::from_string("{}")
                            .with_header(json_header),
                    );
                    continue;
                }

                // Respond immediately before processing
                let _ = request.respond(
                    Response::from_string("{}")
                        .with_header(json_header),
                );

                // Parse and process — inject event type from URL path
                match serde_json::from_str::<HookPayload>(&body) {
                    Ok(mut payload) => {
                        payload.hook_type = Some(event_type);
                        processor::process(&session_id, payload, &app_handle);
                    }
                    Err(e) => {
                        eprintln!(
                            "[hooks] Failed to parse payload for session {}: {e}\nBody: {body}",
                            session_id
                        );
                    }
                }
            }
        });

        Ok(Self { port, stop_flag, thread_handle: Some(thread_handle) })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    #[allow(dead_code)]
    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }

    /// Stop the server and wait for the thread to exit (~500ms max from recv_timeout).
    pub fn stop_and_wait(&mut self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}
