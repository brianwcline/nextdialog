use regex::Regex;
use tauri::{AppHandle, Emitter, Manager};

use super::payloads::{HookEvent, HookPayload};
use crate::session::file_tracker::FileTracker;
use crate::status::detector::HookStatus;
use crate::timeline::ledger::{TimelineEntry, TimelineLedger};

/// Process a parsed hook payload and emit appropriate Tauri events.
pub fn process(session_id: &str, payload: HookPayload, app_handle: &AppHandle) {
    let timeline_entry = match payload.event() {
        HookEvent::PostToolUse => process_tool_use(session_id, &payload, app_handle),
        HookEvent::Stop => {
            let _ = app_handle.emit(
                &format!("session-status-{session_id}"),
                "idle",
            );
            // Capture terminal preview lines for a meaningful summary
            let summary = if let Some(pool) = app_handle.try_state::<crate::pty::pool::PtyPool>() {
                pool.set_hook_status(session_id, HookStatus::Idle);
                let lines = pool.get_preview(session_id);
                if lines.is_empty() {
                    "Went idle".to_string()
                } else {
                    // Take last 2-3 lines — the most recent context
                    let recent: Vec<&str> = lines.iter()
                        .rev()
                        .take(3)
                        .rev()
                        .map(|s| s.as_str())
                        .collect();
                    let text: String = recent.join(" — ")
                        .chars()
                        .take(200)
                        .collect();
                    if text.is_empty() { "Went idle".to_string() } else { text }
                }
            } else {
                "Went idle".to_string()
            };
            Some(
                TimelineEntry::new("status", &summary)
                    .with_details(serde_json::json!({"source": "preview_lines"})),
            )
        }
        HookEvent::Notification => {
            let _ = app_handle.emit(
                &format!("session-status-{session_id}"),
                "waiting",
            );
            if let Some(pool) = app_handle.try_state::<crate::pty::pool::PtyPool>() {
                pool.set_hook_status(session_id, HookStatus::Waiting);
            }
            if let Some(ref msg) = payload.message {
                let _ = app_handle.emit(
                    &format!("session-hook-notification-{session_id}"),
                    msg.clone(),
                );
            }
            let summary = payload
                .message
                .as_deref()
                .map(|m| if m.len() > 80 { &m[..80] } else { m })
                .unwrap_or("Waiting for input")
                .to_string();
            Some(TimelineEntry::new("notification", &summary))
        }
        HookEvent::SessionStart => {
            let _ = app_handle.emit(
                &format!("session-hook-lifecycle-{session_id}"),
                "started",
            );
            Some(TimelineEntry::new("lifecycle", "Session started"))
        }
        HookEvent::SessionEnd => {
            let _ = app_handle.emit(
                &format!("session-hook-lifecycle-{session_id}"),
                "ended",
            );
            Some(TimelineEntry::new("lifecycle", "Session ended"))
        }
        HookEvent::PostCompact => {
            if let (Some(before), Some(after)) = (payload.tokens_before, payload.tokens_after) {
                eprintln!(
                    "[hooks] PostCompact session={session_id}: {before} -> {after} tokens"
                );
                Some(
                    TimelineEntry::new(
                        "compact",
                        &format!("Context compacted: {before} → {after} tokens"),
                    )
                    .with_details(serde_json::json!({
                        "tokens_before": before,
                        "tokens_after": after,
                    })),
                )
            } else {
                None
            }
        }
        HookEvent::Unknown(ref name) => {
            eprintln!("[hooks] Unknown hook event for session {session_id}: {name}");
            None
        }
    };

    // Persist to timeline ledger and emit real-time event
    if let Some(entry) = timeline_entry {
        if let Some(ledger) = app_handle.try_state::<TimelineLedger>() {
            ledger.append(session_id, &entry);
            let _ = app_handle.emit(
                &format!("session-timeline-{session_id}"),
                &entry,
            );
        }
    }
}

fn process_tool_use(
    session_id: &str,
    payload: &HookPayload,
    app_handle: &AppHandle,
) -> Option<TimelineEntry> {
    let tool = payload.tool_name.as_deref().unwrap_or("");

    match tool {
        "Write" | "Edit" | "NotebookEdit" => {
            if let Some(path) = payload.file_path() {
                if let Some(tracker) = app_handle.try_state::<FileTracker>() {
                    tracker.record_write(session_id, &path);
                }
                let _ = app_handle.emit(
                    &format!("session-hook-file-write-{session_id}"),
                    &path,
                );
                let basename = std::path::Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&path);
                Some(
                    TimelineEntry::new("file_write", &format!("Edited {basename}"))
                        .with_details(serde_json::json!({"path": path})),
                )
            } else {
                None
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
                let summary = match activity {
                    "test" => format!("Ran tests: {}", truncate_cmd(&cmd, 40)),
                    "build" => format!("Built: {}", truncate_cmd(&cmd, 40)),
                    "deploy" => format!("Deployed: {}", truncate_cmd(&cmd, 40)),
                    "lint" => format!("Lint: {}", truncate_cmd(&cmd, 40)),
                    _ => format!("$ {}", truncate_cmd(&cmd, 50)),
                };
                Some(
                    TimelineEntry::new("bash", &summary)
                        .with_details(serde_json::json!({
                            "command": cmd,
                            "activity": activity,
                        })),
                )
            } else {
                None
            }
        }
        _ => {
            let _ = app_handle.emit(
                &format!("session-hook-tool-{session_id}"),
                tool,
            );
            // Skip noisy internal tools that don't add context
            if matches!(tool, "ToolSearch" | "TaskCreate" | "TaskUpdate" | "TaskGet" | "TaskList" | "TaskStop" | "TaskOutput") {
                None
            } else if !tool.is_empty() {
                let summary = describe_tool(tool, payload.tool_input.as_ref(), session_id, app_handle);
                Some(
                    TimelineEntry::new("tool", &summary)
                        .with_details(serde_json::json!({"tool": tool})),
                )
            } else {
                None
            }
        }
    }
}

/// Generate a descriptive summary for a tool use based on tool_input data.
fn describe_tool(
    tool: &str,
    input: Option<&serde_json::Value>,
    session_id: &str,
    app_handle: &AppHandle,
) -> String {
    let input = match input {
        Some(v) => v,
        None => return format!("Used {tool}"),
    };

    match tool {
        "Read" => {
            let path = input
                .get("file_path")
                .or_else(|| input.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if path.is_empty() {
                "Read file".to_string()
            } else {
                let basename = std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path);
                format!("Read {basename}")
            }
        }
        "Grep" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            if pattern.is_empty() {
                "Searched code".to_string()
            } else {
                format!("Searched for '{}'", truncate_str(pattern, 30))
            }
        }
        "Glob" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            if pattern.is_empty() {
                "Found files".to_string()
            } else {
                format!("Found files: {}", truncate_str(pattern, 30))
            }
        }
        "Agent" => {
            let desc = input
                .get("description")
                .and_then(|v| v.as_str())
                .or_else(|| input.get("prompt").and_then(|v| v.as_str()))
                .unwrap_or("");
            if desc.is_empty() {
                "Ran agent".to_string()
            } else {
                truncate_str(desc, 60).to_string()
            }
        }
        "EnterPlanMode" => "Entered planning mode".to_string(),
        "ExitPlanMode" => {
            // Try to read the terminal preview for plan context
            if let Some(pool) = app_handle.try_state::<crate::pty::pool::PtyPool>() {
                let lines = pool.get_preview(session_id);
                if !lines.is_empty() {
                    let context = lines.join(" ");
                    format!("Plan ready: {}", truncate_str(&context, 80))
                } else {
                    "Plan ready for review".to_string()
                }
            } else {
                "Plan ready for review".to_string()
            }
        }
        "WebSearch" => {
            let query = input.get("query").and_then(|v| v.as_str()).unwrap_or("");
            if query.is_empty() {
                "Web search".to_string()
            } else {
                format!("Searched web: {}", truncate_str(query, 40))
            }
        }
        "WebFetch" => {
            let url = input.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if url.is_empty() {
                "Fetched URL".to_string()
            } else {
                format!("Fetched {}", truncate_str(url, 40))
            }
        }
        "ToolSearch" => {
            let query = input.get("query").and_then(|v| v.as_str()).unwrap_or("");
            if query.is_empty() {
                "Loaded tools".to_string()
            } else {
                format!("Loaded: {}", truncate_str(query, 30))
            }
        }
        "Skill" => {
            let skill = input.get("skill").and_then(|v| v.as_str()).unwrap_or("");
            if skill.is_empty() {
                "Used skill".to_string()
            } else {
                format!("Ran /{skill}")
            }
        }
        "AskUserQuestion" => {
            // The user is being asked a question — capture what it's about
            if let Some(pool) = app_handle.try_state::<crate::pty::pool::PtyPool>() {
                let lines = pool.get_preview(session_id);
                if !lines.is_empty() {
                    let context = lines.last().unwrap_or(&lines[0]).clone();
                    format!("Asked: {}", truncate_str(&context, 60))
                } else {
                    "Asked a question".to_string()
                }
            } else {
                "Asked a question".to_string()
            }
        }
        _ => format!("Used {tool}"),
    }
}

/// Truncate a string to max length, appending "…" if truncated.
fn truncate_str(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        &s[..max]
    }
}

/// Truncate a command string, taking just the first meaningful portion.
fn truncate_cmd(cmd: &str, max: usize) -> String {
    // Take first line only
    let first_line = cmd.lines().next().unwrap_or(cmd);
    if first_line.len() <= max {
        first_line.to_string()
    } else {
        format!("{}…", &first_line[..max])
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
