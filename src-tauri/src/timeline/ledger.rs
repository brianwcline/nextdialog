use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEntry {
    pub timestamp: String,
    pub event_type: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl TimelineEntry {
    pub fn new(event_type: &str, summary: &str) -> Self {
        Self {
            timestamp: Utc::now().to_rfc3339(),
            event_type: event_type.to_string(),
            summary: summary.to_string(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
}

pub struct TimelineLedger {
    base_dir: PathBuf,
}

impl TimelineLedger {
    pub fn new() -> Self {
        let base_dir = dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".nextdialog")
            .join("timelines");

        if let Err(e) = fs::create_dir_all(&base_dir) {
            eprintln!("[timeline] Failed to create timelines directory: {e}");
        }

        Self { base_dir }
    }

    /// Append a timeline entry to the session's JSONL file.
    pub fn append(&self, session_id: &str, entry: &TimelineEntry) {
        let path = self.session_path(session_id);

        let mut line = match serde_json::to_string(entry) {
            Ok(json) => json,
            Err(e) => {
                eprintln!("[timeline] Failed to serialize entry: {e}");
                return;
            }
        };
        line.push('\n');

        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(mut file) => {
                if let Err(e) = file.write_all(line.as_bytes()) {
                    eprintln!("[timeline] Failed to write entry: {e}");
                }
            }
            Err(e) => {
                eprintln!("[timeline] Failed to open timeline file: {e}");
            }
        }
    }

    /// Read the last `count` entries from a session's timeline.
    pub fn read_last(&self, session_id: &str, count: usize) -> Vec<TimelineEntry> {
        let path = self.session_path(session_id);

        let file = match fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let entries: Vec<TimelineEntry> = reader
            .lines()
            .filter_map(|line| {
                line.ok()
                    .and_then(|l| serde_json::from_str(&l).ok())
            })
            .collect();

        let start = entries.len().saturating_sub(count);
        entries[start..].to_vec()
    }

    /// Trim a session's timeline to keep only the last `keep` entries.
    #[allow(dead_code)]
    pub fn trim(&self, session_id: &str, keep: usize) {
        let path = self.session_path(session_id);

        let entries = self.read_last(session_id, keep);
        if entries.is_empty() {
            return;
        }

        let lines: Vec<String> = entries
            .iter()
            .filter_map(|e| serde_json::to_string(e).ok())
            .collect();

        if let Err(e) = fs::write(&path, lines.join("\n") + "\n") {
            eprintln!("[timeline] Failed to trim timeline: {e}");
        }
    }

    /// Remove a session's timeline file entirely.
    pub fn clear(&self, session_id: &str) {
        let path = self.session_path(session_id);
        let _ = fs::remove_file(&path);
    }

    /// Count entries in a session's timeline (for lazy trim checks).
    #[allow(dead_code)]
    pub fn count(&self, session_id: &str) -> usize {
        let path = self.session_path(session_id);
        match fs::File::open(&path) {
            Ok(f) => BufReader::new(f).lines().count(),
            Err(_) => 0,
        }
    }

    fn session_path(&self, session_id: &str) -> PathBuf {
        self.base_dir.join(format!("{session_id}.jsonl"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ledger() -> (tempfile::TempDir, TimelineLedger) {
        let tmp = tempfile::tempdir().unwrap();
        let ledger = TimelineLedger {
            base_dir: tmp.path().to_path_buf(),
        };
        (tmp, ledger)
    }

    #[test]
    fn append_and_read() {
        let (_tmp, ledger) = test_ledger();

        for i in 0..5 {
            let entry = TimelineEntry::new("file_write", &format!("Edited file_{i}.tsx"));
            ledger.append("s1", &entry);
        }

        let entries = ledger.read_last("s1", 3);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].summary, "Edited file_2.tsx");
        assert_eq!(entries[2].summary, "Edited file_4.tsx");
    }

    #[test]
    fn read_empty_session() {
        let (_tmp, ledger) = test_ledger();
        let entries = ledger.read_last("nonexistent", 10);
        assert!(entries.is_empty());
    }

    #[test]
    fn trim_entries() {
        let (_tmp, ledger) = test_ledger();

        for i in 0..1500 {
            let entry = TimelineEntry::new("bash", &format!("Command {i}"));
            ledger.append("s1", &entry);
        }

        assert_eq!(ledger.count("s1"), 1500);

        ledger.trim("s1", 1000);

        assert_eq!(ledger.count("s1"), 1000);
        let entries = ledger.read_last("s1", 1);
        assert_eq!(entries[0].summary, "Command 1499");
    }

    #[test]
    fn clear_removes_file() {
        let (_tmp, ledger) = test_ledger();

        let entry = TimelineEntry::new("lifecycle", "Session started");
        ledger.append("s1", &entry);

        assert!(ledger.session_path("s1").exists());

        ledger.clear("s1");
        assert!(!ledger.session_path("s1").exists());
    }

    #[test]
    fn skip_malformed_lines() {
        let (_tmp, ledger) = test_ledger();
        let path = ledger.session_path("s1");

        // Write a valid entry, then a corrupt line, then another valid entry
        let entry1 = TimelineEntry::new("bash", "First");
        let entry2 = TimelineEntry::new("bash", "Third");
        let mut content = serde_json::to_string(&entry1).unwrap();
        content.push('\n');
        content.push_str("this is not json\n");
        content.push_str(&serde_json::to_string(&entry2).unwrap());
        content.push('\n');

        fs::write(&path, content).unwrap();

        let entries = ledger.read_last("s1", 10);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].summary, "First");
        assert_eq!(entries[1].summary, "Third");
    }

    #[test]
    fn entry_with_details() {
        let (_tmp, ledger) = test_ledger();

        let entry = TimelineEntry::new("file_write", "Edited App.tsx")
            .with_details(serde_json::json!({"path": "/src/App.tsx"}));
        ledger.append("s1", &entry);

        let entries = ledger.read_last("s1", 1);
        assert_eq!(entries[0].details.as_ref().unwrap()["path"], "/src/App.tsx");
    }
}
