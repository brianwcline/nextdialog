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
    // Print every env var as KEY=VALUE, separated by null bytes to handle
    // values that contain newlines.
    if let Ok(output) = std::process::Command::new(&shell)
        .args(["-l", "-c", "env -0"])
        .output()
    {
        let raw = String::from_utf8_lossy(&output.stdout);
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
}

fn main() {
    resolve_and_set_login_env();
    nextdialog_lib::run()
}
