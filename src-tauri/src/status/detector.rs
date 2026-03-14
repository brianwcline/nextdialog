use std::time::Instant;

use regex::Regex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Stopped,
    Starting,
    Idle,
    Working,
    Planning,
    Waiting,
    Error,
}

pub struct StatusDetector {
    current: SessionStatus,
    last_output_time: Instant,
    line_buffer: String,
    idle_re: Regex,
    waiting_re: Regex,
    error_re: Regex,
    planning_re: Regex,
}

impl StatusDetector {
    pub fn new() -> Self {
        Self {
            current: SessionStatus::Starting,
            last_output_time: Instant::now(),
            line_buffer: String::new(),
            idle_re: Regex::new(r"^[>❯]\s*$").unwrap(),
            waiting_re: Regex::new(r"\?\s*$|\(y/n\)|\(Y/n\)|\[Y/n\]|\[y/N\]").unwrap(),
            error_re: Regex::new(r"(?i)Error:|ERROR|panic").unwrap(),
            planning_re: Regex::new(r"(?i)plan mode").unwrap(),
        }
    }

    pub fn current(&self) -> SessionStatus {
        self.current
    }

    pub fn last_output_time(&self) -> Instant {
        self.last_output_time
    }

    /// Process raw bytes from PTY. Returns Some(new_status) on transition.
    pub fn process_bytes(&mut self, data: &[u8]) -> Option<SessionStatus> {
        self.last_output_time = Instant::now();

        // Strip ANSI escapes
        let stripped = strip_ansi_escapes::strip(data);
        let text = String::from_utf8_lossy(&stripped);

        let prev = self.current;

        // Set working since we're receiving output
        if self.current != SessionStatus::Working
            && self.current != SessionStatus::Error
        {
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
    pub fn check_silence(&mut self, threshold_secs: f64) -> Option<SessionStatus> {
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

        if self.idle_re.is_match(line) {
            self.current = SessionStatus::Idle;
        } else if self.planning_re.is_match(line) {
            self.current = SessionStatus::Planning;
        } else if self.waiting_re.is_match(line) {
            self.current = SessionStatus::Waiting;
        } else if self.error_re.is_match(line) {
            self.current = SessionStatus::Error;
        }
    }
}
