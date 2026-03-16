use std::fs;
use std::path::{Path, PathBuf};

/// Inject nextDialog hook config into `.claude/settings.local.json` in the given working directory.
/// Merges with existing content, tagging managed entries with `_nextdialog_managed: true`.
pub fn inject_hook_config(working_dir: &str, port: u16) -> Result<(), String> {
    let settings_path = claude_settings_path(working_dir);

    // Ensure .claude directory exists
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .claude directory: {e}"))?;
    }

    // Read existing settings or start fresh
    let mut root: serde_json::Map<String, serde_json::Value> = if settings_path.exists() {
        let data = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.local.json: {e}"))?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    // Hook event types we subscribe to
    let event_types = [
        "PostToolUse",
        "Stop",
        "Notification",
        "SessionStart",
        "SessionEnd",
    ];

    // Get or create the "hooks" object
    let hooks_obj = root
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));

    let hooks_map = hooks_obj
        .as_object_mut()
        .ok_or("hooks field is not an object")?;

    for event_type in &event_types {
        // Encode event type in the URL path so the server knows which hook fired
        let hook_url = format!("http://127.0.0.1:{port}/hook/{event_type}");

        let managed_hook = serde_json::json!({
            "type": "http",
            "url": hook_url,
            "timeout": 2,
            "_nextdialog_managed": true
        });

        let managed_matcher = serde_json::json!({
            "matcher": "",
            "hooks": [managed_hook]
        });

        let matchers = hooks_map
            .entry(*event_type)
            .or_insert_with(|| serde_json::json!([]));

        let matchers_arr = matchers
            .as_array_mut()
            .ok_or(format!("{event_type} is not an array"))?;

        // Remove any existing nextDialog-managed entries
        matchers_arr.retain(|matcher| {
            let hooks = matcher.get("hooks").and_then(|h| h.as_array());
            if let Some(hooks) = hooks {
                !hooks
                    .iter()
                    .any(|h| h.get("_nextdialog_managed").and_then(|v| v.as_bool()) == Some(true))
            } else {
                true
            }
        });

        // Add our managed entry
        matchers_arr.push(managed_matcher);
    }

    // Write back
    let data = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(&settings_path, data)
        .map_err(|e| format!("Failed to write settings.local.json: {e}"))?;

    Ok(())
}

/// Remove nextDialog-managed hook entries from `.claude/settings.local.json`.
pub fn remove_hook_config(working_dir: &str) -> Result<(), String> {
    let settings_path = claude_settings_path(working_dir);

    if !settings_path.exists() {
        return Ok(());
    }

    let data = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings.local.json: {e}"))?;

    let mut root: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&data).unwrap_or_default();

    if let Some(hooks_obj) = root.get_mut("hooks") {
        if let Some(hooks_map) = hooks_obj.as_object_mut() {
            for (_event_type, matchers) in hooks_map.iter_mut() {
                if let Some(arr) = matchers.as_array_mut() {
                    arr.retain(|matcher| {
                        let hooks = matcher.get("hooks").and_then(|h| h.as_array());
                        if let Some(hooks) = hooks {
                            !hooks.iter().any(|h| {
                                h.get("_nextdialog_managed").and_then(|v| v.as_bool())
                                    == Some(true)
                            })
                        } else {
                            true
                        }
                    });
                }
            }

            // Clean up empty event type arrays
            hooks_map.retain(|_, v| {
                v.as_array().map(|a| !a.is_empty()).unwrap_or(true)
            });

            // Remove hooks key entirely if empty
            if hooks_map.is_empty() {
                root.remove("hooks");
            }
        }
    }

    // Write back (or delete if empty)
    if root.is_empty() {
        let _ = fs::remove_file(&settings_path);
    } else {
        let data = serde_json::to_string_pretty(&root)
            .map_err(|e| format!("Failed to serialize settings: {e}"))?;
        fs::write(&settings_path, data)
            .map_err(|e| format!("Failed to write settings.local.json: {e}"))?;
    }

    Ok(())
}

fn claude_settings_path(working_dir: &str) -> PathBuf {
    Path::new(working_dir)
        .join(".claude")
        .join("settings.local.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn inject_creates_config() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();

        let path = claude_settings_path(dir);
        assert!(path.exists());

        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let hooks = data.get("hooks").unwrap().as_object().unwrap();

        assert!(hooks.contains_key("PostToolUse"));
        assert!(hooks.contains_key("Stop"));
        assert!(hooks.contains_key("Notification"));

        let post_tool = hooks["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 1);
        let url = post_tool[0]["hooks"][0]["url"].as_str().unwrap();
        assert_eq!(url, "http://127.0.0.1:7432/hook/PostToolUse");
    }

    #[test]
    fn inject_preserves_existing_hooks() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        // Write existing config with user hooks
        let existing = serde_json::json!({
            "hooks": {
                "PostToolUse": [{
                    "matcher": "Write",
                    "hooks": [{"type": "command", "command": "echo written"}]
                }]
            }
        });
        let path = claude_settings_path(dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_string_pretty(&existing).unwrap()).unwrap();

        inject_hook_config(dir, 7450).unwrap();

        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();

        // User hook preserved + our managed hook added
        assert_eq!(post_tool.len(), 2);
    }

    #[test]
    fn remove_cleans_managed_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();
        remove_hook_config(dir).unwrap();

        let path = claude_settings_path(dir);
        // File should be removed since it was entirely managed
        assert!(!path.exists());
    }

    #[test]
    fn remove_preserves_user_hooks() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        // Inject first
        inject_hook_config(dir, 7432).unwrap();

        // Add a user hook
        let path = claude_settings_path(dir);
        let mut data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        data["hooks"]["PostToolUse"]
            .as_array_mut()
            .unwrap()
            .insert(
                0,
                serde_json::json!({
                    "matcher": "Write",
                    "hooks": [{"type": "command", "command": "echo written"}]
                }),
            );
        fs::write(&path, serde_json::to_string_pretty(&data).unwrap()).unwrap();

        remove_hook_config(dir).unwrap();

        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 1); // Only user hook remains
    }
}
