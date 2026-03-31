mod agents;
mod clipboard;
mod commands;
mod hooks;
mod pty;
mod session;
mod settings;
mod intelligence;
mod status;
mod telemetry;
mod timeline;

use tauri::Manager;

use hooks::manager::HookManager;
use pty::pool::PtyPool;
use session::file_tracker::FileTracker;
use session::manager::SessionManager;
use session::types::SessionTypeManager;
use intelligence::IntelligenceManager;
use settings::SettingsManager;
use telemetry::TelemetryClient;
use timeline::ledger::TimelineLedger;

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
        .manage(HookManager::new())
        .manage(telemetry_client)
        .manage(TimelineLedger::new())
        .setup(|app| {
            // Clean stale hooks from any previous crash/force-quit
            let sessions = app.state::<SessionManager>();
            let dirs: Vec<String> = sessions
                .list()
                .iter()
                .filter(|s| s.session_type == "claude-code")
                .map(|s| s.working_directory.clone())
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .collect();
            if !dirs.is_empty() {
                HookManager::cleanup_stale_hooks(&dirs);
            }

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
            commands::get_hook_status,
            commands::check_binary_available,
            commands::import_background_image,
            commands::reset_background,
            commands::get_background_image_data,
            commands::get_timeline_entries,
            commands::catch_me_up,
            commands::update_session_tuning,
            commands::get_session_tuning,
            commands::install_tuning_files,
            commands::uninstall_tuning_file,
            commands::uninstall_all_tuning_files,
            commands::get_tuning_install_status,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let hook_manager = window.state::<HookManager>();
                hook_manager.teardown_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
