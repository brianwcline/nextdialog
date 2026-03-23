use std::collections::HashMap;
use std::time::Instant;

use regex::Regex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    #[allow(dead_code)]
    Stopped,
    Starting,
    Idle,
    Working,
    Planning,
    Waiting,
    #[allow(dead_code)]
    Error,
}

/// Status override from hook events (prevents silence checker from overriding).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookStatus {
    /// No hook override — defer to scraping.
    None,
    /// Hook confirmed idle (e.g., Stop event).
    Idle,
    /// Hook confirmed waiting (e.g., Notification event).
    Waiting,
}

/// Auxiliary data extracted from PTY output beyond simple status.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct DetectorExtras {
    /// Context/token usage as fraction 0.0–1.0, if detected.
    pub context_usage: Option<f32>,
    /// First few lines of a plan summary, if in planning mode.
    pub plan_summary: Option<String>,
}

pub struct StatusDetector {
    current: SessionStatus,
    last_output_time: Instant,
    line_buffer: String,
    idle_re: Regex,
    waiting_re: Regex,
    planning_re: Regex,
    context_re: Regex,
    // Plan summary tracking
    plan_lines: Vec<String>,
    capturing_plan: bool,
    // Extras
    extras: DetectorExtras,
    // Hook-confirmed status (prevents silence checker from overriding)
    hook_status: HookStatus,
}

impl StatusDetector {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self::with_patterns(None)
    }

    pub fn with_patterns(overrides: Option<&HashMap<String, String>>) -> Self {
        let get = |key: &str, default: &str| -> Regex {
            let pattern = overrides
                .and_then(|m| m.get(key))
                .map(|s| s.as_str())
                .unwrap_or(default);
            Regex::new(pattern).unwrap_or_else(|_| Regex::new(default).unwrap())
        };

        Self {
            current: SessionStatus::Starting,
            last_output_time: Instant::now(),
            line_buffer: String::new(),
            idle_re: get("idle", r"^[>❯]\s*$"),
            waiting_re: get("waiting", r"\?\s*$|\(y/n\)|\(Y/n\)|\[Y/n\]|\[y/N\]|Do you want to|Esc to cancel|Tab to amend|press Enter|allow once|allow always|deny"),
            planning_re: get("planning", r"(?i)plan mode"),
            context_re: Regex::new(r"(\d+(?:\.\d+)?)%\s*(?:of\s+)?context").unwrap(),
            plan_lines: Vec::new(),
            capturing_plan: false,
            extras: DetectorExtras::default(),
            hook_status: HookStatus::None,
        }
    }

    pub fn extras(&self) -> &DetectorExtras {
        &self.extras
    }

    /// Set hook-confirmed status. Prevents silence checker from overriding.
    pub fn set_hook_status(&mut self, status: HookStatus) {
        self.hook_status = status;
    }

    /// Process raw bytes from PTY. Returns Some(new_status) on transition.
    pub fn process_bytes(&mut self, data: &[u8]) -> Option<SessionStatus> {
        self.last_output_time = Instant::now();
        // New output clears hook status — scraping takes over
        self.hook_status = HookStatus::None;

        // Strip ANSI escapes
        let stripped = strip_ansi_escapes::strip(data);
        let text = String::from_utf8_lossy(&stripped);

        let prev = self.current;

        // Set working since we're receiving output
        if self.current != SessionStatus::Working {
            self.current = SessionStatus::Working;
        }

        for ch in text.chars() {
            if ch == '\n' || ch == '\r' {
                if !self.line_buffer.is_empty() {
                    self.match_line();
                    self.line_buffer.clear();
                }
            } else if ch.is_ascii_graphic() || ch == ' ' {
                self.line_buffer.push(ch);
            }
        }

        // Also check the current buffer (for prompts that don't end with newline)
        if !self.line_buffer.is_empty() {
            self.match_line();
        }

        if self.current != prev {
            Some(self.current)
        } else {
            None
        }
    }

    /// Check for silence (call this periodically). Returns Some if transitioned.
    /// Respects hook-confirmed status to avoid overriding structured signals.
    pub fn check_silence(&mut self, threshold_secs: f64) -> Option<SessionStatus> {
        // If hook has confirmed a status, don't let silence override it
        match self.hook_status {
            HookStatus::Idle => {
                if self.current != SessionStatus::Idle {
                    self.current = SessionStatus::Idle;
                    return Some(SessionStatus::Idle);
                }
                return None;
            }
            HookStatus::Waiting => {
                if self.current != SessionStatus::Waiting {
                    self.current = SessionStatus::Waiting;
                    return Some(SessionStatus::Waiting);
                }
                return None;
            }
            HookStatus::None => {}
        }

        if self.current == SessionStatus::Working
            && self.last_output_time.elapsed().as_secs_f64() > threshold_secs
        {
            self.current = SessionStatus::Idle;
            return Some(SessionStatus::Idle);
        }
        None
    }

    fn match_line(&mut self) {
        let line = self.line_buffer.trim();
        if line.is_empty() {
            return;
        }

        // Check for context/token usage
        if let Some(caps) = self.context_re.captures(line) {
            if let Some(pct_str) = caps.get(1) {
                if let Ok(pct) = pct_str.as_str().parse::<f32>() {
                    self.extras.context_usage = Some((pct / 100.0).clamp(0.0, 1.0));
                }
            }
        }

        // Status matching
        if self.idle_re.is_match(line) {
            self.current = SessionStatus::Idle;
            self.capturing_plan = false;
        } else if self.planning_re.is_match(line) {
            self.current = SessionStatus::Planning;
            self.capturing_plan = true;
            self.plan_lines.clear();
        } else if self.waiting_re.is_match(line) {
            self.current = SessionStatus::Waiting;
        }

        // Capture plan summary lines (first 3 non-empty lines after entering plan mode)
        if self.capturing_plan
            && self.current == SessionStatus::Planning
            && self.plan_lines.len() < 3
            && !self.planning_re.is_match(line)
        {
            self.plan_lines.push(line.to_string());
            self.extras.plan_summary = Some(self.plan_lines.join("\n"));
        }
    }
}
