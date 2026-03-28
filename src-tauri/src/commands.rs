use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use tauri::{AppHandle, Emitter, State};

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
use crate::timeline::ledger::{TimelineEntry, TimelineLedger};

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
    ledger: State<'_, TimelineLedger>,
    id: String,
) -> Result<(), String> {
    hook_manager.teardown_session(&id);
    ledger.clear(&id);
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

    // Signal frontend to clear the terminal buffer before new PTY output arrives
    let _ = app_handle.emit(&format!("pty-restart-{id}"), ());

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

// ── Background Image ──

#[tauri::command]
pub fn import_background_image(
    settings_manager: State<'_, SettingsManager>,
    source_path: String,
) -> Result<String, String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("File does not exist".to_string());
    }

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return Err("Unsupported image format. Use jpg, png, or webp.".to_string());
    }

    let bg_dir = dirs::home_dir()
        .ok_or("Could not determine home directory")?
        .join(".nextdialog")
        .join("backgrounds");

    fs::create_dir_all(&bg_dir).map_err(|e| format!("Failed to create backgrounds dir: {e}"))?;

    // Delete previous background image if one exists
    let current_settings = settings_manager.get();
    if !current_settings.background_image_path.is_empty() {
        let old_path = bg_dir.join(&current_settings.background_image_path);
        let _ = fs::remove_file(old_path);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = format!("background_{timestamp}.{ext}");
    let dest = bg_dir.join(&filename);

    fs::copy(source, &dest).map_err(|e| format!("Failed to copy image: {e}"))?;

    let mut settings = current_settings;
    settings.background_mode = "image".to_string();
    settings.background_image_path = filename;
    settings_manager.save(settings);

    // Return as data URL so the frontend can display immediately
    let data = fs::read(&dest).map_err(|e| format!("Failed to read copied image: {e}"))?;
    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    Ok(format!("data:{};base64,{}", mime, BASE64.encode(&data)))
}

#[tauri::command]
pub fn reset_background(settings_manager: State<'_, SettingsManager>) {
    let mut settings = settings_manager.get();
    settings.background_mode = "gradient".to_string();
    settings.background_image_path = String::new();
    settings_manager.save(settings);
}

#[tauri::command]
pub fn get_background_image_data(
    settings_manager: State<'_, SettingsManager>,
) -> Option<String> {
    let settings = settings_manager.get();
    if settings.background_mode != "image" || settings.background_image_path.is_empty() {
        return None;
    }
    let path = dirs::home_dir()?
        .join(".nextdialog")
        .join("backgrounds")
        .join(&settings.background_image_path);
    if !path.exists() {
        return None;
    }
    let data = fs::read(&path).ok()?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpeg")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    Some(format!("data:{};base64,{}", mime, BASE64.encode(&data)))
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

// ── Binary Availability ──

#[tauri::command]
pub fn check_binary_available(command: String) -> bool {
    // Extract just the binary name (first word) from multi-word commands like "openclaw tui"
    let binary = command.split_whitespace().next().unwrap_or(&command);
    std::process::Command::new("which")
        .arg(binary)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── Intelligence ──

#[tauri::command]
pub fn get_session_annotation(
    intelligence: State<'_, IntelligenceManager>,
    id: String,
) -> Option<String> {
    intelligence.get_annotation(&id)
}

// ── Timeline ──

#[tauri::command]
pub fn get_timeline_entries(
    ledger: State<'_, TimelineLedger>,
    id: String,
    count: Option<usize>,
) -> Vec<TimelineEntry> {
    ledger.read_last(&id, count.unwrap_or(50))
}

#[tauri::command]
pub fn catch_me_up(
    ledger: State<'_, TimelineLedger>,
    intelligence: State<'_, IntelligenceManager>,
    settings_manager: State<'_, SettingsManager>,
    id: String,
) -> Result<String, String> {
    let entries = ledger.read_last(&id, 20);
    if entries.is_empty() {
        return Ok("No activity recorded yet for this session.".to_string());
    }

    let entries_text = entries
        .iter()
        .map(|e| {
            let time = e.timestamp.split('T').next_back().unwrap_or(&e.timestamp);
            let time_short = &time[..std::cmp::min(8, time.len())];
            format!("[{}] {}", time_short, e.summary)
        })
        .collect::<Vec<_>>()
        .join("\n");

    intelligence.summarize_sync(&settings_manager, &entries_text)
}
