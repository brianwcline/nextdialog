#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Resolve the user's full login shell environment and set it process-wide.
/// macOS GUI apps launched from Finder/Dock inherit a minimal environment
/// (/usr/bin:/bin:/usr/sbin:/sbin for PATH, no user-specific vars). By
/// capturing the full login shell environment once at startup, every
/// subsequent `CommandBuilder::new()` inherits PATH, NVM_DIR, and any
/// other vars the user's profile sets — so spawned agents (claude, vibe,
/// etc.) behave identically to commands typed in a terminal.
fn resolve_and_set_login_env() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // Write env to a temp file so profile stdout noise (nvm, brew, etc.)
    // can't mix with the env output and corrupt parsing.
    let tmp = std::env::temp_dir().join(".nextdialog_env");
    let tmp_path = tmp.to_string_lossy().to_string();

    let ok = std::process::Command::new(&shell)
        .args(["-li", "-c", &format!("env -0 > '{tmp_path}'")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    if ok {
        if let Ok(raw) = std::fs::read_to_string(&tmp) {
            for entry in raw.split('\0') {
                if let Some((key, val)) = entry.split_once('=') {
                    if key.is_empty() {
                        continue;
                    }
                    // Skip shell-internal vars that shouldn't be forwarded
                    if matches!(key, "SHLVL" | "PWD" | "OLDPWD" | "_") {
                        continue;
                    }
                    // SAFETY: called before any threads are spawned
                    unsafe { std::env::set_var(key, val) };
                }
            }
        }
        let _ = std::fs::remove_file(&tmp);
    }

    // Fallback: if PATH still looks minimal, try the old reliable approach
    let path = std::env::var("PATH").unwrap_or_default();
    if !path.contains(".nvm") && !path.contains("homebrew") && !path.contains(".cargo") {
        if let Ok(output) = std::process::Command::new(&shell)
            .args(["-li", "-c", "echo $PATH"])
            .output()
        {
            let fallback = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !fallback.is_empty() {
                unsafe { std::env::set_var("PATH", &fallback) };
            }
        }
    }
}

fn main() {
    resolve_and_set_login_env();
    nextdialog_lib::run()
}
