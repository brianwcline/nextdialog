mod clipboard;
mod commands;
mod pty;
mod session;
mod settings;
mod intelligence;
mod status;
mod telemetry;

use tauri::Manager;

use pty::pool::PtyPool;
use session::file_tracker::FileTracker;
use session::manager::SessionManager;
use session::types::SessionTypeManager;
use intelligence::IntelligenceManager;
use settings::SettingsManager;
use telemetry::TelemetryClient;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let file_tracker = FileTracker::new();
    let settings_manager = SettingsManager::new();
    let machine_id = settings_manager.get().machine_id.clone();
    let telemetry_client = TelemetryClient::new(machine_id);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(SessionManager::new())
        .manage(PtyPool::new())
        .manage(settings_manager)
        .manage(SessionTypeManager::new())
        .manage(file_tracker)
        .manage(IntelligenceManager::new())
        .manage(telemetry_client)
        .setup(|app| {
            let tracker = app.state::<FileTracker>();
            tracker.start_polling(app.handle().clone());

            // Spawn background telemetry flush thread (every 30s)
            let telemetry_clone = app.state::<TelemetryClient>().inner().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                let _ = telemetry_clone.flush();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::create_session,
            commands::remove_session,
            commands::create_companion,
            commands::spawn_pty_session,
            commands::write_to_pty,
            commands::resize_pty,
            commands::kill_pty_session,
            commands::restart_pty_session,
            commands::check_and_paste_clipboard_image,
            commands::get_settings,
            commands::save_settings,
            commands::get_session_preview,
            commands::get_session_activity,
            commands::park_session,
            commands::unpark_session,
            commands::get_file_conflicts,
            commands::list_session_types,
            commands::create_session_type,
            commands::update_session_type,
            commands::delete_session_type,
            commands::get_session_annotation,
            commands::get_resolved_path,
            commands::submit_feedback,
            commands::track_event,
            commands::flush_telemetry,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
