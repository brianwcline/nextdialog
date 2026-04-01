use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A file discovered in the project's agent config directories.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredConfig {
    /// "Command" | "Agent" | "Skill" | "OutputStyle" | "ContextFile" | "Rule" | "GeminiCommand" | "McpConfig"
    pub kind: String,
    /// Relative path from working directory
    pub relative_path: String,
    /// File name (for display)
    pub name: String,
    /// First ~200 chars of content (preview)
    pub preview: String,
    /// Whether this file was installed by NextDialog tuning
    pub managed: bool,
}

/// Scan a working directory for existing agent configuration files.
pub fn scan_project_configs(working_dir: &str) -> Vec<DiscoveredConfig> {
    let base = Path::new(working_dir);
    let mut configs = Vec::new();

    // Claude Code configs
    scan_dir(&base.join(".claude/commands"), "Command", &mut configs, base);
    scan_dir(&base.join(".claude/agents"), "Agent", &mut configs, base);
    scan_dir_skills(&base.join(".claude/skills"), "Skill", &mut configs, base);
    scan_dir(&base.join(".claude/output-styles"), "OutputStyle", &mut configs, base);

    // Cursor configs
    scan_dir(&base.join(".cursor/rules"), "Rule", &mut configs, base);
    scan_dir_skills(&base.join(".cursor/skills"), "CursorSkill", &mut configs, base);

    // Gemini configs
    scan_dir_recursive(&base.join(".gemini/commands"), "GeminiCommand", &mut configs, base);

    // Context files
    for name in &["CLAUDE.md", ".claude/CLAUDE.md", ".gemini/GEMINI.md"] {
        let path = base.join(name);
        if path.is_file() {
            if let Ok(content) = fs::read_to_string(&path) {
                configs.push(DiscoveredConfig {
                    kind: "ContextFile".to_string(),
                    relative_path: name.to_string(),
                    name: name.to_string(),
                    preview: truncate_preview(&content),
                    managed: content.contains("Installed by NextDialog"),
                });
            }
        }
    }

    // MCP configs
    for name in &[".mcp.json", ".cursor/mcp.json"] {
        let path = base.join(name);
        if path.is_file() {
            if let Ok(content) = fs::read_to_string(&path) {
                configs.push(DiscoveredConfig {
                    kind: "McpConfig".to_string(),
                    relative_path: name.to_string(),
                    name: name.to_string(),
                    preview: truncate_preview(&content),
                    managed: content.contains("_nextdialog_managed"),
                });
            }
        }
    }

    // Sort by kind then name
    configs.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.name.cmp(&b.name)));
    configs
}

/// Scan a flat directory for markdown/toml files.
fn scan_dir(dir: &Path, kind: &str, configs: &mut Vec<DiscoveredConfig>, base: &Path) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "md" | "toml" | "json" | "mdc") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let rel = path.strip_prefix(base).unwrap_or(&path);
            configs.push(DiscoveredConfig {
                kind: kind.to_string(),
                relative_path: rel.to_string_lossy().to_string(),
                name,
                preview: truncate_preview(&content),
                managed: content.contains("Installed by NextDialog"),
            });
        }
    }
}

/// Scan for skills (directory-based: each skill is a dir with SKILL.md inside).
fn scan_dir_skills(dir: &Path, kind: &str, configs: &mut Vec<DiscoveredConfig>, base: &Path) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let skill_dir = entry.path();
        if !skill_dir.is_dir() {
            continue;
        }
        let skill_file = skill_dir.join("SKILL.md");
        if skill_file.is_file() {
            if let Ok(content) = fs::read_to_string(&skill_file) {
                let name = skill_dir.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let rel = skill_file.strip_prefix(base).unwrap_or(&skill_file);
                configs.push(DiscoveredConfig {
                    kind: kind.to_string(),
                    relative_path: rel.to_string_lossy().to_string(),
                    name,
                    preview: truncate_preview(&content),
                    managed: content.contains("Installed by NextDialog"),
                });
            }
        }
    }
}

/// Scan recursively for TOML command files (supports namespaced: test/gen.toml).
fn scan_dir_recursive(dir: &Path, kind: &str, configs: &mut Vec<DiscoveredConfig>, base: &Path) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir_recursive(&path, kind, configs, base);
        } else if path.is_file() {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "toml" | "md") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&path) {
                let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let rel = path.strip_prefix(base).unwrap_or(&path);
                configs.push(DiscoveredConfig {
                    kind: kind.to_string(),
                    relative_path: rel.to_string_lossy().to_string(),
                    name,
                    preview: truncate_preview(&content),
                    managed: content.contains("Installed by NextDialog"),
                });
            }
        }
    }
}

fn truncate_preview(content: &str) -> String {
    // Skip managed header and frontmatter for preview
    let text = content
        .strip_prefix("# Installed by NextDialog\n\n")
        .unwrap_or(content);
    let text = if text.starts_with("---") {
        // Skip YAML frontmatter
        text.splitn(3, "---").nth(2).unwrap_or(text).trim_start()
    } else {
        text
    };
    if text.len() > 200 {
        let mut end = 200;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}...", &text[..end])
    } else {
        text.to_string()
    }
}
