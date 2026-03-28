use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};

use crate::intelligence::IntelligenceManager;
use crate::pty::activity::ActivityTracker;
use crate::settings::SettingsManager;
use crate::session::types::SessionType;
use crate::status::detector::{HookStatus, SessionStatus, StatusDetector};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[allow(clippy::type_complexity)]
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
        let preview_map = self.preview_lines.clone();
        let handle = app_handle.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(500));
            let map = detectors.lock().unwrap();
            for (id, detector) in map.iter() {
                if let Some(SessionStatus::Idle) = detector.lock().unwrap().check_silence(2.0) {
                    let _ = handle.emit(&format!("session-status-{id}"), "idle");

                    // Request intelligence annotation
                    if let Some(preview_arc) = preview_map.lock().unwrap().get(id) {
                        let lines: Vec<String> = {
                            let buf = preview_arc.lock().unwrap();
                            buf.iter().rev().take(5).rev().cloned().collect()
                        };
                        if !lines.is_empty() {
                            let intelligence = handle.state::<IntelligenceManager>();
                            let settings_mgr = handle.state::<SettingsManager>();
                            intelligence.request_annotation(id, lines, settings_mgr.inner(), &handle);
                        }
                    }
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

                                // Clear intelligence annotation when working
                                if new_status == SessionStatus::Working {
                                    let intelligence = handle.state::<IntelligenceManager>();
                                    intelligence.clear_annotation(&session_id);
                                }

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
                            // Split on \n, then handle \r within each line
                            // (terminals use \r to overwrite — keep only text after last \r)
                            for line in text.split('\n') {
                                // Handle carriage returns: keep only the last segment
                                let line = if line.contains('\r') {
                                    line.rsplit('\r').next().unwrap_or(line)
                                } else {
                                    line
                                };
                                // Strip remaining control characters
                                let cleaned: String = line.chars()
                                    .filter(|c| !c.is_control() || *c == ' ')
                                    .collect();
                                let trimmed = cleaned.trim();
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
                                // Skip Claude Code status bar / UI chrome lines
                                if trimmed.starts_with("connected |")
                                    || (trimmed.starts_with("agent ")
                                        && trimmed.contains("| session ")
                                        && trimmed.contains("| tokens "))
                                {
                                    continue;
                                }
                                // Skip Claude Code spinner/progress lines
                                if is_claude_spinner_line(trimmed) {
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

                                // Detect user input prompts (❯ or › followed by text)
                                let prompt_text = detect_user_prompt(capped);
                                if let Some(input) = prompt_text {
                                    if let Some(ledger) = handle.try_state::<crate::timeline::ledger::TimelineLedger>() {
                                        let entry = crate::timeline::ledger::TimelineEntry::new(
                                            "user_input",
                                            &input,
                                        );
                                        ledger.append(&session_id, &entry);
                                        let _ = handle.emit(
                                            &format!("session-timeline-{session_id}"),
                                            &entry,
                                        );
                                    }
                                }
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
                            "error",
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

    #[allow(clippy::too_many_arguments)]
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
            // permission_mode takes precedence over skip_permissions
            if session_type.agent_config.permission_mode.is_none() && skip_permissions {
                cmd.arg("--dangerously-skip-permissions");
            }
            if let Some(prompt) = initial_prompt {
                if !prompt.is_empty() {
                    cmd.arg("--prompt");
                    cmd.arg(prompt);
                }
            }
        }

        // Apply per-type agent configuration
        apply_agent_config(&mut cmd, session_type);

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

    /// Set hook-confirmed status on a session's detector.
    pub fn set_hook_status(&self, id: &str, status: HookStatus) {
        if let Some(detector) = self.detectors.lock().unwrap().get(id) {
            detector.lock().unwrap().set_hook_status(status);
        }
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

    #[allow(clippy::too_many_arguments)]
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
            if session_type.agent_config.permission_mode.is_none() && skip_permissions {
                cmd.arg("--dangerously-skip-permissions");
            }
        }

        // Add session type's default args
        for arg in &session_type.args {
            cmd.arg(arg);
        }

        // Apply per-type agent configuration
        apply_agent_config(&mut cmd, session_type);

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

/// Detect user input at the Claude Code prompt.
/// Claude Code shows user input as "❯ text" or "› text" or "> text" after submission.
fn detect_user_prompt(line: &str) -> Option<String> {
    let trimmed = line.trim();

    // Match Claude Code prompt patterns: ❯, ›, or >  followed by user text
    let text = if let Some(rest) = trimmed.strip_prefix('❯') {
        Some(rest.trim())
    } else if let Some(rest) = trimmed.strip_prefix('›') {
        Some(rest.trim())
    } else if let Some(rest) = trimmed.strip_prefix("> ") {
        // Only "> " with space to avoid matching markdown blockquotes
        Some(rest.trim())
    } else {
        None
    };

    match text {
        Some(t) if t.len() >= 5 => {
            // Cap at 200 chars
            let capped = if t.len() > 200 { &t[..200] } else { t };
            Some(capped.to_string())
        }
        _ => None,
    }
}

/// Detect Claude Code animated spinner/progress/status lines that pollute preview.
fn is_claude_spinner_line(line: &str) -> bool {
    // Claude Code uses cooking-themed verbs as spinners: "Sautéed for 1m 30s", "Hashing…"
    // Also status mode lines: "plan mode on", "bypass permissions on"
    let lower = line.to_lowercase();

    // Spinner verbs (Claude Code's animated status)
    if lower.ends_with('…')
        || lower.ends_with("...")
    {
        // "Hashing…", "Pontificating…", "Catapulting…", "Cooking…"
        let word_count = line.split_whitespace().count();
        if word_count <= 3 {
            return true;
        }
    }

    // Duration lines: "Sautéed for 1m 30s", "Cooked for 2m 10s"
    if (lower.contains(" for ") && (lower.contains("m ") || lower.contains("s")))
        && lower.split_whitespace().count() <= 5
    {
        let has_duration = lower.chars().any(|c| c.is_ascii_digit());
        if has_duration {
            return true;
        }
    }

    // Mode indicator lines
    if lower.starts_with("plan mode")
        || lower.starts_with("bypass permissions")
        || lower.starts_with("auto-accept")
        || lower.contains("shift+tab to cycle")
        || lower.contains("esc to interrupt")
        || lower.contains("esc to cancel")
        || lower.contains("ctrl+o to expand")
        || lower.contains("Image in clipboard")
    {
        return true;
    }

    false
}

/// Translate AgentConfig fields into CLI arguments and env vars on the command.
fn apply_agent_config(cmd: &mut CommandBuilder, session_type: &SessionType) {
    let config = &session_type.agent_config;

    if session_type.id == "claude-code" {
        if let Some(mode) = &config.permission_mode {
            cmd.arg("--permission-mode");
            cmd.arg(mode);
        }
        for tool in &config.allowed_tools {
            cmd.arg("--allowedTools");
            cmd.arg(tool);
        }
        for tool in &config.disallowed_tools {
            cmd.arg("--disallowedTools");
            cmd.arg(tool);
        }
        if let Some(model) = &config.model {
            cmd.arg("--model");
            cmd.arg(model);
        }
        if let Some(mcp) = &config.mcp_config_path {
            cmd.arg("--mcp-config");
            cmd.arg(mcp);
        }
        if let Some(prompt) = &config.append_system_prompt {
            cmd.arg("--append-system-prompt");
            cmd.arg(prompt);
        }
        if let Some(turns) = config.max_turns {
            cmd.arg("--max-turns");
            cmd.arg(turns.to_string());
        }
        if config.verbose {
            cmd.arg("--verbose");
        }
        match config.chrome_enabled {
            Some(true) => { cmd.arg("--chrome"); }
            Some(false) => { cmd.arg("--no-chrome"); }
            None => {}
        }
        for dir in &config.additional_dirs {
            cmd.arg("--add-dir");
            cmd.arg(dir);
        }
    }

    // Generic: custom args (works for any agent type)
    for arg in &config.custom_args {
        cmd.arg(arg);
    }

    // Generic: custom env vars
    for (key, val) in &config.custom_env {
        cmd.env(key, val);
    }
}
