//! Append-only audit trail for security-relevant actions.
//!
//! Every destructive or privilege-granting operation the desktop shell performs
//! on the user's behalf lands here as one JSON object per line, so a user can
//! reconstruct what the agent (or the GUI) actually did. The log is best-effort:
//! auditing must never fail the operation it is describing, but a failed write
//! is itself recorded in the startup log.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::settings;

/// Keep the trail bounded so a long-lived install cannot fill the disk.
const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;

pub fn audit_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("pi-studio").join("logs"))
}

fn audit_path() -> Option<PathBuf> {
    audit_dir().map(|dir| dir.join("audit.jsonl"))
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// Record one audited action. `outcome` is `"ok"` or `"denied"`/`"error"`.
pub fn record(action: &str, outcome: &str, detail: Value) {
    let Some(path) = audit_path() else {
        return;
    };
    let Some(dir) = path.parent().map(PathBuf::from) else {
        return;
    };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    rotate_if_needed(&path);

    let entry = json!({
        "ts": now_millis(),
        "action": action,
        "outcome": outcome,
        "pid": std::process::id(),
        "detail": detail,
    });
    let Ok(line) = serde_json::to_string(&entry) else {
        return;
    };
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(error) = writeln!(file, "{line}") {
                settings::append_desktop_log(format!("audit write failed: {error}"));
            }
        }
        Err(error) => settings::append_desktop_log(format!("audit open failed: {error}")),
    }
}

pub fn ok(action: &str, detail: Value) {
    record(action, "ok", detail);
}

pub fn denied(action: &str, reason: &str, detail: Value) {
    record(
        action,
        "denied",
        json!({ "reason": reason, "context": detail }),
    );
}

fn rotate_if_needed(path: &PathBuf) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.len() < MAX_LOG_BYTES {
        return;
    }
    let _ = fs::rename(path, path.with_extension("jsonl.1"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_path_lives_under_the_app_config_directory() {
        if let Some(path) = audit_path() {
            assert!(path.ends_with("pi-studio/logs/audit.jsonl") || path.ends_with("audit.jsonl"));
        }
    }
}
