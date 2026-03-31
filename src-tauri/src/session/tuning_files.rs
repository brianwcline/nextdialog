use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::tuning::FileConfig;

const MANAGED_HEADER: &str = "# Installed by NextDialog";

/// Status of a single installed file config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInstallStatus {
    pub relative_path: String,
    pub kind: String,
    /// "installed" | "modified" | "missing"
    pub status: String,
}

/// Install file configs to the project directory.
/// Writes each file with a managed header for tracking.
/// Creates parent directories as needed. Idempotent.
pub fn install_files(working_dir: &str, files: &[FileConfig]) -> Result<Vec<String>, String> {
    let base = Path::new(working_dir);
    if !base.is_dir() {
        return Err(format!("Working directory does not exist: {working_dir}"));
    }

    let mut installed = Vec::new();

    for file in files {
        let target = base.join(&file.relative_path);

        // Create parent directories
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;
        }

        // Build content with managed header
        let content = format_managed_content(&file.content, &file.relative_path);

        fs::write(&target, &content)
            .map_err(|e| format!("Failed to write {}: {e}", target.display()))?;

        installed.push(file.relative_path.clone());
    }

    Ok(installed)
}

/// Uninstall a single managed file. Only removes if it still has the managed header.
/// Returns true if the file was removed, false if it was modified by the user.
pub fn uninstall_file(working_dir: &str, relative_path: &str) -> Result<bool, String> {
    let target = Path::new(working_dir).join(relative_path);

    if !target.exists() {
        return Ok(true); // Already gone
    }

    let content = fs::read_to_string(&target)
        .map_err(|e| format!("Failed to read {}: {e}", target.display()))?;

    if content.contains(MANAGED_HEADER) {
        fs::remove_file(&target)
            .map_err(|e| format!("Failed to remove {}: {e}", target.display()))?;

        // Clean up empty parent directories (up to .claude/, .cursor/, .gemini/)
        cleanup_empty_parents(&target, Path::new(working_dir));

        Ok(true)
    } else {
        // User modified the file — don't remove
        Ok(false)
    }
}

/// Uninstall all managed files for a set of file configs.
pub fn uninstall_all(working_dir: &str, files: &[FileConfig]) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    let mut skipped = Vec::new();

    for file in files {
        match uninstall_file(working_dir, &file.relative_path)? {
            true => removed.push(file.relative_path.clone()),
            false => skipped.push(file.relative_path.clone()),
        }
    }

    if !skipped.is_empty() {
        eprintln!(
            "[tuning_files] Skipped user-modified files: {}",
            skipped.join(", ")
        );
    }

    Ok(removed)
}

/// Get the install status of each file config.
pub fn get_install_status(working_dir: &str, files: &[FileConfig]) -> Vec<FileInstallStatus> {
    let base = Path::new(working_dir);

    files
        .iter()
        .map(|file| {
            let target = base.join(&file.relative_path);
            let status = if !target.exists() {
                "missing"
            } else {
                let content = fs::read_to_string(&target).unwrap_or_default();
                if content.contains(MANAGED_HEADER) {
                    "installed"
                } else {
                    "modified"
                }
            };

            FileInstallStatus {
                relative_path: file.relative_path.clone(),
                kind: format!("{:?}", file.kind),
                status: status.to_string(),
            }
        })
        .collect()
}

/// Format file content with a managed header comment.
/// Uses the appropriate comment syntax based on file extension.
fn format_managed_content(content: &str, relative_path: &str) -> String {
    let ext = Path::new(relative_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    match ext {
        "toml" => format!("{MANAGED_HEADER}\n\n{content}"),
        "json" => {
            // JSON doesn't support comments — embed in a _nextdialog field
            // If content is valid JSON, inject the marker
            if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(content) {
                if let Some(obj) = value.as_object_mut() {
                    obj.insert(
                        "_nextdialog_managed".to_string(),
                        serde_json::Value::Bool(true),
                    );
                    return serde_json::to_string_pretty(&value).unwrap_or_else(|_| content.to_string());
                }
            }
            content.to_string()
        }
        // Markdown, YAML, shell, and anything else — use # comment
        _ => format!("{MANAGED_HEADER}\n\n{content}"),
    }
}

/// Remove empty parent directories up to the working directory root.
fn cleanup_empty_parents(file_path: &Path, working_dir: &Path) {
    let mut dir = file_path.parent();
    while let Some(parent) = dir {
        // Don't go above the working directory
        if parent == working_dir || !parent.starts_with(working_dir) {
            break;
        }
        // Only remove if empty
        if fs::read_dir(parent).map(|mut d| d.next().is_none()).unwrap_or(false) {
            let _ = fs::remove_dir(parent);
        } else {
            break; // Non-empty, stop climbing
        }
        dir = parent.parent();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::tuning::FileConfigKind;
    use std::fs;
    use tempfile::TempDir;

    fn make_file(kind: FileConfigKind, path: &str, content: &str) -> FileConfig {
        FileConfig {
            kind,
            relative_path: path.to_string(),
            content: content.to_string(),
        }
    }

    #[test]
    fn test_install_and_status() {
        let dir = TempDir::new().unwrap();
        let wd = dir.path().to_str().unwrap();

        let files = vec![
            make_file(
                FileConfigKind::Command,
                ".claude/commands/test.md",
                "---\ndescription: Run tests\n---\nRun the test suite",
            ),
        ];

        let installed = install_files(wd, &files).unwrap();
        assert_eq!(installed, vec![".claude/commands/test.md"]);

        // File should exist
        let target = dir.path().join(".claude/commands/test.md");
        assert!(target.exists());

        // Content should have managed header
        let content = fs::read_to_string(&target).unwrap();
        assert!(content.contains(MANAGED_HEADER));

        // Status should be "installed"
        let status = get_install_status(wd, &files);
        assert_eq!(status[0].status, "installed");
    }

    #[test]
    fn test_uninstall_managed_file() {
        let dir = TempDir::new().unwrap();
        let wd = dir.path().to_str().unwrap();

        let files = vec![make_file(
            FileConfigKind::Command,
            ".claude/commands/test.md",
            "content",
        )];

        install_files(wd, &files).unwrap();
        let removed = uninstall_file(wd, ".claude/commands/test.md").unwrap();
        assert!(removed);
        assert!(!dir.path().join(".claude/commands/test.md").exists());
    }

    #[test]
    fn test_uninstall_skips_modified_file() {
        let dir = TempDir::new().unwrap();
        let wd = dir.path().to_str().unwrap();

        let files = vec![make_file(
            FileConfigKind::Command,
            ".claude/commands/test.md",
            "content",
        )];

        install_files(wd, &files).unwrap();

        // Simulate user modifying the file (removing managed header)
        let target = dir.path().join(".claude/commands/test.md");
        fs::write(&target, "user modified content").unwrap();

        let removed = uninstall_file(wd, ".claude/commands/test.md").unwrap();
        assert!(!removed);
        assert!(target.exists());

        // Status should show "modified"
        let status = get_install_status(wd, &files);
        assert_eq!(status[0].status, "modified");
    }

    #[test]
    fn test_missing_file_status() {
        let dir = TempDir::new().unwrap();
        let wd = dir.path().to_str().unwrap();

        let files = vec![make_file(
            FileConfigKind::Command,
            ".claude/commands/test.md",
            "content",
        )];

        let status = get_install_status(wd, &files);
        assert_eq!(status[0].status, "missing");
    }
}
