use regex::Regex;
use tauri::{AppHandle, Emitter, Manager};

use super::payloads::{HookEvent, HookPayload};
use crate::session::file_tracker::FileTracker;
use crate::status::detector::HookStatus;

/// Process a parsed hook payload and emit appropriate Tauri events.
pub fn process(session_id: &str, payload: HookPayload, app_handle: &AppHandle) {
    match payload.event() {
        HookEvent::PostToolUse => process_tool_use(session_id, &payload, app_handle),
        HookEvent::Stop => {
            let _ = app_handle.emit(
                &format!("session-status-{session_id}"),
                "idle",
            );
            // Signal the detector that hooks confirmed idle
            if let Some(pool) = app_handle.try_state::<crate::pty::pool::PtyPool>() {
                pool.set_hook_status(session_id, HookStatus::Idle);
            }
        }
        HookEvent::Notification => {
            // Emit waiting status immediately (faster than regex detection)
            let _ = app_handle.emit(
                &format!("session-status-{session_id}"),
                "waiting",
            );
            if let Some(pool) = app_handle.try_state::<crate::pty::pool::PtyPool>() {
                pool.set_hook_status(session_id, HookStatus::Waiting);
            }
            // Emit notification text for card display
            if let Some(ref msg) = payload.message {
                let _ = app_handle.emit(
                    &format!("session-hook-notification-{session_id}"),
                    msg.clone(),
                );
            }
        }
        HookEvent::SessionStart => {
            let _ = app_handle.emit(
                &format!("session-hook-lifecycle-{session_id}"),
                "started",
            );
        }
        HookEvent::SessionEnd => {
            let _ = app_handle.emit(
                &format!("session-hook-lifecycle-{session_id}"),
                "ended",
            );
        }
        HookEvent::PostCompact => {
            // Log for debugging; payload fields not fully documented
            if let (Some(before), Some(after)) = (payload.tokens_before, payload.tokens_after) {
                eprintln!(
                    "[hooks] PostCompact session={session_id}: {before} -> {after} tokens"
                );
            }
        }
        HookEvent::Unknown(ref name) => {
            eprintln!("[hooks] Unknown hook event for session {session_id}: {name}");
        }
    }
}

fn process_tool_use(session_id: &str, payload: &HookPayload, app_handle: &AppHandle) {
    let tool = payload.tool_name.as_deref().unwrap_or("");

    match tool {
        "Write" | "Edit" | "NotebookEdit" => {
            if let Some(path) = payload.file_path() {
                // Instant file conflict detection via hook (augments 10s git polling)
                if let Some(tracker) = app_handle.try_state::<FileTracker>() {
                    tracker.record_write(session_id, &path);
                }
                let _ = app_handle.emit(
                    &format!("session-hook-file-write-{session_id}"),
                    &path,
                );
            }
        }
        "Bash" => {
            if let Some(cmd) = payload.bash_command() {
                let activity = classify_bash(&cmd);
                let _ = app_handle.emit(
                    &format!("session-hook-bash-{session_id}"),
                    serde_json::json!({
                        "command": cmd,
                        "activity": activity,
                    }),
                );
            }
        }
        _ => {
            // Emit generic tool use event
            let _ = app_handle.emit(
                &format!("session-hook-tool-{session_id}"),
                tool,
            );
        }
    }
}

/// Classify a bash command into an activity category.
fn classify_bash(cmd: &str) -> &'static str {
    // Use lazy_static-style approach with thread_local for compiled regexes
    thread_local! {
        static TEST_RE: Regex = Regex::new(r"(?i)\b(test|spec|jest|pytest|cargo\s+test|npm\s+test|vitest)\b").unwrap();
        static BUILD_RE: Regex = Regex::new(r"(?i)\b(build|compile|cargo\s+build|npm\s+run\s+build|tsc|webpack|vite\s+build)\b").unwrap();
        static DEPLOY_RE: Regex = Regex::new(r"(?i)\b(deploy|push|publish|release)\b").unwrap();
        static LINT_RE: Regex = Regex::new(r"(?i)\b(lint|clippy|eslint|prettier|fmt)\b").unwrap();
    }

    if TEST_RE.with(|re| re.is_match(cmd)) {
        "test"
    } else if BUILD_RE.with(|re| re.is_match(cmd)) {
        "build"
    } else if DEPLOY_RE.with(|re| re.is_match(cmd)) {
        "deploy"
    } else if LINT_RE.with(|re| re.is_match(cmd)) {
        "lint"
    } else {
        "command"
    }
}
