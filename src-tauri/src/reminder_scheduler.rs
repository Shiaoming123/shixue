use std::{path::Path, time::Duration};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{sqlite::SqliteConnectOptions, Row, SqlitePool};
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

#[derive(Debug, Deserialize)]
struct StudySnapshot {
    #[serde(default)]
    tasks: Vec<ReminderTask>,
    #[serde(default, rename = "reminderRules")]
    reminder_rules: Vec<ReminderRule>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct ReminderTask {
    id: String,
    title: String,
    status: String,
    #[serde(rename = "reminderAt")]
    reminder_at: Option<String>,
    #[serde(rename = "deletedAt")]
    deleted_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct ReminderRule {
    #[serde(rename = "taskId")]
    task_id: String,
    #[serde(rename = "occurrenceId")]
    occurrence_id: Option<String>,
    trigger: ReminderTrigger,
    enabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
struct ReminderTrigger {
    kind: String,
    at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DueReminder {
    task: ReminderTask,
    reminder_at: String,
}

pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(error) = deliver_due(&app).await {
                eprintln!("[reminders] background check skipped: {error}");
            }
            tokio::time::sleep(Duration::from_secs(20)).await;
        }
    });
}

async fn deliver_due(app: &tauri::AppHandle) -> Result<(), String> {
    let database_path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("study.db");
    if !database_path.exists() {
        return Ok(());
    }

    let pool = open_database(&database_path).await?;
    let payload = sqlx::query_scalar::<_, String>("SELECT payload FROM study_state WHERE id = 1")
        .fetch_optional(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let Some(payload) = payload else {
        pool.close().await;
        return Ok(());
    };
    let snapshot: StudySnapshot =
        serde_json::from_str(&payload).map_err(|error| error.to_string())?;

    for reminder in due_reminders(snapshot, Utc::now()) {
        let task = reminder.task;
        let reminder_at = reminder.reminder_at;
        let delivered =
            sqlx::query("SELECT reminder_at FROM study_reminder_deliveries WHERE task_id = ?")
                .bind(&task.id)
                .fetch_optional(&pool)
                .await
                .map_err(|error| error.to_string())?
                .and_then(|row| row.try_get::<String, _>(0).ok());
        if delivered.as_deref() == Some(reminder_at.as_str()) {
            continue;
        }

        app.notification()
            .builder()
            .title("拾学")
            .body(&task.title)
            .show()
            .map_err(|error| error.to_string())?;
        sqlx::query(
            "INSERT INTO study_reminder_deliveries (task_id, reminder_at, delivered_at) VALUES (?, ?, ?) \
             ON CONFLICT(task_id) DO UPDATE SET reminder_at = excluded.reminder_at, delivered_at = excluded.delivered_at",
        )
        .bind(&task.id)
        .bind(&reminder_at)
        .bind(Utc::now().to_rfc3339())
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    }
    pool.close().await;
    Ok(())
}

async fn open_database(path: &Path) -> Result<SqlitePool, String> {
    let options = SqliteConnectOptions::new().filename(path);
    SqlitePool::connect_with(options)
        .await
        .map_err(|error| error.to_string())
}

fn due_reminders(snapshot: StudySnapshot, now: DateTime<Utc>) -> Vec<DueReminder> {
    let mut due = snapshot
        .tasks
        .into_iter()
        .filter_map(|task| {
            if task.deleted_at.is_some() || task.status == "completed" || task.status == "cancelled"
            {
                return None;
            }
            let reminder_at = snapshot
                .reminder_rules
                .iter()
                .find(|rule| {
                    rule.task_id == task.id
                        && rule.enabled
                        && rule.occurrence_id.is_none()
                        && rule.trigger.kind == "absolute"
                })
                .and_then(|rule| rule.trigger.at.clone())
                .or_else(|| task.reminder_at.clone())?;
            DateTime::parse_from_rfc3339(&reminder_at)
                .ok()
                .filter(|instant| instant.with_timezone(&Utc) <= now)
                .map(|_| DueReminder { task, reminder_at })
        })
        .collect::<Vec<_>>();
    due.sort_by(|left, right| {
        left.reminder_at
            .cmp(&right.reminder_at)
            .then(left.task.id.cmp(&right.task.id))
    });
    due
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn due_selection_uses_real_instants_and_excludes_inactive_tasks() {
        let tasks = vec![
            task("due", "2026-09-04T10:00:00+08:00", "planned", None),
            task("future", "2026-09-04T10:01:00+08:00", "planned", None),
            task("done", "2026-09-04T01:00:00Z", "completed", None),
            task("deleted", "2026-09-04T01:00:00Z", "planned", Some("now")),
        ];
        let now = DateTime::parse_from_rfc3339("2026-09-04T02:00:30Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            due_reminders(
                StudySnapshot {
                    tasks,
                    reminder_rules: vec![]
                },
                now
            )
            .into_iter()
            .map(|reminder| reminder.task.id)
            .collect::<Vec<_>>(),
            vec!["due"]
        );
    }

    fn task(id: &str, reminder_at: &str, status: &str, deleted_at: Option<&str>) -> ReminderTask {
        ReminderTask {
            id: id.into(),
            title: id.into(),
            status: status.into(),
            reminder_at: Some(reminder_at.into()),
            deleted_at: deleted_at.map(str::to_owned),
        }
    }
}
