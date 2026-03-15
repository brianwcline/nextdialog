#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Resolve the user's login shell PATH and set it process-wide.
/// macOS GUI apps launched from Finder/Dock inherit a minimal PATH
/// (/usr/bin:/bin:/usr/sbin:/sbin). By resolving the login shell PATH
/// once at startup via `std::env::set_var`, every subsequent
/// `CommandBuilder::new()` picks it up through `get_base_env()`.
fn resolve_and_set_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    if let Ok(output) = std::process::Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output()
    {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            // SAFETY: called before any threads are spawned
            unsafe { std::env::set_var("PATH", &path) };
        }
    }
}

fn main() {
    resolve_and_set_path();
    nextdialog_lib::run()
}
