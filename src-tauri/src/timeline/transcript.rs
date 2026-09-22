//! Backfill a fresh session's timeline from Claude Code's own transcripts (#16).
//!
//! A NextDialog session opened on a project that already has Claude Code
//! history otherwise shows an empty timeline. Claude Code keeps a JSONL
//! transcript per conversation under `<config>/projects/<sanitized cwd>/`;
//! we read the newest one and map its prompts and tool calls onto the same
//! entry types the hook processor writes. Read-only, local only.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::ledger::TimelineEntry;

/// `details.source` on every imported entry, so they can be told apart from
/// live hook events.
pub const TRANSCRIPT_SOURCE: &str = "claude_transcript";

/// Claude Code hashes sanitized paths longer than this; we don't replicate
/// the hash, so those projects are skipped.
const MAX_SANITIZED_LENGTH: usize = 200;

const PROMPT_PREVIEW_CHARS: usize = 200;
const COMMAND_PREVIEW_CHARS: usize = 50;

/// Internal bookkeeping tools that add no context (matches the hook processor).
const NOISY_TOOLS: &[&str] = &[
    "ToolSearch", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskStop", "TaskOutput",
    "TodoWrite",
];

/// Claude Code's transcript directory for a working directory.
pub fn project_transcript_dir(working_dir: &str) -> Option<PathBuf> {
    let config_dir = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".claude")))?;
    // Claude Code keys on the realpath (e.g. /tmp -> /private/tmp on macOS).
    let canonical = fs::canonicalize(working_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| working_dir.to_string());
    let sanitized = sanitize_path(&canonical);
    if sanitized.len() > MAX_SANITIZED_LENGTH {
        return None;
    }
    Some(config_dir.join("projects").join(sanitized))
}

/// Mirror of Claude Code's `sanitizePath`: every non-alphanumeric becomes `-`.
fn sanitize_path(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The most recently modified `*.jsonl` transcript in a project directory.
pub fn latest_transcript(dir: &Path) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|path| {
            let modified = fs::metadata(&path).and_then(|m| m.modified()).ok()?;
            Some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// Parse a transcript into timeline entries, keeping the newest `max_entries`.
/// Unreadable lines are skipped, matching how the ledger reads its own files.
pub fn read_transcript_entries(path: &Path, max_entries: usize) -> Vec<TimelineEntry> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[timeline] Could not open transcript for backfill: {e}");
            return Vec::new();
        }
    };

    let mut entries: Vec<TimelineEntry> = BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .flat_map(|record| entries_from_record(&record))
        .collect();

    let start = entries.len().saturating_sub(max_entries);
    entries.drain(..start);
    entries
}

fn entries_from_record(record: &Value) -> Vec<TimelineEntry> {
    let flag = |key: &str| record.get(key).and_then(Value::as_bool).unwrap_or(false);
    // Subagent turns and injected meta messages aren't the user's own work.
    if flag("isSidechain") || flag("isMeta") {
        return Vec::new();
    }
    let Some(timestamp) = record.get("timestamp").and_then(Value::as_str) else {
        return Vec::new();
    };
    let content = record.get("message").and_then(|m| m.get("content"));

    let entries = match record.get("type").and_then(Value::as_str) {
        Some("user") => user_prompt(content).into_iter().collect(),
        Some("assistant") => content
            .and_then(Value::as_array)
            .map(|blocks| blocks.iter().filter_map(tool_use_entry).collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    };

    entries
        .into_iter()
        .map(|mut entry| {
            entry.timestamp = timestamp.to_string();
            let mut details = entry.details.take().unwrap_or_else(|| serde_json::json!({}));
            if let Some(map) = details.as_object_mut() {
                map.insert("source".to_string(), Value::from(TRANSCRIPT_SOURCE));
            }
            entry.with_details(details)
        })
        .collect()
}

/// A typed user prompt. Tool results and wrapped system/command text (which
/// starts with a tag like `<command-name>`) are not prompts.
fn user_prompt(content: Option<&Value>) -> Option<TimelineEntry> {
    let text = match content? {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return None,
    };
    let text = text.trim();
    if text.is_empty() || text.starts_with('<') {
        return None;
    }
    Some(TimelineEntry::new("user_input", &truncate_chars(text, PROMPT_PREVIEW_CHARS)))
}

fn tool_use_entry(block: &Value) -> Option<TimelineEntry> {
    if block.get("type").and_then(Value::as_str) != Some("tool_use") {
        return None;
    }
    let tool = block.get("name").and_then(Value::as_str)?;
    if NOISY_TOOLS.contains(&tool) {
        return None;
    }
    let input = block.get("input");
    let str_field = |key: &str| input.and_then(|i| i.get(key)).and_then(Value::as_str);

    let entry = match tool {
        "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
            let path = str_field("file_path").or_else(|| str_field("notebook_path"))?;
            TimelineEntry::new("file_write", &format!("Edited {}", basename(path)))
        }
        "Bash" => {
            let command = str_field("command")?;
            TimelineEntry::new(
                "bash",
                &format!("$ {}", truncate_chars(command, COMMAND_PREVIEW_CHARS)),
            )
        }
        "Read" => match str_field("file_path") {
            Some(path) => TimelineEntry::new("tool", &format!("Read {}", basename(path))),
            None => TimelineEntry::new("tool", "Read file"),
        },
        "Grep" | "Glob" => match str_field("pattern") {
            Some(pattern) => TimelineEntry::new(
                "tool",
                &format!("Searched {}", truncate_chars(pattern, COMMAND_PREVIEW_CHARS)),
            ),
            None => TimelineEntry::new("tool", "Searched"),
        },
        _ => TimelineEntry::new("tool", &format!("Used {tool}")),
    };
    Some(entry.with_details(serde_json::json!({ "tool": tool })))
}

fn basename(path: &str) -> &str {
    Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or(path)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_transcript(lines: &[Value]) -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("session.jsonl");
        let body: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
        fs::write(&path, body.join("\n") + "\nnot json\n").unwrap();
        (tmp, path)
    }

    #[test]
    fn sanitizes_like_claude_code() {
        assert_eq!(
            sanitize_path("/Users/me/dev/my.project_x"),
            "-Users-me-dev-my-project-x"
        );
    }

    #[test]
    fn maps_prompts_and_tool_calls() {
        let (_tmp, path) = write_transcript(&[
            serde_json::json!({"type": "user", "timestamp": "2026-09-01T10:00:00Z",
                "message": {"role": "user", "content": "fix the login bug"}}),
            serde_json::json!({"type": "assistant", "timestamp": "2026-09-01T10:00:05Z",
                "message": {"content": [
                    {"type": "text", "text": "Looking."},
                    {"type": "tool_use", "name": "Read", "input": {"file_path": "/p/src/auth.ts"}},
                    {"type": "tool_use", "name": "Edit", "input": {"file_path": "/p/src/auth.ts"}},
                    {"type": "tool_use", "name": "Bash", "input": {"command": "npm test"}},
                    {"type": "tool_use", "name": "TodoWrite", "input": {}}
                ]}}),
        ]);

        let entries = read_transcript_entries(&path, 100);
        let summaries: Vec<(&str, &str)> = entries
            .iter()
            .map(|e| (e.event_type.as_str(), e.summary.as_str()))
            .collect();
        assert_eq!(
            summaries,
            vec![
                ("user_input", "fix the login bug"),
                ("tool", "Read auth.ts"),
                ("file_write", "Edited auth.ts"),
                ("bash", "$ npm test"),
            ]
        );
        assert_eq!(entries[0].timestamp, "2026-09-01T10:00:00Z");
        assert_eq!(entries[3].timestamp, "2026-09-01T10:00:05Z");
        assert!(entries
            .iter()
            .all(|e| e.details.as_ref().unwrap()["source"] == TRANSCRIPT_SOURCE));
    }

    #[test]
    fn skips_meta_sidechain_tool_results_and_wrapped_commands() {
        let (_tmp, path) = write_transcript(&[
            serde_json::json!({"type": "user", "timestamp": "t1", "isMeta": true,
                "message": {"content": "caveat text"}}),
            serde_json::json!({"type": "user", "timestamp": "t2", "isSidechain": true,
                "message": {"content": "subagent prompt"}}),
            serde_json::json!({"type": "user", "timestamp": "t3",
                "message": {"content": [{"type": "tool_result", "content": "ok"}]}}),
            serde_json::json!({"type": "user", "timestamp": "t4",
                "message": {"content": "<command-name>/clear</command-name>"}}),
            serde_json::json!({"type": "system", "timestamp": "t5"}),
        ]);

        assert!(read_transcript_entries(&path, 100).is_empty());
    }

    #[test]
    fn keeps_only_the_newest_entries() {
        let lines: Vec<Value> = (0..10)
            .map(|i| {
                serde_json::json!({"type": "user", "timestamp": format!("t{i}"),
                    "message": {"content": format!("prompt {i}")}})
            })
            .collect();
        let (_tmp, path) = write_transcript(&lines);

        let entries = read_transcript_entries(&path, 3);
        let summaries: Vec<&str> = entries.iter().map(|e| e.summary.as_str()).collect();
        assert_eq!(summaries, vec!["prompt 7", "prompt 8", "prompt 9"]);
    }

    #[test]
    fn truncates_long_prompts_on_char_boundaries() {
        let long = "é".repeat(PROMPT_PREVIEW_CHARS + 10);
        let entry = user_prompt(Some(&Value::from(long))).unwrap();
        assert_eq!(entry.summary.chars().count(), PROMPT_PREVIEW_CHARS + 1);
        assert!(entry.summary.ends_with('…'));
    }

    #[test]
    fn latest_transcript_picks_newest_jsonl() {
        let tmp = tempfile::tempdir().unwrap();
        let older = tmp.path().join("a.jsonl");
        let newer = tmp.path().join("b.jsonl");
        fs::write(&older, "").unwrap();
        fs::write(tmp.path().join("notes.txt"), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&newer, "").unwrap();

        assert_eq!(latest_transcript(tmp.path()), Some(newer));
    }
}
