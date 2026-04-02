use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager};

use crate::agents::{self, AgentAdapter};
use crate::intelligence::IntelligenceManager;
use crate::pty::activity::ActivityTracker;
use crate::settings::SettingsManager;
use crate::session::tuning::{self, SessionTuning};
use crate::session::types::SessionType;
use crate::status::detector::{HookStatus, SessionStatus, StatusDetector};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[allow(clippy::type_complexity)]
pub struct PtyPool {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    detectors: Arc<Mutex<HashMap<String, Arc<Mutex<StatusDetector>>>>>,
    adapters: Arc<Mutex<HashMap<String, Arc<Box<dyn AgentAdapter>>>>>,
    preview_lines: Arc<Mutex<HashMap<String, Arc<Mutex<VecDeque<String>>>>>>,
    activity_trackers: Arc<Mutex<HashMap<String, Arc<Mutex<ActivityTracker>>>>>,
    /// Startup commands queued until the agent signals ready
    command_queues: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    /// Muted sessions — reader thread suppresses all output (used during restart)
    muted: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    app_handle: Mutex<Option<AppHandle>>,
}

impl PtyPool {
    pub fn new() -> Self {
        let detectors: Arc<Mutex<HashMap<String, Arc<Mutex<StatusDetector>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            detectors,
            adapters: Arc::new(Mutex::new(HashMap::new())),
            preview_lines: Arc::new(Mutex::new(HashMap::new())),
            activity_trackers: Arc::new(Mutex::new(HashMap::new())),
            command_queues: Arc::new(Mutex::new(HashMap::new())),
            muted: Arc::new(Mutex::new(HashMap::new())),
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

                    // Flush startup command queue on first idle detection
                    let pool = handle.state::<PtyPool>();
                    pool.flush_command_queue(id);

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

    #[allow(clippy::too_many_arguments)]
    fn spawn_inner(
        &self,
        id: &str,
        cmd: CommandBuilder,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
        status_patterns: Option<&HashMap<String, String>>,
        adapter: Box<dyn AgentAdapter>,
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

        // Store adapter for this session (accessible by hook manager)
        let adapter = Arc::new(adapter);
        self.adapters
            .lock()
            .unwrap()
            .insert(id.to_string(), adapter.clone());

        // Create mute flag for this session (set during restart to suppress output)
        let muted = Arc::new(AtomicBool::new(false));
        self.muted
            .lock()
            .unwrap()
            .insert(id.to_string(), muted.clone());

        // Reader thread — OS thread, not tokio
        let session_id = id.to_string();
        let handle = app_handle.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            // Carry-over buffer for incomplete UTF-8 sequences split across reads
            let mut pending = Vec::new();
            // Track last detected prompt to debounce keystroke-by-keystroke TUI redraws
            let mut last_prompt: Option<String> = None;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // Don't emit exit events if muted (during restart)
                        if !muted.load(Ordering::Relaxed) {
                            let _ = handle.emit(&format!("pty-exit-{session_id}"), ());
                            let _ = handle.emit(
                                &format!("session-status-{session_id}"),
                                "stopped",
                            );
                        }
                        break;
                    }
                    Ok(n) => {
                        // Skip all processing if muted (during restart)
                        if muted.load(Ordering::Relaxed) {
                            continue;
                        }
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
                                // Skip agent-specific UI chrome/noise
                                if adapter.is_noise(trimmed) {
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

                                // Detect user input prompts via agent adapter.
                                // Debounce: TUI agents redraw the prompt line on each
                                // keystroke. Only emit when the new prompt is NOT a
                                // prefix of the previous one (meaning a new prompt, not
                                // the same one being typed character by character).
                                if let Some(input) = adapter.detect_prompt(capped) {
                                    let is_typing = last_prompt.as_ref().is_some_and(|prev| {
                                        prev.starts_with(&input) || input.starts_with(prev)
                                    });
                                    if is_typing {
                                        // Still typing — update the tracked prompt but don't emit
                                        last_prompt = Some(input);
                                    } else {
                                        // New prompt — emit the previous one (if any) and start tracking
                                        if let Some(prev) = last_prompt.take() {
                                            if let Some(ledger) = handle.try_state::<crate::timeline::ledger::TimelineLedger>() {
                                                let entry = crate::timeline::ledger::TimelineEntry::new(
                                                    "user_input",
                                                    &prev,
                                                );
                                                ledger.append(&session_id, &entry);
                                                let _ = handle.emit(
                                                    &format!("session-timeline-{session_id}"),
                                                    &entry,
                                                );
                                            }
                                        }
                                        last_prompt = Some(input);
                                    }
                                } else if let Some(prev) = last_prompt.take() {
                                    // Non-prompt line after a prompt — the user submitted.
                                    // Emit the final prompt text.
                                    if let Some(ledger) = handle.try_state::<crate::timeline::ledger::TimelineLedger>() {
                                        let entry = crate::timeline::ledger::TimelineEntry::new(
                                            "user_input",
                                            &prev,
                                        );
                                        ledger.append(&session_id, &entry);
                                        let _ = handle.emit(
                                            &format!("session-timeline-{session_id}"),
                                            &entry,
                                        );
                                    }
                                }

                                // Extract timeline entries from PTY output via adapter
                                let timeline_entries = adapter.extract_timeline(capped);
                                if !timeline_entries.is_empty() {
                                    if let Some(ledger) = handle.try_state::<crate::timeline::ledger::TimelineLedger>() {
                                        for entry in timeline_entries {
                                            ledger.append(&session_id, &entry);
                                            let _ = handle.emit(
                                                &format!("session-timeline-{session_id}"),
                                                &entry,
                                            );
                                        }
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
        tuning: Option<&SessionTuning>,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        // Resolve effective agent config (base + tuning overrides)
        let effective_config = match tuning {
            Some(t) => tuning::resolve_agent_config(&session_type.agent_config, &t.config_overrides),
            None => session_type.agent_config.clone(),
        };

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
            if effective_config.permission_mode.is_none() && skip_permissions {
                cmd.arg("--dangerously-skip-permissions");
            }
            if let Some(prompt) = initial_prompt {
                if !prompt.is_empty() {
                    cmd.arg("--prompt");
                    cmd.arg(prompt);
                }
            }
        }

        // Apply resolved agent configuration
        apply_agent_config(&mut cmd, &session_type.id, &effective_config);

        // Apply extra args and env vars from tuning overrides
        if let Some(t) = tuning {
            for arg in tuning::extra_args_from_overrides(&t.config_overrides) {
                cmd.arg(arg);
            }
            tuning::apply_env_overrides(&mut cmd, &t.config_overrides);
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

        // Queue startup commands if tuning specifies them
        if let Some(t) = tuning {
            self.queue_startup_commands(id, t.startup_commands.clone());
        }

        let adapter = agents::create_adapter(&session_type.id);
        self.spawn_inner(id, cmd, rows, cols, app_handle, patterns, adapter)
    }

    /// Get the adapter for a session (for use by hook manager).
    #[allow(dead_code)]
    pub fn get_adapter(&self, id: &str) -> Option<Arc<Box<dyn AgentAdapter>>> {
        self.adapters.lock().unwrap().get(id).cloned()
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

    /// Queue startup commands for a session. They'll be flushed when the agent signals ready.
    pub fn queue_startup_commands(&self, id: &str, commands: Vec<String>) {
        if commands.is_empty() {
            return;
        }
        let mut queues = self.command_queues.lock().unwrap();
        queues.insert(id.to_string(), VecDeque::from(commands));
    }

    /// Flush queued startup commands into the PTY. Called when agent signals ready
    /// (SessionStart hook for Claude Code, first idle for other agents).
    pub fn flush_command_queue(&self, id: &str) {
        let commands: Vec<String> = {
            let mut queues = self.command_queues.lock().unwrap();
            match queues.remove(id) {
                Some(q) => q.into_iter().collect(),
                None => return,
            }
        };

        if commands.is_empty() {
            return;
        }

        // Write each command with a small delay between them
        let session_id = id.to_string();
        let sessions = self.sessions.clone();
        std::thread::spawn(move || {
            for command in commands {
                // Small delay to let the agent process
                std::thread::sleep(Duration::from_millis(200));
                let mut sessions_guard = sessions.lock().unwrap();
                if let Some(session) = sessions_guard.get_mut(&session_id) {
                    let data = format!("{command}\n");
                    let _ = session.writer.write_all(data.as_bytes());
                    let _ = session.writer.flush();
                }
            }
        });
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
        self.adapters.lock().unwrap().remove(id);
        self.preview_lines.lock().unwrap().remove(id);
        self.activity_trackers.lock().unwrap().remove(id);
        self.command_queues.lock().unwrap().remove(id);
        self.muted.lock().unwrap().remove(id);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn restart(
        &self,
        id: &str,
        session_type: &SessionType,
        cwd: &str,
        skip_permissions: bool,
        tuning: Option<&SessionTuning>,
        rows: u16,
        cols: u16,
        app_handle: &AppHandle,
    ) -> Result<(), String> {
        // Mute the reader thread so it doesn't emit ^D/exit events from the dying session
        if let Some(flag) = self.muted.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        }

        self.kill(id)?;

        // Pause to let the frontend process pty-exit and clear the terminal
        // before new session output arrives
        std::thread::sleep(std::time::Duration::from_millis(250));

        // Resolve effective agent config
        let effective_config = match tuning {
            Some(t) => tuning::resolve_agent_config(&session_type.agent_config, &t.config_overrides),
            None => session_type.agent_config.clone(),
        };

        // Split command on whitespace to support multi-word commands
        let parts: Vec<&str> = session_type.command.split_whitespace().collect();
        let mut cmd = CommandBuilder::new(parts.first().unwrap_or(&""));
        for part in parts.iter().skip(1) {
            cmd.arg(part);
        }

        // Claude-specific: use --continue on restart UNLESS tuning changed
        // (--continue resumes the old session, ignoring new CLI args)
        if session_type.id == "claude-code" {
            if tuning.is_none() {
                cmd.arg("--continue");
            }
            if effective_config.permission_mode.is_none() && skip_permissions {
                cmd.arg("--dangerously-skip-permissions");
            }
        }

        // Add session type's default args
        for arg in &session_type.args {
            cmd.arg(arg);
        }

        // Apply resolved agent configuration
        apply_agent_config(&mut cmd, &session_type.id, &effective_config);

        // Apply extra args from tuning overrides
        if let Some(t) = tuning {
            for arg in tuning::extra_args_from_overrides(&t.config_overrides) {
                cmd.arg(arg);
            }
            tuning::apply_env_overrides(&mut cmd, &t.config_overrides);
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

        // Queue startup commands if tuning specifies them
        if let Some(t) = tuning {
            self.queue_startup_commands(id, t.startup_commands.clone());
        }

        let adapter = agents::create_adapter(&session_type.id);
        self.spawn_inner(id, cmd, rows, cols, app_handle, patterns, adapter)
    }
}

/// Translate AgentConfig fields into CLI arguments and env vars on the command.
fn apply_agent_config(cmd: &mut CommandBuilder, session_type_id: &str, config: &crate::session::types::AgentConfig) {
    if session_type_id == "claude-code" {
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
