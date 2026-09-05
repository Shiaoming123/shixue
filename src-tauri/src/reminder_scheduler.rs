use std::time::Duration;

use serde::Serialize;
use sqlx::{sqlite::SqliteConnectOptions, Row, SqlitePool};
use tauri::{Emitter, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyReminderRow {
    task_id: String,
    reminder_at: String,
    delivered_at: String,
}

/// Wake the capability worker; Rust never sends or writes a delivery ledger.
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let _ = app.emit("shixue://reminder-tick", ());
            tokio::time::sleep(Duration::from_secs(20)).await;
        }
    });
}

pub async fn read_legacy_reminder_deliveries(
    app: tauri::AppHandle,
) -> Result<Vec<LegacyReminderRow>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("study.db");
    if !path.exists() {
        return Ok(vec![]);
    }
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|error| error.to_string())?;
    let result = sqlx::query(
        "SELECT task_id, reminder_at, delivered_at FROM study_reminder_deliveries ORDER BY task_id",
    )
    .fetch_all(&pool)
    .await
    .map_err(|error| error.to_string())
    .and_then(|rows| {
        rows.into_iter()
            .map(|row| {
                Ok(LegacyReminderRow {
                    task_id: row.try_get(0).map_err(|error| error.to_string())?,
                    reminder_at: row.try_get(1).map_err(|error| error.to_string())?,
                    delivered_at: row.try_get(2).map_err(|error| error.to_string())?,
                })
            })
            .collect()
    });
    pool.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_bridge_uses_the_shared_dto_names() {
        let row = LegacyReminderRow {
            task_id: "task".into(),
            reminder_at: "raw-time".into(),
            delivered_at: "raw-ack".into(),
        };
        assert_eq!(
            serde_json::to_value(row).unwrap(),
            serde_json::json!({ "taskId": "task", "reminderAt": "raw-time", "deliveredAt": "raw-ack" })
        );
    }
}
