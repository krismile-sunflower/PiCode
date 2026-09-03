//! Scheduled prompts ("automations").
//!
//! PiCode is already a resident desktop app with a tray, notifications and a
//! managed Pi process, so the marginal cost of "run this prompt on a schedule"
//! is small — and it is the one thing a terminal-only workflow cannot give
//! you: work that happened while nobody was at the keyboard.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::AppState;

/// How often the scheduler wakes up to look for due work.
const TICK_SECONDS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    /// Project the prompt runs in. Empty means "whatever is active".
    #[serde(default)]
    pub project_path: String,
    /// `interval` uses `minutes`; `daily` uses `time` (local `HH:MM`).
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub minutes: u32,
    #[serde(default)]
    pub time: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Epoch millis of the last successful run.
    #[serde(default)]
    pub last_run_at: u64,
    #[serde(default)]
    pub last_status: String,
}

fn default_kind() -> String {
    "interval".to_string()
}

fn default_true() -> bool {
    true
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

/// Minutes elapsed today in local time, or `None` when it cannot be derived.
///
/// Deriving local time without a date library means reading the offset once
/// from the platform; `time` is only used for the daily schedule, so an
/// unavailable offset simply disables that schedule kind rather than guessing.
fn local_minutes_of_day(now_ms: u64, offset_minutes: i32) -> u32 {
    let total_minutes = (now_ms / 60_000) as i64 + offset_minutes as i64;
    let minutes = total_minutes.rem_euclid(1_440);
    minutes as u32
}

/// Parse `HH:MM` into minutes since midnight.
pub fn parse_time_of_day(value: &str) -> Option<u32> {
    let (hours, minutes) = value.split_once(':')?;
    let hours: u32 = hours.trim().parse().ok()?;
    let minutes: u32 = minutes.trim().parse().ok()?;
    if hours > 23 || minutes > 59 {
        return None;
    }
    Some(hours * 60 + minutes)
}

/// Whether an automation should run now.
///
/// Daily schedules fire once inside a tick-sized window after their time, and
/// only if they have not already run since that moment today — a missed tick
/// must not turn into a burst of catch-up runs.
pub fn is_due(automation: &Automation, now_ms: u64, offset_minutes: i32) -> bool {
    if !automation.enabled || automation.prompt.trim().is_empty() {
        return false;
    }
    match automation.kind.as_str() {
        "interval" => {
            let minutes = automation.minutes.max(1) as u64;
            now_ms.saturating_sub(automation.last_run_at) >= minutes * 60_000
        }
        "daily" => {
            let Some(target) = parse_time_of_day(&automation.time) else {
                return false;
            };
            let current = local_minutes_of_day(now_ms, offset_minutes);
            if current < target || current >= target + 5 {
                return false;
            }
            // Already ran within this window today.
            now_ms.saturating_sub(automation.last_run_at) > 6 * 60_000
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn list_automations() -> Result<Vec<Automation>, String> {
    Ok(crate::settings::load_automations())
}

#[tauri::command]
pub async fn save_automations(automations: Vec<Automation>) -> Result<Vec<Automation>, String> {
    for automation in &automations {
        if automation.id.trim().is_empty() {
            return Err("定时任务缺少 id。".to_string());
        }
        if automation.kind == "daily" && parse_time_of_day(&automation.time).is_none() {
            return Err(format!("定时任务「{}」的时间格式应为 HH:MM。", automation.name));
        }
        if automation.kind == "interval" && automation.minutes == 0 {
            return Err(format!("定时任务「{}」的间隔至少为 1 分钟。", automation.name));
        }
    }
    crate::settings::save_automations(&automations)?;
    Ok(automations)
}

/// Run one automation immediately, regardless of its schedule.
#[tauri::command]
pub async fn run_automation(app: AppHandle, id: String) -> Result<(), String> {
    let mut automations = crate::settings::load_automations();
    let automation = automations
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .ok_or_else(|| "找不到该定时任务。".to_string())?;
    let outcome = dispatch(&app, &automation).await;
    record_outcome(&mut automations, &id, &outcome);
    crate::settings::save_automations(&automations)?;
    outcome
}

fn record_outcome(automations: &mut [Automation], id: &str, outcome: &Result<(), String>) {
    if let Some(item) = automations.iter_mut().find(|item| item.id == id) {
        item.last_run_at = now_millis();
        item.last_status = match outcome {
            Ok(()) => "ok".to_string(),
            Err(error) => format!("error: {error}"),
        };
    }
}

/// Send the automation's prompt to Pi, starting the project if needed.
async fn dispatch(app: &AppHandle, automation: &Automation) -> Result<(), String> {
    let state = app.state::<AppState>();
    let project_path = if automation.project_path.trim().is_empty() {
        state
            .active_instance
            .lock()
            .map_err(|_| "状态锁不可用".to_string())?
            .as_ref()
            .map(|instance| instance.project_path.clone())
            .unwrap_or_default()
    } else {
        automation.project_path.clone()
    };
    if project_path.trim().is_empty() {
        return Err("没有可用的项目路径。".to_string());
    }

    let instance = crate::commands::sidecar::start_pi_process(
        app.clone(),
        app.state::<AppState>(),
        crate::commands::sidecar::StartPiRequest {
            path: Some(project_path.clone()),
            no_folder: Some(false),
            port: None,
        },
    )
    .await?;

    let response = crate::rpc::client::request_rpc(
        &app.state::<AppState>(),
        Some(instance.pid),
        json!({ "type": "prompt", "message": automation.prompt, "streamingBehavior": "followUp" }),
    )
    .await?;
    if response.get("success").and_then(|value| value.as_bool()) == Some(false) {
        return Err(response
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Pi 拒绝了该请求")
            .to_string());
    }

    crate::audit::ok(
        "automation.run",
        json!({ "id": automation.id, "name": automation.name, "projectPath": project_path }),
    );
    let _ = app.emit("picode-automation", json!({ "id": automation.id, "name": automation.name }));
    let _ = app
        .notification()
        .builder()
        .title("PiCode 定时任务")
        .body(format!("已运行「{}」", automation.name))
        .auto_cancel()
        .show();
    Ok(())
}

/// Start the background scheduler. Ticks are cheap: it only reads settings.
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(TICK_SECONDS)).await;
            let mut automations = crate::settings::load_automations();
            if automations.is_empty() {
                continue;
            }
            let offset = crate::settings::local_utc_offset_minutes();
            let now = now_millis();
            let due = automations
                .iter()
                .filter(|automation| is_due(automation, now, offset))
                .map(|automation| automation.id.clone())
                .collect::<Vec<_>>();
            if due.is_empty() {
                continue;
            }
            for id in due {
                let Some(automation) = automations.iter().find(|item| item.id == id).cloned() else {
                    continue;
                };
                let outcome = dispatch(&app, &automation).await;
                if let Err(error) = &outcome {
                    crate::settings::append_desktop_log(format!(
                        "automation {} failed: {error}",
                        automation.name
                    ));
                }
                record_outcome(&mut automations, &id, &outcome);
            }
            let _ = crate::settings::save_automations(&automations);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn automation(kind: &str) -> Automation {
        Automation {
            id: "a".into(),
            name: "daily brief".into(),
            prompt: "总结今天的改动".into(),
            project_path: String::new(),
            kind: kind.into(),
            minutes: 60,
            time: "09:00".into(),
            enabled: true,
            last_run_at: 0,
            last_status: String::new(),
        }
    }

    #[test]
    fn interval_schedules_wait_for_their_full_period() {
        let mut item = automation("interval");
        item.last_run_at = 1_000_000;
        assert!(!is_due(&item, 1_000_000 + 59 * 60_000, 0));
        assert!(is_due(&item, 1_000_000 + 60 * 60_000, 0));
    }

    #[test]
    fn disabled_or_empty_automations_never_run() {
        let mut item = automation("interval");
        item.enabled = false;
        assert!(!is_due(&item, u64::MAX / 2, 0));
        let mut blank = automation("interval");
        blank.prompt = "   ".into();
        assert!(!is_due(&blank, u64::MAX / 2, 0));
    }

    #[test]
    fn daily_schedules_fire_once_inside_their_window() {
        let item = automation("daily");
        // 09:00 UTC on an arbitrary day.
        let nine_am = 9 * 60 * 60_000;
        assert!(is_due(&item, nine_am, 0));
        assert!(!is_due(&item, nine_am - 60_000, 0), "before the target time");
        assert!(!is_due(&item, nine_am + 6 * 60_000, 0), "after the window");

        let mut ran = automation("daily");
        ran.last_run_at = nine_am;
        assert!(!is_due(&ran, nine_am + 60_000, 0), "already ran this window");
    }

    #[test]
    fn time_of_day_parsing_rejects_nonsense() {
        assert_eq!(parse_time_of_day("09:30"), Some(570));
        assert_eq!(parse_time_of_day("00:00"), Some(0));
        assert_eq!(parse_time_of_day("24:00"), None);
        assert_eq!(parse_time_of_day("9"), None);
        assert_eq!(parse_time_of_day("09:60"), None);
    }
}
