mod clipboard;
mod commands;
mod pty;
mod session;
mod settings;
mod status;

use pty::pool::PtyPool;
use session::manager::SessionManager;
use settings::SettingsManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SessionManager::new())
        .manage(PtyPool::new())
        .manage(SettingsManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::create_session,
            commands::remove_session,
            commands::spawn_pty_session,
            commands::write_to_pty,
            commands::resize_pty,
            commands::kill_pty_session,
            commands::restart_pty_session,
            commands::check_and_paste_clipboard_image,
            commands::get_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
