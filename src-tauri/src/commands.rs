use tauri::{AppHandle, State};

use crate::clipboard::bridge::save_clipboard_image;
use crate::hooks::manager::HookManager;
use crate::pty::pool::PtyPool;
use crate::session::config::{CreateSessionRequest, SessionConfig};
use crate::session::file_tracker::{FileConflict, FileTracker};
use crate::session::manager::SessionManager;
use crate::session::types::{SessionType, SessionTypeManager};
use crate::intelligence::IntelligenceManager;
use crate::settings::{Settings, SettingsManager};
use crate::telemetry::TelemetryClient;

// ── Session CRUD ──

#[tauri::command]
pub fn list_sessions(manager: State<'_, SessionManager>) -> Vec<SessionConfig> {
    manager.list()
}

#[tauri::command]
pub fn create_session(
    manager: State<'_, SessionManager>,
    name: String,
    working_directory: String,
    skip_permissions: bool,
    initial_prompt: Option<String>,
    session_type: Option<String>,
) -> Result<SessionConfig, String> {
    manager.create(CreateSessionRequest {
        name,
        working_directory,
        skip_permissions,
        initial_prompt,
        session_type: session_type.unwrap_or_else(|| "claude-code".to_string()),
        parent_id: None,
    })
}

#[tauri::command]
pub fn remove_session(
    manager: State<'_, SessionManager>,
    hook_manager: State<'_, HookManager>,
    id: String,
) -> Result<(), String> {
    // Teardown hooks before removing — no-op if hooks aren't active
    hook_manager.teardown_session(&id);
    manager.remove(&id)
}

// ── Companion terminals ──

#[tauri::command]
pub fn create_companion(
    manager: State<'_, SessionManager>,
    parent_id: String,
    name: Option<String>,
) -> Result<SessionConfig, String> {
    let parent = manager
        .get(&parent_id)
        .ok_or_else(|| format!("Parent session not found: {parent_id}"))?;

    let companion_name = match name {
        Some(n) => n,
        None => {
            let count = manager.list_companions(&parent_id).len();
            format!("Terminal {}", count + 1)
        }
    };

    manager.create(CreateSessionRequest {
        name: companion_name,
        working_directory: parent.working_directory,
        skip_permissions: false,
        initial_prompt: None,
        session_type: "terminal".to_string(),
        parent_id: Some(parent_id),
    })
}

// ── PTY lifecycle ──

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn spawn_pty_session(
    pool: State<'_, PtyPool>,
    manager: State<'_, SessionManager>,
    type_manager: State<'_, SessionTypeManager>,
    file_tracker: State<'_, FileTracker>,
    hook_manager: State<'_, HookManager>,
    settings_manager: State<'_, SettingsManager>,
    app_handle: AppHandle,
    id: String,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let session = manager
        .get(&id)
        .ok_or_else(|| format!("Session not found: {id}"))?;

    let session_type = type_manager
        .get(&session.session_type)
        .unwrap_or_else(|| type_manager.get("claude-code").unwrap());

    // Set up hooks for Claude Code sessions (graceful degradation on failure)
    if session_type.id == "claude-code" && settings_manager.get().hooks_enabled {
        match hook_manager.setup_session(&id, &session.working_directory, &app_handle) {
            Ok(true) => {} // Hooks active
            Ok(false) => eprintln!("[hooks] Skipped for session {id} (no port or config error)"),
            Err(e) => eprintln!("[hooks] Setup failed for session {id}: {e}"),
        }
    }

    pool.spawn(
        &id,
        &session_type,
        &session.working_directory,
        session.skip_permissions,
        session.initial_prompt.as_deref(),
        rows.unwrap_or(24),
        cols.unwrap_or(80),
        &app_handle,
    )?;

    file_tracker.register_session(&id, &session.working_directory);
    manager.update_status(&id, "starting");
    Ok(())
}

#[tauri::command]
pub fn write_to_pty(pool: State<'_, PtyPool>, id: String, data: String) -> Result<(), String> {
    pool.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn resize_pty(
    pool: State<'_, PtyPool>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    pool.resize(&id, rows, cols)
}

#[tauri::command]
pub fn kill_pty_session(
    pool: State<'_, PtyPool>,
    manager: State<'_, SessionManager>,
    file_tracker: State<'_, FileTracker>,
    hook_manager: State<'_, HookManager>,
    id: String,
) -> Result<(), String> {
    pool.kill(&id)?;
    file_tracker.unregister_session(&id);
    hook_manager.teardown_session(&id);
    manager.update_status(&id, "stopped");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn restart_pty_session(
    pool: State<'_, PtyPool>,
    manager: State<'_, SessionManager>,
    type_manager: State<'_, SessionTypeManager>,
    hook_manager: State<'_, HookManager>,
    settings_manager: State<'_, SettingsManager>,
    app_handle: AppHandle,
    id: String,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let session = manager
        .get(&id)
        .ok_or_else(|| format!("Session not found: {id}"))?;

    let session_type = type_manager
        .get(&session.session_type)
        .unwrap_or_else(|| type_manager.get("claude-code").unwrap());

    // Teardown old hooks before restart
    hook_manager.teardown_session(&id);

    pool.restart(
        &id,
        &session_type,
        &session.working_directory,
        session.skip_permissions,
        rows.unwrap_or(24),
        cols.unwrap_or(80),
        &app_handle,
    )?;

    // Set up fresh hooks for the restarted session
    if session_type.id == "claude-code" && settings_manager.get().hooks_enabled {
        match hook_manager.setup_session(&id, &session.working_directory, &app_handle) {
            Ok(true) => {}
            Ok(false) => eprintln!("[hooks] Skipped for restarted session {id}"),
            Err(e) => eprintln!("[hooks] Setup failed for restarted session {id}: {e}"),
        }
    }

    manager.update_status(&id, "starting");
    Ok(())
}

// ── Preview ──

#[tauri::command]
pub fn get_session_preview(pool: State<'_, PtyPool>, id: String) -> Vec<String> {
    pool.get_preview(&id)
}

#[tauri::command]
pub fn get_session_activity(pool: State<'_, PtyPool>, id: String) -> Vec<u32> {
    pool.get_activity(&id)
}

// ── Clipboard ──

#[tauri::command]
pub fn check_and_paste_clipboard_image(
    pool: State<'_, PtyPool>,
    id: String,
) -> Result<bool, String> {
    match save_clipboard_image()? {
        Some(path) => {
            pool.write(&id, format!("{path}\n").as_bytes())?;
            Ok(true)
        }
        None => Ok(false),
    }
}

// ── Settings ──

#[tauri::command]
pub fn get_settings(manager: State<'_, SettingsManager>) -> Settings {
    manager.get()
}

#[tauri::command]
pub fn save_settings(manager: State<'_, SettingsManager>, settings: Settings) {
    manager.save(settings);
}

// ── Session Parking ──

#[tauri::command]
pub fn park_session(manager: State<'_, SessionManager>, id: String) {
    manager.set_parked(&id, true);
}

#[tauri::command]
pub fn unpark_session(manager: State<'_, SessionManager>, id: String) {
    manager.set_parked(&id, false);
}

// ── File Conflicts ──

#[tauri::command]
pub fn get_file_conflicts(tracker: State<'_, FileTracker>) -> Vec<FileConflict> {
    tracker.get_conflicts()
}

// ── Session Types ──

#[tauri::command]
pub fn list_session_types(manager: State<'_, SessionTypeManager>) -> Vec<SessionType> {
    manager.list()
}

#[tauri::command]
pub fn create_session_type(
    manager: State<'_, SessionTypeManager>,
    session_type: SessionType,
) -> Result<SessionType, String> {
    manager.create(session_type)
}

#[tauri::command]
pub fn update_session_type(
    manager: State<'_, SessionTypeManager>,
    session_type: SessionType,
) -> Result<SessionType, String> {
    manager.update(session_type)
}

#[tauri::command]
pub fn delete_session_type(
    manager: State<'_, SessionTypeManager>,
    id: String,
) -> Result<(), String> {
    manager.delete(&id)
}

// ── Telemetry ──

#[tauri::command]
pub fn submit_feedback(
    telemetry: State<'_, TelemetryClient>,
    text: String,
    severity: String,
    category: Option<String>,
    app_state: Option<serde_json::Value>,
) -> Result<(), String> {
    telemetry.submit_feedback(text, severity, category, app_state)
}

#[tauri::command]
pub fn track_event(
    telemetry: State<'_, TelemetryClient>,
    settings: State<'_, SettingsManager>,
    event_name: String,
    feature_id: String,
    properties: Option<serde_json::Value>,
    session_id: Option<String>,
    timestamp: Option<String>,
) -> Result<(), String> {
    if !settings.get().telemetry_enabled {
        return Ok(());
    }
    telemetry.queue_event(event_name, feature_id, properties, session_id, timestamp);
    Ok(())
}

#[tauri::command]
pub fn flush_telemetry(telemetry: State<'_, TelemetryClient>) -> Result<(), String> {
    telemetry.flush()
}

// ── Diagnostics ──

#[tauri::command]
pub fn get_resolved_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

// ── Hooks ──

#[tauri::command]
pub fn get_hook_status(
    hook_manager: State<'_, HookManager>,
    id: String,
) -> bool {
    hook_manager.is_active(&id)
}

// ── Intelligence ──

#[tauri::command]
pub fn get_session_annotation(
    intelligence: State<'_, IntelligenceManager>,
    id: String,
) -> Option<String> {
    intelligence.get_annotation(&id)
}
