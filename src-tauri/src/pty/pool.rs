use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

use crate::status::detector::{SessionStatus, StatusDetector};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct PtyPool {
    sessions: Mutex<HashMap<String, PtySession>>,
    detectors: Arc<Mutex<HashMap<String, Arc<Mutex<StatusDetector>>>>>,
}

impl PtyPool {
    pub fn new() -> Self {
        let detectors: Arc<Mutex<HashMap<String, Arc<Mutex<StatusDetector>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Silence checker thread — runs every 500ms
        let detectors_clone = detectors.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            // We can't emit events here without an AppHandle, so we just
            // update the detector state. The frontend polls via events.
            let map = detectors_clone.lock().unwrap();
            for (_id, detector) in map.iter() {
                let _ = detector.lock().unwrap().check_silence(2.0);
            }
        });

        Self {
            sessions: Mutex::new(HashMap::new()),
            detectors,
        }
    }

    fn spawn_inner(
        &self,
        id: &str,
        cmd: CommandBuilder,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {e}"))?;

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {e}"))?;

        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {e}"))?;

        // Create status detector for this session
        let detector = Arc::new(Mutex::new(StatusDetector::new()));
        self.detectors
            .lock()
            .unwrap()
            .insert(id.to_string(), detector.clone());

        // Reader thread — OS thread, not tokio
        let session_id = id.to_string();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // Carry-over buffer for incomplete UTF-8 sequences split across reads
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = handle.emit(&format!("pty-exit-{session_id}"), ());
                        let _ = handle.emit(
                            &format!("session-status-{session_id}"),
                            "stopped",
                        );
                        break;
                    }
                    Ok(n) => {
                        // Status detection tap — process before emitting
                        if let Some(new_status) =
                            detector.lock().unwrap().process_bytes(&buf[..n])
                        {
                            let status_str = match new_status {
                                SessionStatus::Stopped => "stopped",
                                SessionStatus::Starting => "starting",
                                SessionStatus::Idle => "idle",
                                SessionStatus::Working => "working",
                                SessionStatus::Planning => "planning",
                                SessionStatus::Waiting => "waiting",
                                SessionStatus::Error => "error",
                            };
                            let _ = handle.emit(
                                &format!("session-status-{session_id}"),
                                status_str,
                            );
                        }

                        // Prepend any leftover bytes from previous read
                        pending.extend_from_slice(&buf[..n]);

                        // Find the longest valid UTF-8 prefix
                        let valid_up_to = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(e) => e.valid_up_to(),
                        };

                        if valid_up_to > 0 {
                            let data = std::str::from_utf8(&pending[..valid_up_to])
                                .unwrap()
                                .to_string();
                            let _ =
                                handle.emit(&format!("pty-data-{session_id}"), &data);
                        }

                        // Keep incomplete trailing bytes for next read
                        let leftover = pending[valid_up_to..].to_vec();
                        pending.clear();
                        pending.extend_from_slice(&leftover);
                    }
                    Err(_) => {
                        let _ = handle.emit(&format!("pty-exit-{session_id}"), ());
                        let _ = handle.emit(
                            &format!("session-status-{session_id}"),
                            "stopped",
                        );
                        break;
                    }
                }
            }
        });

        let session = PtySession {
            master: pair.master,
            writer,
            child,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(id.to_string(), session);

        Ok(())
    }

    pub fn spawn(
        &self,
        id: &str,
        cwd: &str,
        skip_permissions: bool,
        initial_prompt: Option<&str>,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        let mut cmd = CommandBuilder::new("claude");
        if skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
        }
        if let Some(prompt) = initial_prompt {
            if !prompt.is_empty() {
                cmd.arg("--prompt");
                cmd.arg(prompt);
            }
        }
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", "en_US.UTF-8");
        self.spawn_inner(id, cmd, rows, cols, app_handle)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("Session not found: {id}"))?;
        session
            .writer
            .write_all(data)
            .map_err(|e| format!("Write failed: {e}"))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {e}"))
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(id)
            .ok_or_else(|| format!("Session not found: {id}"))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {e}"))
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut session) = sessions.remove(id) {
            session
                .child
                .kill()
                .map_err(|e| format!("Kill failed: {e}"))?;
        }
        self.detectors.lock().unwrap().remove(id);
        Ok(())
    }

    pub fn restart(
        &self,
        id: &str,
        cwd: &str,
        skip_permissions: bool,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        self.kill(id)?;
        let mut cmd = CommandBuilder::new("claude");
        cmd.arg("--continue");
        if skip_permissions {
            cmd.arg("--dangerously-skip-permissions");
        }
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", "en_US.UTF-8");
        self.spawn_inner(id, cmd, rows, cols, app_handle)
    }
}
