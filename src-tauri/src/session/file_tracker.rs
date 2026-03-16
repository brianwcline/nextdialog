use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct FileConflict {
    pub session_ids: Vec<String>,
    pub files: Vec<String>,
}

pub struct FileTracker {
    /// session_id → set of modified files
    modified_files: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    /// session_id → working_directory
    session_dirs: Arc<Mutex<HashMap<String, String>>>,
}

impl FileTracker {
    pub fn new() -> Self {
        Self {
            modified_files: Arc::new(Mutex::new(HashMap::new())),
            session_dirs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register_session(&self, id: &str, working_directory: &str) {
        self.session_dirs
            .lock()
            .unwrap()
            .insert(id.to_string(), working_directory.to_string());
    }

    pub fn unregister_session(&self, id: &str) {
        self.session_dirs.lock().unwrap().remove(id);
        self.modified_files.lock().unwrap().remove(id);
    }

    /// Record a file write from a hook event (real-time, augments git polling).
    pub fn record_write(&self, session_id: &str, file_path: &str) {
        self.modified_files
            .lock()
            .unwrap()
            .entry(session_id.to_string())
            .or_default()
            .insert(file_path.to_string());
    }

    pub fn get_conflicts(&self) -> Vec<FileConflict> {
        let files_map = self.modified_files.lock().unwrap();
        let mut file_to_sessions: HashMap<&String, Vec<String>> = HashMap::new();

        for (session_id, files) in files_map.iter() {
            for file in files {
                file_to_sessions
                    .entry(file)
                    .or_default()
                    .push(session_id.clone());
            }
        }

        // Group overlapping sessions
        let mut conflicts: HashMap<Vec<String>, Vec<String>> = HashMap::new();
        for (file, mut session_ids) in file_to_sessions {
            if session_ids.len() < 2 {
                continue;
            }
            session_ids.sort();
            conflicts
                .entry(session_ids)
                .or_default()
                .push(file.clone());
        }

        conflicts
            .into_iter()
            .map(|(session_ids, files)| FileConflict { session_ids, files })
            .collect()
    }

    pub fn start_polling(&self, app_handle: AppHandle) {
        let dirs = self.session_dirs.clone();
        let files = self.modified_files.clone();

        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(10));

            let sessions: Vec<(String, String)> = {
                dirs.lock()
                    .unwrap()
                    .iter()
                    .map(|(id, dir)| (id.clone(), dir.clone()))
                    .collect()
            };

            for (session_id, cwd) in &sessions {
                if let Ok(output) = Command::new("git")
                    .args(["diff", "--name-only", "HEAD"])
                    .current_dir(cwd)
                    .output()
                {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let modified: HashSet<String> = stdout
                            .lines()
                            .filter(|l| !l.is_empty())
                            .map(|l| format!("{cwd}/{l}"))
                            .collect();

                        files
                            .lock()
                            .unwrap()
                            .insert(session_id.clone(), modified);
                    }
                }
            }

            // Check for conflicts and emit events
            let files_map = files.lock().unwrap();
            let mut file_to_sessions: HashMap<&String, Vec<String>> = HashMap::new();
            for (session_id, session_files) in files_map.iter() {
                for file in session_files {
                    file_to_sessions
                        .entry(file)
                        .or_default()
                        .push(session_id.clone());
                }
            }

            let has_conflicts = file_to_sessions.values().any(|s| s.len() > 1);
            if has_conflicts {
                let _ = app_handle.emit("session-file-conflicts", ());
            }
        });
    }
}
