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

        // Remove any existing entries managed by THIS port (not other sessions)
        matchers_arr.retain(|matcher| !is_managed_by_port(matcher, port));

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
/// If `port` is Some, only removes entries for that specific port (normal teardown).
/// If `port` is None, removes ALL managed entries (crash recovery at startup).
pub fn remove_hook_config(working_dir: &str, port: Option<u16>) -> Result<(), String> {
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
                    arr.retain(|matcher| match port {
                        Some(p) => !is_managed_by_port(matcher, p),
                        None => !is_managed(matcher),
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

/// Inject tuning hooks from SessionTuning.hooks_config into settings.local.json.
/// Each hook is tagged with `_nextdialog_tuning: true` for identification.
pub fn inject_tuning_hooks(
    working_dir: &str,
    hooks: &[crate::session::tuning::HookEntry],
) -> Result<(), String> {
    if hooks.is_empty() {
        return Ok(());
    }

    let settings_path = claude_settings_path(working_dir);

    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .claude directory: {e}"))?;
    }

    let mut root: serde_json::Map<String, serde_json::Value> = if settings_path.exists() {
        let data = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.local.json: {e}"))?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    let hooks_obj = root
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_map = hooks_obj
        .as_object_mut()
        .ok_or("hooks field is not an object")?;

    // First remove any existing tuning hooks (idempotent re-inject)
    for (_event, matchers) in hooks_map.iter_mut() {
        if let Some(arr) = matchers.as_array_mut() {
            arr.retain(|m| !is_tuning_managed(m));
        }
    }

    // Add each tuning hook
    for entry in hooks {
        let mut hook_json = serde_json::json!({
            "type": entry.hook_type,
            "_nextdialog_tuning": true
        });

        // Set type-specific payload field
        match entry.hook_type.as_str() {
            "http" => { hook_json["url"] = serde_json::json!(entry.command); }
            "prompt" | "agent" => { hook_json["prompt"] = serde_json::json!(entry.command); }
            _ => { hook_json["command"] = serde_json::json!(entry.command); }
        }

        if let Some(ref cond) = entry.if_condition {
            hook_json["if"] = serde_json::json!(cond);
        }
        if let Some(timeout) = entry.timeout {
            hook_json["timeout"] = serde_json::json!(timeout);
        }
        if entry.async_mode {
            hook_json["async"] = serde_json::json!(true);
        }
        if entry.once {
            hook_json["once"] = serde_json::json!(true);
        }
        if let Some(ref model) = entry.model {
            hook_json["model"] = serde_json::json!(model);
        }

        let matcher_json = serde_json::json!({
            "matcher": entry.matcher.as_deref().unwrap_or(""),
            "hooks": [hook_json]
        });

        let matchers = hooks_map
            .entry(&entry.event)
            .or_insert_with(|| serde_json::json!([]));
        if let Some(arr) = matchers.as_array_mut() {
            arr.push(matcher_json);
        }
    }

    // Clean up empty arrays
    hooks_map.retain(|_, v| v.as_array().map(|a| !a.is_empty()).unwrap_or(true));

    let data = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(&settings_path, data)
        .map_err(|e| format!("Failed to write settings.local.json: {e}"))?;

    Ok(())
}

/// Remove tuning-managed hook entries from settings.local.json.
pub fn remove_tuning_hooks(working_dir: &str) -> Result<(), String> {
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
            for (_event, matchers) in hooks_map.iter_mut() {
                if let Some(arr) = matchers.as_array_mut() {
                    arr.retain(|m| !is_tuning_managed(m));
                }
            }
            hooks_map.retain(|_, v| v.as_array().map(|a| !a.is_empty()).unwrap_or(true));
            if hooks_map.is_empty() {
                root.remove("hooks");
            }
        }
    }

    // Also remove tuning permission rules
    if let Some(perms) = root.get("permissions") {
        if let Some(obj) = perms.as_object() {
            if obj.get("_nextdialog_tuning").and_then(|v| v.as_bool()).unwrap_or(false) {
                root.remove("permissions");
            }
        }
    }

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

/// Inject tuning permission rules into settings.local.json.
pub fn inject_tuning_permissions(
    working_dir: &str,
    rules: &crate::session::tuning::PermissionRules,
) -> Result<(), String> {
    if rules.allow.is_empty() && rules.deny.is_empty() {
        return Ok(());
    }

    let settings_path = claude_settings_path(working_dir);
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .claude directory: {e}"))?;
    }

    let mut root: serde_json::Map<String, serde_json::Value> = if settings_path.exists() {
        let data = fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.local.json: {e}"))?;
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    let mut perms = serde_json::Map::new();
    perms.insert("_nextdialog_tuning".to_string(), serde_json::json!(true));

    if !rules.allow.is_empty() {
        perms.insert("allow".to_string(), serde_json::json!(rules.allow));
    }
    if !rules.deny.is_empty() {
        perms.insert("deny".to_string(), serde_json::json!(rules.deny));
    }

    root.insert("permissions".to_string(), serde_json::Value::Object(perms));

    let data = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(&settings_path, data)
        .map_err(|e| format!("Failed to write settings.local.json: {e}"))?;

    Ok(())
}

/// Check if a matcher contains a tuning-managed hook.
fn is_tuning_managed(matcher: &serde_json::Value) -> bool {
    matcher
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("_nextdialog_tuning")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Check if a matcher has a managed hook targeting a specific port.
/// Matches by explicit `_nextdialog_managed` tag OR by URL pattern (catches untagged orphans).
fn is_managed_by_port(matcher: &serde_json::Value, port: u16) -> bool {
    let prefix = format!("http://127.0.0.1:{port}/hook/");
    matcher
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("url")
                    .and_then(|u| u.as_str())
                    .map(|u| u.starts_with(&prefix))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Check if a matcher has any managed hook (any port). Used for crash recovery.
/// Matches by explicit `_nextdialog_managed` tag OR by URL pattern (catches untagged orphans).
fn is_managed(matcher: &serde_json::Value) -> bool {
    matcher
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hooks| {
            hooks.iter().any(|h| {
                let has_tag = h
                    .get("_nextdialog_managed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let has_url = h
                    .get("url")
                    .and_then(|u| u.as_str())
                    .map(is_nextdialog_hook_url)
                    .unwrap_or(false);
                has_tag || has_url
            })
        })
        .unwrap_or(false)
}

/// Check if a URL matches the NextDialog hook server pattern.
/// Covers port range 7432-7499 used by PortPool.
fn is_nextdialog_hook_url(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:74") && url.contains("/hook/")
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
        remove_hook_config(dir, Some(7432)).unwrap();

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

        remove_hook_config(dir, Some(7432)).unwrap();

        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 1); // Only user hook remains
    }

    #[test]
    fn two_sessions_coexist_in_same_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();
        inject_hook_config(dir, 7433).unwrap();

        let path = claude_settings_path(dir);
        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 2);

        let urls: Vec<&str> = post_tool
            .iter()
            .map(|m| m["hooks"][0]["url"].as_str().unwrap())
            .collect();
        assert!(urls.contains(&"http://127.0.0.1:7432/hook/PostToolUse"));
        assert!(urls.contains(&"http://127.0.0.1:7433/hook/PostToolUse"));
    }

    #[test]
    fn remove_one_session_preserves_other() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();
        inject_hook_config(dir, 7433).unwrap();
        remove_hook_config(dir, Some(7432)).unwrap();

        let path = claude_settings_path(dir);
        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 1);
        let url = post_tool[0]["hooks"][0]["url"].as_str().unwrap();
        assert_eq!(url, "http://127.0.0.1:7433/hook/PostToolUse");
    }

    #[test]
    fn remove_all_managed_for_crash_recovery() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();
        inject_hook_config(dir, 7433).unwrap();
        remove_hook_config(dir, None).unwrap();

        let path = claude_settings_path(dir);
        assert!(!path.exists());
    }

    #[test]
    fn three_sessions_teardown_in_any_order() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();
        inject_hook_config(dir, 7433).unwrap();
        inject_hook_config(dir, 7434).unwrap();

        // Tear down middle one first
        remove_hook_config(dir, Some(7433)).unwrap();

        let path = claude_settings_path(dir);
        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 2);

        // Tear down remaining in reverse order
        remove_hook_config(dir, Some(7434)).unwrap();
        remove_hook_config(dir, Some(7432)).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn remove_all_cleans_untagged_orphans() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        // Simulate an orphaned entry without _nextdialog_managed flag
        let orphan = serde_json::json!({
            "hooks": {
                "PostToolUse": [{
                    "matcher": "",
                    "hooks": [{
                        "type": "http",
                        "url": "http://127.0.0.1:7437/hook/PostToolUse",
                        "timeout": 2
                    }]
                }],
                "Stop": [{
                    "matcher": "",
                    "hooks": [{
                        "type": "http",
                        "url": "http://127.0.0.1:7437/hook/Stop",
                        "timeout": 2
                    }]
                }]
            }
        });
        let path = claude_settings_path(dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_string_pretty(&orphan).unwrap()).unwrap();

        // Crash recovery should remove untagged orphans by URL pattern
        remove_hook_config(dir, None).unwrap();
        assert!(!path.exists(), "Untagged orphan entries should be cleaned up");
    }

    #[test]
    fn remove_by_port_cleans_untagged_orphans() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        // Simulate an orphaned entry without _nextdialog_managed flag
        let orphan = serde_json::json!({
            "hooks": {
                "PostToolUse": [{
                    "matcher": "",
                    "hooks": [{
                        "type": "http",
                        "url": "http://127.0.0.1:7437/hook/PostToolUse",
                        "timeout": 2
                    }]
                }]
            }
        });
        let path = claude_settings_path(dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_string_pretty(&orphan).unwrap()).unwrap();

        // Port-specific removal should also catch untagged entries
        remove_hook_config(dir, Some(7437)).unwrap();
        assert!(!path.exists(), "Untagged orphan should be removed by port");
    }

    #[test]
    fn reinject_same_port_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_str().unwrap();

        inject_hook_config(dir, 7432).unwrap();
        inject_hook_config(dir, 7432).unwrap();

        let path = claude_settings_path(dir);
        let data: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let post_tool = data["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post_tool.len(), 1);
    }
}
