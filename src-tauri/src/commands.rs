use tauri::{AppHandle, State};

use crate::clipboard::bridge::save_clipboard_image;
use crate::pty::pool::PtyPool;
use crate::session::config::{CreateSessionRequest, SessionConfig};
use crate::session::manager::SessionManager;
use crate::settings::{Settings, SettingsManager};

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
) -> Result<SessionConfig, String> {
    manager.create(CreateSessionRequest {
        name,
        working_directory,
        skip_permissions,
        initial_prompt,
    })
}

#[tauri::command]
pub fn remove_session(manager: State<'_, SessionManager>, id: String) -> Result<(), String> {
    manager.remove(&id)
}

#[tauri::command]
pub fn spawn_pty_session(
    pool: State<'_, PtyPool>,
    manager: State<'_, SessionManager>,
    app_handle: AppHandle,
    id: String,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let session = manager
        .get(&id)
        .ok_or_else(|| format!("Session not found: {id}"))?;

    pool.spawn(
        &id,
        &session.working_directory,
        session.skip_permissions,
        session.initial_prompt.as_deref(),
        rows.unwrap_or(24),
        cols.unwrap_or(80),
        &app_handle,
    )?;

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
    id: String,
) -> Result<(), String> {
    pool.kill(&id)?;
    manager.update_status(&id, "stopped");
    Ok(())
}

#[tauri::command]
pub fn restart_pty_session(
    pool: State<'_, PtyPool>,
    manager: State<'_, SessionManager>,
    app_handle: AppHandle,
    id: String,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<(), String> {
    let session = manager
        .get(&id)
        .ok_or_else(|| format!("Session not found: {id}"))?;

    pool.restart(
        &id,
        &session.working_directory,
        session.skip_permissions,
        rows.unwrap_or(24),
        cols.unwrap_or(80),
        &app_handle,
    )?;

    manager.update_status(&id, "starting");
    Ok(())
}

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

#[tauri::command]
pub fn get_settings(manager: State<'_, SettingsManager>) -> Settings {
    manager.get()
}

#[tauri::command]
pub fn save_settings(manager: State<'_, SettingsManager>, settings: Settings) {
    manager.save(settings);
}
