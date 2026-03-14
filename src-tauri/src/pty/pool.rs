use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

use crate::pty::activity::ActivityTracker;
use crate::session::types::SessionType;
use crate::status::detector::{SessionStatus, StatusDetector};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub struct PtyPool {
    sessions: Mutex<HashMap<String, PtySession>>,
    detectors: Arc<Mutex<HashMap<String, Arc<Mutex<StatusDetector>>>>>,
    preview_lines: Arc<Mutex<HashMap<String, Arc<Mutex<VecDeque<String>>>>>>,
    activity_trackers: Arc<Mutex<HashMap<String, Arc<Mutex<ActivityTracker>>>>>,
    app_handle: Mutex<Option<AppHandle>>,
}

impl PtyPool {
    pub fn new() -> Self {
        let detectors: Arc<Mutex<HashMap<String, Arc<Mutex<StatusDetector>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        Self {
            sessions: Mutex::new(HashMap::new()),
            detectors,
            preview_lines: Arc::new(Mutex::new(HashMap::new())),
            activity_trackers: Arc::new(Mutex::new(HashMap::new())),
            app_handle: Mutex::new(None),
        }
    }

    fn ensure_silence_checker(&self, app_handle: &AppHandle) {
        let mut handle_guard = self.app_handle.lock().unwrap();
        if handle_guard.is_some() {
            return; // Already started
        }
        *handle_guard = Some(app_handle.clone());

        let detectors = self.detectors.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let map = detectors.lock().unwrap();
            for (id, detector) in map.iter() {
                if let Some(SessionStatus::Idle) = detector.lock().unwrap().check_silence(2.0) {
                    let _ = handle.emit(&format!("session-status-{id}"), "idle");
                }
            }
        });
    }

    fn spawn_inner(
        &self,
        id: &str,
        cmd: CommandBuilder,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
        status_patterns: Option<&HashMap<String, String>>,
    ) -> Result<(), String> {
        self.ensure_silence_checker(app_handle);
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
            .map_err(|e| format!("Failed to spawn command: {e}"))?;

        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {e}"))?;

        // Create status detector for this session (with optional custom patterns)
        let detector = Arc::new(Mutex::new(StatusDetector::with_patterns(status_patterns)));
        self.detectors
            .lock()
            .unwrap()
            .insert(id.to_string(), detector.clone());

        // Create preview lines buffer (capacity 8, return last 5)
        let preview = Arc::new(Mutex::new(VecDeque::with_capacity(8)));
        self.preview_lines
            .lock()
            .unwrap()
            .insert(id.to_string(), preview.clone());

        // Create activity tracker
        let activity = Arc::new(Mutex::new(ActivityTracker::new()));
        self.activity_trackers
            .lock()
            .unwrap()
            .insert(id.to_string(), activity.clone());

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
                        {
                            let mut det = detector.lock().unwrap();
                            if let Some(new_status) = det.process_bytes(&buf[..n]) {
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

                                // Emit plan summary when entering planning mode
                                if new_status == SessionStatus::Planning {
                                    if let Some(ref summary) = det.extras().plan_summary {
                                        let _ = handle.emit(
                                            &format!("session-plan-{session_id}"),
                                            summary.clone(),
                                        );
                                    }
                                }
                            }

                            // Emit context usage updates
                            if let Some(usage) = det.extras().context_usage {
                                let _ = handle.emit(
                                    &format!("session-context-{session_id}"),
                                    usage,
                                );
                            }
                        }

                        // Record activity (byte count per minute bucket)
                        activity.lock().unwrap().record(n as u32);

                        // Update preview lines (last 8 meaningful lines)
                        {
                            let stripped = strip_ansi_escapes::strip(&buf[..n]);
                            let text = String::from_utf8_lossy(&stripped);
                            let mut pv = preview.lock().unwrap();
                            for line in text.split('\n') {
                                let trimmed = line.trim();
                                if trimmed.is_empty() {
                                    continue;
                                }
                                // Skip decorative/noise lines: mostly box-drawing,
                                // dashes, dots, or other non-alphanumeric chars
                                let alpha_count = trimmed.chars()
                                    .filter(|c| c.is_alphanumeric())
                                    .count();
                                if alpha_count < 3 {
                                    continue;
                                }
                                let capped = if trimmed.len() > 200 {
                                    let mut end = 200;
                                    while !trimmed.is_char_boundary(end) {
                                        end -= 1;
                                    }
                                    &trimmed[..end]
                                } else {
                                    trimmed
                                };
                                if pv.len() >= 8 {
                                    pv.pop_front();
                                }
                                pv.push_back(capped.to_string());
                            }
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
        session_type: &SessionType,
        cwd: &str,
        skip_permissions: bool,
        initial_prompt: Option<&str>,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        // Split command on whitespace to support multi-word commands (e.g. "python3 -m myagent")
        let parts: Vec<&str> = session_type.command.split_whitespace().collect();
        let mut cmd = CommandBuilder::new(parts.first().unwrap_or(&""));
        for part in parts.iter().skip(1) {
            cmd.arg(part);
        }

        // Add session type's default args
        for arg in &session_type.args {
            cmd.arg(arg);
        }

        // Claude-specific flags
        if session_type.id == "claude-code" {
            if skip_permissions {
                cmd.arg("--dangerously-skip-permissions");
            }
            if let Some(prompt) = initial_prompt {
                if !prompt.is_empty() {
                    cmd.arg("--prompt");
                    cmd.arg(prompt);
                }
            }
        }

        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", "en_US.UTF-8");

        // Add session type's custom env vars
        for (key, val) in &session_type.env {
            cmd.env(key, val);
        }

        let patterns = if session_type.status_patterns.is_empty() {
            None
        } else {
            Some(&session_type.status_patterns)
        };

        self.spawn_inner(id, cmd, rows, cols, app_handle, patterns)
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

    pub fn get_activity(&self, id: &str) -> Vec<u32> {
        self.activity_trackers
            .lock()
            .unwrap()
            .get(id)
            .map(|t| t.lock().unwrap().get_buckets())
            .unwrap_or_default()
    }

    pub fn get_preview(&self, id: &str) -> Vec<String> {
        self.preview_lines
            .lock()
            .unwrap()
            .get(id)
            .map(|pv| {
                let buf = pv.lock().unwrap();
                // Return last 5 lines from the buffer
                buf.iter().rev().take(5).rev().cloned().collect()
            })
            .unwrap_or_default()
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
        self.preview_lines.lock().unwrap().remove(id);
        self.activity_trackers.lock().unwrap().remove(id);
        Ok(())
    }

    pub fn restart(
        &self,
        id: &str,
        session_type: &SessionType,
        cwd: &str,
        skip_permissions: bool,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        self.kill(id)?;

        // Split command on whitespace to support multi-word commands
        let parts: Vec<&str> = session_type.command.split_whitespace().collect();
        let mut cmd = CommandBuilder::new(parts.first().unwrap_or(&""));
        for part in parts.iter().skip(1) {
            cmd.arg(part);
        }

        // Claude-specific: use --continue on restart
        if session_type.id == "claude-code" {
            cmd.arg("--continue");
            if skip_permissions {
                cmd.arg("--dangerously-skip-permissions");
            }
        }

        // Add session type's default args
        for arg in &session_type.args {
            cmd.arg(arg);
        }

        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", "en_US.UTF-8");

        for (key, val) in &session_type.env {
            cmd.env(key, val);
        }

        let patterns = if session_type.status_patterns.is_empty() {
            None
        } else {
            Some(&session_type.status_patterns)
        };

        self.spawn_inner(id, cmd, rows, cols, app_handle, patterns)
    }
}
