use std::collections::HashMap;
use std::sync::Mutex;

use tauri::AppHandle;

use super::config;
use super::port_pool::PortPool;
use super::server::HookServer;

struct ActiveSession {
    server: HookServer,
    working_dir: String,
}

pub struct HookManager {
    port_pool: PortPool,
    active: Mutex<HashMap<String, ActiveSession>>,
}

impl HookManager {
    pub fn new() -> Self {
        Self {
            port_pool: PortPool::new(),
            active: Mutex::new(HashMap::new()),
        }
    }

    /// Set up hooks for a Claude Code session.
    /// Acquires a port, writes config, starts HTTP server.
    /// Returns Ok(true) if hooks were set up, Ok(false) if skipped.
    pub fn setup_session(
        &self,
        session_id: &str,
        working_dir: &str,
        app_handle: &AppHandle,
    ) -> Result<bool, String> {
        let port = match self.port_pool.acquire() {
            Some(p) => p,
            None => {
                eprintln!("[hooks] No available ports for session {session_id}");
                return Ok(false);
            }
        };

        // Write hook config into .claude/settings.local.json
        if let Err(e) = config::inject_hook_config(working_dir, port) {
            eprintln!("[hooks] Failed to inject config for session {session_id}: {e}");
            self.port_pool.release(port);
            return Ok(false);
        }

        // Start HTTP server
        match HookServer::start(port, session_id.to_string(), app_handle.clone()) {
            Ok(server) => {
                self.active.lock().unwrap().insert(
                    session_id.to_string(),
                    ActiveSession {
                        server,
                        working_dir: working_dir.to_string(),
                    },
                );
                eprintln!("[hooks] Session {session_id} hooks active on port {port}");
                Ok(true)
            }
            Err(e) => {
                eprintln!("[hooks] Failed to start server for session {session_id}: {e}");
                let _ = config::remove_hook_config(working_dir);
                self.port_pool.release(port);
                Ok(false)
            }
        }
    }

    /// Tear down hooks for a session.
    /// Stops server, removes config, releases port.
    pub fn teardown_session(&self, session_id: &str) {
        let removed = self.active.lock().unwrap().remove(session_id);
        if let Some(mut session) = removed {
            let port = session.server.port();
            session.server.stop_and_wait();
            if let Err(e) = config::remove_hook_config(&session.working_dir) {
                eprintln!("[hooks] Failed to clean config for session {session_id}: {e}");
            }
            self.port_pool.release(port);
            eprintln!("[hooks] Session {session_id} hooks torn down (port {port})");
        }
    }

    /// Clean stale hook configs from working directories (e.g., after crash).
    /// Runs against the filesystem only — no active servers to stop.
    pub fn cleanup_stale_hooks(working_dirs: &[String]) {
        for dir in working_dirs {
            match config::remove_hook_config(dir) {
                Ok(()) => eprintln!("[hooks] Cleaned stale hooks from {dir}"),
                Err(e) => eprintln!("[hooks] Failed to clean stale hooks from {dir}: {e}"),
            }
        }
    }

    /// Check if a session has hooks active.
    pub fn is_active(&self, session_id: &str) -> bool {
        self.active.lock().unwrap().contains_key(session_id)
    }

    /// Clean up all active sessions (e.g., on app shutdown).
    pub fn teardown_all(&self) {
        let session_ids: Vec<String> = self
            .active
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        for id in session_ids {
            self.teardown_session(&id);
        }
    }
}

impl Drop for HookManager {
    fn drop(&mut self) {
        self.teardown_all();
    }
}
