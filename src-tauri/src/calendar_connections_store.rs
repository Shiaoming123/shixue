use super::*;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    SqlitePool,
};
// ponytail: Sync is serialized across all connections; use per-connection/calendar locks when parallel sync is supported.
static SYNC_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    batch_id: String,
    provider: String,
    connection_id: String,
    calendar_id: String,
    source_id: String,
    mode: String,
    access: String,
    title: String,
    timezone: String,
    items: Vec<Value>,
}
#[derive(Default, Serialize, Deserialize)]
struct Checkpoint {
    cursor: Option<String>,
    pending: Option<Pending>,
    last_batch: Option<String>,
    last_receipt: Option<String>,
    last_identity: Option<Batch>,
}
#[derive(Serialize, Deserialize)]
struct Pending {
    batch: Batch,
    next_cursor: Option<String>,
}

pub(super) async fn database<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<SqlitePool, String> {
    // Matches tauri-plugin-sql's sqlite URL resolution. Never create a second workspace.
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "CONNECTOR_STORE_UNAVAILABLE")?
        .join("study.db");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .create_if_missing(false)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await
        .map_err(|_| "CONNECTOR_STORE_UNAVAILABLE")?;
    sqlx::query("CREATE TABLE IF NOT EXISTS calendar_connector_sync (owner TEXT NOT NULL, calendar TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(owner, calendar))")
        .execute(&pool).await.map_err(|_| "CONNECTOR_STORE_UNAVAILABLE")?;
    Ok(pool)
}
async fn load_checkpoint(
    pool: &SqlitePool,
    owner: &str,
    calendar: &str,
) -> Result<Checkpoint, String> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT payload FROM calendar_connector_sync WHERE owner=? AND calendar=?",
    )
    .bind(owner)
    .bind(calendar)
    .fetch_optional(pool)
    .await
    .map_err(|_| "CONNECTOR_READ_FAILED")?;
    value
        .map(|v| serde_json::from_str(&v).map_err(|_| "CONNECTOR_INVALID".into()))
        .unwrap_or(Ok(Checkpoint::default()))
}
pub(super) async fn workspace_payload(pool: &SqlitePool) -> Result<Value, String> {
    let payload: Option<String> =
        sqlx::query_scalar("SELECT payload FROM study_state WHERE id=1 AND version=4")
            .fetch_optional(pool)
            .await
            .map_err(|_| "WORKSPACE_READ_FAILED")?;
    match payload {
        Some(value) => serde_json::from_str(&value).map_err(|_| "WORKSPACE_INVALID".into()),
        None => Ok(Value::Null),
    }
}

#[cfg(feature = "calendar-writes")]
pub(super) const MAX_WORKSPACE_BYTES: usize = 16 * 1024 * 1024;

#[cfg(feature = "calendar-writes")]
#[allow(dead_code)] // Future trusted parser input only; existing readers keep their contract.
pub(super) async fn workspace_payload_v4_bytes(
    pool: &SqlitePool,
    expected: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    // One statement bounds the transfer and checks the row version without parsing JSON.
    let payload: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT CAST(payload AS BLOB) FROM study_state WHERE id=1 AND version=4 AND typeof(payload)='text' AND length(CAST(payload AS BLOB)) BETWEEN 1 AND ?",
    ).bind(MAX_WORKSPACE_BYTES as i64).fetch_optional(pool).await.map_err(|_| "WORKSPACE_READ_FAILED")?;
    let payload = payload.ok_or("WORKSPACE_ROW_INVALID")?;
    if expected.is_some_and(|value| value != payload) {
        return Err("WORKSPACE_STALE".into());
    }
    Ok(payload)
}

#[cfg(all(test, feature = "calendar-writes"))]
#[test]
fn raw_workspace_bytes_preserve_order_and_reject_stale_or_invalid_rows() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE study_state(id INTEGER PRIMARY KEY, version INTEGER, payload TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(workspace_payload_v4_bytes(&pool, None).await.is_err());
        let raw = r#"{ "version":4,"z":1,"a":2,"a":3 }"#;
        sqlx::query("INSERT INTO study_state VALUES(1,4,?)")
            .bind(raw)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            workspace_payload_v4_bytes(&pool, None).await.unwrap(),
            raw.as_bytes()
        );
        assert_eq!(
            workspace_payload_v4_bytes(&pool, Some(raw.as_bytes()))
                .await
                .unwrap(),
            raw.as_bytes()
        );
        sqlx::query("UPDATE study_state SET payload='{}'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            workspace_payload_v4_bytes(&pool, Some(raw.as_bytes()))
                .await
                .unwrap_err(),
            "WORKSPACE_STALE"
        );
        sqlx::query("UPDATE study_state SET version=3")
            .execute(&pool)
            .await
            .unwrap();
        assert!(workspace_payload_v4_bytes(&pool, None).await.is_err());
        sqlx::query("UPDATE study_state SET version=4,payload=zeroblob(16777217)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(workspace_payload_v4_bytes(&pool, None).await.is_err());
    });
}
fn cursor_is_backed(checkpoint: &Checkpoint, workspace: &Value) -> bool {
    checkpoint
        .last_identity
        .as_ref()
        .zip(checkpoint.last_receipt.as_deref())
        .is_some_and(|(batch, receipt)| verify_receipt(workspace, batch, receipt))
}
fn reusable_pending(checkpoint: &mut Checkpoint, workspace: &Value, access: &str) -> Option<Batch> {
    let pending = checkpoint.pending.as_ref()?;
    let applied = workspace["commandReceipts"]
        .as_array()
        .is_some_and(|receipts| {
            receipts.iter().any(|receipt| {
                receipt["id"]
                    .as_str()
                    .is_some_and(|id| verify_receipt(workspace, &pending.batch, id))
            })
        });
    if pending.batch.access == access
        && (pending.batch.mode == "full" || applied || cursor_is_backed(checkpoint, workspace))
    {
        return Some(pending.batch.clone());
    }
    // A changed permission needs a new receipt; an unbacked delta needs a full snapshot.
    checkpoint.pending = None;
    checkpoint.cursor = None;
    None
}
pub(super) async fn invalidate<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    owner: &str,
) -> Result<(), String> {
    let pool = database(app).await?;
    sqlx::query("DELETE FROM calendar_connector_sync WHERE owner=?")
        .bind(owner)
        .execute(&pool)
        .await
        .map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    Ok(())
}
fn encode(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(b) {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
pub(super) fn source_id(connection: &str, calendar: &str) -> String {
    format!(
        "calendar-provider:{}",
        encode(&json!(["google", connection, calendar]).to_string())
    )
}
fn valid_calendar(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 1024 || value.chars().any(char::is_control) {
        Err("CALENDAR_INVALID".into())
    } else {
        Ok(())
    }
}
pub(super) fn safe_event(value: &Value) -> Result<Value, String> {
    if value
        .get("id")
        .and_then(Value::as_str)
        .is_none_or(|v| v.is_empty() || v.len() > 1024)
    {
        return Err("EVENT_RESPONSE_INVALID".into());
    }
    let mut event = select(
        value,
        &[
            "id",
            "status",
            "summary",
            "description",
            "location",
            "htmlLink",
            "transparency",
            "created",
            "updated",
            "recurringEventId",
            "attendeesOmitted",
        ],
    );
    for field in ["start", "end", "originalStartTime"] {
        if let Some(time) = value.get(field) {
            event[field] = select(time, &["date", "dateTime", "timeZone"]);
        }
    }
    if let Some(organizer) = value.get("organizer") {
        event["organizer"] = select(organizer, &["email", "displayName"]);
    }
    if let Some(attendees) = value.get("attendees") {
        let attendees = attendees
            .as_array()
            .filter(|items| items.len() <= 1000)
            .ok_or("EVENT_RESPONSE_INVALID")?;
        event["attendees"] = Value::Array(
            attendees
                .iter()
                .map(|item| {
                    select(
                        item,
                        &[
                            "email",
                            "displayName",
                            "optional",
                            "responseStatus",
                            "resource",
                            "additionalGuests",
                        ],
                    )
                })
                .collect(),
        );
    }
    // select intentionally handles strings/bools only; this numeric completeness signal must survive too.
    if let Some(attendees) = value["attendees"].as_array() {
        for (index, item) in attendees.iter().enumerate() {
            if let Some(guests) = item.get("additionalGuests") {
                if guests.as_u64().is_none() {
                    return Err("EVENT_RESPONSE_INVALID".into());
                }
                event["attendees"][index]["additionalGuests"] = guests.clone();
            }
        }
    }
    // Preserve a safe refusal signal instead of silently discarding unrepresentable details.
    if ["conferenceData", "attachments", "extendedProperties"]
        .iter()
        .any(|field| value.get(*field).is_some())
        || value.get("attendeesOmitted") == Some(&Value::Bool(true))
    {
        event["unsupportedRecurrenceFields"] = Value::Bool(true);
    }
    if let Some(rules) = value.get("recurrence") {
        if !rules.as_array().is_some_and(|r| {
            r.len() <= 100
                && r.iter()
                    .all(|v| v.as_str().is_some_and(|s| s.len() <= 8192))
        }) {
            return Err("EVENT_RESPONSE_INVALID".into());
        }
        event["recurrence"] = rules.clone();
    }
    Ok(event)
}

#[tauri::command]
pub async fn stage_events<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    calendar_id: String,
) -> Result<Batch, String> {
    valid_calendar(&calendar_id)?;
    let owner = account(&config)?;
    let epoch = generation(&owner, false)?;
    let _guard = SYNC_GATE.lock().await;
    let pool = database(&app).await?;
    let mut checkpoint = load_checkpoint(&pool, &owner, &calendar_id).await?;
    // Permission is checked even for pending batches; offline errors must not expose old details.
    let calendars = list_calendars(Config {
        client_id: config.client_id.clone(),
        connection_id: config.connection_id.clone(),
    })
    .await?;
    let descriptor = calendars["items"].as_array().and_then(|items| {
        items
            .iter()
            .find(|item| item["id"].as_str() == Some(&calendar_id))
    });
    let access = match descriptor
        .filter(|v| v["deleted"] != true)
        .and_then(|v| v["accessRole"].as_str())
    {
        Some("reader" | "writer" | "owner") => "details",
        Some("freeBusyReader") => "freebusy",
        _ => "none",
    };
    let workspace = workspace_payload(&pool).await?;
    if generation(&owner, false)? != epoch {
        return Err("DISCONNECTED".into());
    }
    if let Some(batch) = reusable_pending(&mut checkpoint, &workspace, access) {
        return Ok(batch);
    }
    if checkpoint.cursor.is_some() && !cursor_is_backed(&checkpoint, &workspace) {
        checkpoint.cursor = None;
    }
    let mut batch = Batch {
        batch_id: format!("calendar-batch:{}", random()?),
        provider: "google".into(),
        connection_id: config.connection_id.clone(),
        calendar_id: calendar_id.clone(),
        source_id: source_id(&config.connection_id, &calendar_id),
        mode: if checkpoint.cursor.is_some() {
            "incremental"
        } else {
            "full"
        }
        .into(),
        access: access.into(),
        title: descriptor
            .and_then(|v| v["summary"].as_str())
            .unwrap_or("Google Calendar")
            .into(),
        timezone: descriptor
            .and_then(|v| v["timeZone"].as_str())
            .unwrap_or("UTC")
            .into(),
        items: vec![],
    };
    let mut next_cursor = None;
    if access == "details" {
        let path = format!("calendars/{}/events", encode(&calendar_id));
        let mut cursor = checkpoint.cursor.clone();
        let mut reset = false;
        'restart: loop {
            let mut page_token = String::new();
            let mut seen = HashSet::new();
            batch.items.clear();
            for page_number in 0..100 {
                let mut query = vec![
                    ("singleEvents", "false"),
                    ("showDeleted", "true"),
                    ("maxResults", "2500"),
                ];
                if let Some(value) = &cursor {
                    query.push(("syncToken", value));
                }
                if !page_token.is_empty() {
                    query.push(("pageToken", &page_token));
                }
                let page = match read_api(&config, &path, &query, None, EVENT_SCOPE).await {
                    Err(error) if error == "HTTP_ERROR:410" && !reset && cursor.is_some() => {
                        cursor = None;
                        reset = true;
                        batch.mode = "full".into();
                        continue 'restart;
                    }
                    value => value?,
                };
                for event in page
                    .get("items")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or(&[])
                {
                    batch.items.push(safe_event(event)?);
                }
                if batch.items.len() > 50_000
                    || serde_json::to_vec(&batch)
                        .map_err(|_| "BATCH_INVALID")?
                        .len()
                        > 32 * 1024 * 1024
                {
                    return Err("BATCH_TOO_LARGE".into());
                }
                match page
                    .get("nextPageToken")
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
                {
                    Some(next)
                        if page_number < 99
                            && next.len() <= 16_384
                            && seen.insert(next.to_owned()) =>
                    {
                        page_token = next.to_owned()
                    }
                    Some(_) => return Err("PAGINATION_INVALID".into()),
                    None => {
                        next_cursor = Some(
                            page.get("nextSyncToken")
                                .and_then(Value::as_str)
                                .filter(|v| !v.is_empty() && v.len() <= 16_384)
                                .ok_or("CURSOR_MISSING")?
                                .to_owned(),
                        );
                        break 'restart;
                    }
                }
            }
        }
    } else {
        batch.mode = "full".into();
    }
    if generation(&owner, false)? != epoch {
        return Err("DISCONNECTED".into());
    }
    checkpoint.pending = Some(Pending {
        batch: batch.clone(),
        next_cursor,
    });
    sqlx::query("INSERT INTO calendar_connector_sync(owner,calendar,payload) VALUES(?,?,?) ON CONFLICT(owner,calendar) DO UPDATE SET payload=excluded.payload")
        .bind(&owner).bind(&calendar_id).bind(serde_json::to_string(&checkpoint).map_err(|_| "BATCH_INVALID")?).execute(&pool).await.map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    Ok(batch)
}

#[tauri::command]
pub async fn read_staged<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    calendar_id: String,
    batch_id: String,
) -> Result<Batch, String> {
    let batch = stage_events(app, config, calendar_id).await?;
    // Revalidation can replace a stale batch. Never apply different facts under its old id.
    if batch.batch_id != batch_id {
        return Err("BATCH_NOT_FOUND".into());
    }
    Ok(batch)
}
fn verify_receipt(payload: &Value, batch: &Batch, receipt_id: &str) -> bool {
    payload["version"] == 4
        && payload["commandReceipts"]
            .as_array()
            .is_some_and(|receipts| {
                receipts.iter().any(|receipt| {
                    let data = &receipt["result"]["data"];
                    receipt["id"] == receipt_id
                        && receipt["idempotencyKey"] == batch.batch_id
                        && receipt["commandType"] == "calendar_external.apply"
                        && receipt["requestFingerprint"]
                            .as_str()
                            .is_some_and(|s| !s.is_empty())
                        && receipt["result"]["receiptId"] == receipt_id
                        && data["applied"] == true
                        && data["batchId"] == batch.batch_id
                        && data["provider"] == batch.provider
                        && data["connectionId"] == batch.connection_id
                        && data["calendarId"] == batch.calendar_id
                        && data["sourceId"] == batch.source_id
                        && data["mode"] == batch.mode
                })
            })
}
#[tauri::command]
pub async fn reset_sync<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    calendar_id: String,
    batch_id: String,
) -> Result<Value, String> {
    valid_calendar(&calendar_id)?;
    let owner = account(&config)?;
    let epoch = generation(&owner, false)?;
    let _guard = SYNC_GATE.lock().await;
    if generation(&owner, false)? != epoch || load(&owner)?.is_none() {
        return Err("DISCONNECTED".into());
    }
    let pool = database(&app).await?;
    commit_reset(
        &pool,
        &owner,
        &config.connection_id,
        &calendar_id,
        &batch_id,
        epoch,
    )
    .await
}
async fn commit_reset(
    pool: &SqlitePool,
    owner: &str,
    connection_id: &str,
    calendar_id: &str,
    batch_id: &str,
    epoch: u64,
) -> Result<Value, String> {
    let mut transaction = pool.begin().await.map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    let payload: Option<String> = sqlx::query_scalar(
        "SELECT payload FROM calendar_connector_sync WHERE owner=? AND calendar=?",
    )
    .bind(owner)
    .bind(calendar_id)
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| "CONNECTOR_READ_FAILED")?;
    let payload = payload.ok_or("BATCH_NOT_FOUND")?;
    let checkpoint: Checkpoint = serde_json::from_str(&payload).map_err(|_| "CONNECTOR_INVALID")?;
    let pending = checkpoint.pending.ok_or("BATCH_NOT_FOUND")?;
    if pending.batch.batch_id != batch_id
        || pending.batch.provider != "google"
        || pending.batch.connection_id != connection_id
        || pending.batch.calendar_id != calendar_id
        || pending.batch.source_id != source_id(connection_id, calendar_id)
    {
        return Err("BATCH_NOT_FOUND".into());
    }
    // Removing only this checkpoint clears its cursor, pending batch and last receipt proof.
    let result = sqlx::query(
        "DELETE FROM calendar_connector_sync WHERE owner=? AND calendar=? AND payload=?",
    )
    .bind(owner)
    .bind(calendar_id)
    .bind(payload)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    if result.rows_affected() != 1 || generation(owner, false)? != epoch {
        return Err("BATCH_INVALIDATED".into());
    }
    transaction
        .commit()
        .await
        .map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    Ok(json!({"reset":true}))
}
#[tauri::command]
pub async fn ack_events<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    calendar_id: String,
    batch_id: String,
    workspace_receipt_id: String,
) -> Result<Value, String> {
    let owner = account(&config)?;
    let _guard = SYNC_GATE.lock().await;
    let pool = database(&app).await?;
    let epoch = generation(&owner, false)?;
    if load(&owner)?.is_none() {
        return Err("DISCONNECTED".into());
    }
    commit_ack(
        &pool,
        &owner,
        &calendar_id,
        &batch_id,
        &workspace_receipt_id,
        epoch,
    )
    .await
}
async fn commit_ack(
    pool: &SqlitePool,
    owner: &str,
    calendar_id: &str,
    batch_id: &str,
    workspace_receipt_id: &str,
    epoch: u64,
) -> Result<Value, String> {
    let mut checkpoint = load_checkpoint(pool, owner, calendar_id).await?;
    if checkpoint.last_batch.as_deref() == Some(batch_id)
        && checkpoint.last_receipt.as_deref() == Some(workspace_receipt_id)
    {
        if !cursor_is_backed(&checkpoint, &workspace_payload(pool).await?) {
            return Err("WORKSPACE_RECEIPT_NOT_FOUND".into());
        }
        return Ok(json!({"applied":true,"batchId":batch_id}));
    }
    let pending = checkpoint
        .pending
        .as_ref()
        .filter(|p| p.batch.batch_id == batch_id)
        .ok_or("BATCH_NOT_FOUND")?;
    let mut transaction = pool.begin().await.map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    let payload: Option<String> =
        sqlx::query_scalar("SELECT payload FROM study_state WHERE id=1 AND version=4")
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|_| "WORKSPACE_READ_FAILED")?;
    if !payload
        .and_then(|p| serde_json::from_str::<Value>(&p).ok())
        .is_some_and(|p| verify_receipt(&p, &pending.batch, workspace_receipt_id))
    {
        return Err("WORKSPACE_RECEIPT_NOT_FOUND".into());
    }
    checkpoint.cursor = pending.next_cursor.clone();
    let mut identity = pending.batch.clone();
    identity.items.clear();
    checkpoint.last_identity = Some(identity);
    checkpoint.pending = None;
    checkpoint.last_batch = Some(batch_id.to_owned());
    checkpoint.last_receipt = Some(workspace_receipt_id.to_owned());
    let result =
        sqlx::query("UPDATE calendar_connector_sync SET payload=? WHERE owner=? AND calendar=?")
            .bind(serde_json::to_string(&checkpoint).map_err(|_| "BATCH_INVALID")?)
            .bind(owner)
            .bind(calendar_id)
            .execute(&mut *transaction)
            .await
            .map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    if result.rows_affected() != 1 || generation(owner, false)? != epoch {
        return Err("BATCH_INVALIDATED".into());
    }
    transaction
        .commit()
        .await
        .map_err(|_| "CONNECTOR_WRITE_FAILED")?;
    Ok(json!({"applied":true,"batchId":batch_id}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_fixture() -> Checkpoint {
        Checkpoint {
            cursor: Some("base-cursor".into()),
            pending: Some(Pending {
                batch: Batch {
                    batch_id: "b".into(),
                    provider: "google".into(),
                    connection_id: "c".into(),
                    calendar_id: "calendar".into(),
                    source_id: "s".into(),
                    mode: "incremental".into(),
                    access: "details".into(),
                    title: "Private calendar".into(),
                    timezone: "UTC".into(),
                    items: vec![json!({"id":"private-event","summary":"Private details"})],
                },
                next_cursor: Some("next-cursor".into()),
            }),
            ..Default::default()
        }
    }
    fn pending_receipt() -> Value {
        json!({"version":4,"commandReceipts":[{"id":"r","idempotencyKey":"b","requestFingerprint":"hash","commandType":"calendar_external.apply","result":{"receiptId":"r","data":{"applied":true,"batchId":"b","provider":"google","connectionId":"c","calendarId":"calendar","sourceId":"s","mode":"incremental"}}}]})
    }
    #[test]
    fn incomplete_participant_signals_survive_safe_ipc() {
        let safe=safe_event(&json!({"id":"e","attendeesOmitted":true,"attendees":[{"email":"a@example.com","additionalGuests":2,"resource":true}],"privateSecret":"drop"})).unwrap();
        assert_eq!(safe["attendeesOmitted"], true);
        assert_eq!(safe["attendees"][0]["additionalGuests"], 2);
        assert_eq!(safe["attendees"][0]["resource"], true);
        assert!(safe.get("privateSecret").is_none());
    }
    #[test]
    fn pending_permission_downgrade_never_returns_old_details_even_if_applied() {
        for access in ["freebusy", "none"] {
            let mut checkpoint = pending_fixture();
            assert!(reusable_pending(&mut checkpoint, &pending_receipt(), access).is_none());
            assert!(checkpoint.pending.is_none());
            assert!(checkpoint.cursor.is_none());
            assert!(!serde_json::to_string(&checkpoint)
                .unwrap()
                .contains("Private details"));
        }
    }
    #[test]
    fn restored_workspace_discards_unapplied_delta_but_keeps_applied_ack_recovery() {
        let mut checkpoint = pending_fixture();
        let restored = json!({"version":4,"commandReceipts":[],"calendarEvents":[]});
        let before = restored.clone();
        assert!(reusable_pending(&mut checkpoint, &restored, "details").is_none());
        assert!(
            checkpoint.cursor.is_none(),
            "No base receipt means the next request must be full"
        );
        assert_eq!(
            restored, before,
            "Recovery cannot mutate workspace before complete fetch"
        );
        let mut checkpoint = pending_fixture();
        assert_eq!(
            reusable_pending(&mut checkpoint, &pending_receipt(), "details")
                .unwrap()
                .batch_id,
            "b"
        );
        assert_eq!(checkpoint.cursor.as_deref(), Some("base-cursor"));
    }
    #[test]
    fn pending_full_or_receipt_backed_delta_remains_reusable() {
        let mut checkpoint = pending_fixture();
        checkpoint.pending.as_mut().unwrap().batch.mode = "full".into();
        assert!(reusable_pending(&mut checkpoint, &Value::Null, "details").is_some());
        let mut checkpoint = pending_fixture();
        checkpoint.last_identity = Some(checkpoint.pending.as_ref().unwrap().batch.clone());
        checkpoint.last_identity.as_mut().unwrap().batch_id = "base-batch".into();
        checkpoint.last_receipt = Some("r".into());
        let mut workspace = pending_receipt();
        workspace["commandReceipts"][0]["idempotencyKey"] = json!("base-batch");
        workspace["commandReceipts"][0]["result"]["data"]["batchId"] = json!("base-batch");
        assert!(reusable_pending(&mut checkpoint, &workspace, "details").is_some());
    }
    #[test]
    fn sqlite_reset_requires_current_batch_and_preserves_other_sources_and_workspace() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query(
                "CREATE TABLE calendar_connector_sync(owner TEXT, calendar TEXT, payload TEXT)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query("CREATE TABLE study_state(payload TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO study_state VALUES('workspace-facts')")
                .execute(&pool)
                .await
                .unwrap();
            let batch = Batch {
                batch_id: "b".into(),
                provider: "google".into(),
                connection_id: "c".into(),
                calendar_id: "calendar".into(),
                source_id: source_id("c", "calendar"),
                mode: "incremental".into(),
                access: "details".into(),
                title: "x".into(),
                timezone: "UTC".into(),
                items: vec![],
            };
            let checkpoint = Checkpoint {
                cursor: Some("old".into()),
                pending: Some(Pending {
                    batch: batch.clone(),
                    next_cursor: Some("new".into()),
                }),
                last_batch: Some("old-b".into()),
                last_receipt: Some("old-r".into()),
                last_identity: Some(batch),
            };
            let payload = serde_json::to_string(&checkpoint).unwrap();
            for (owner, calendar) in [
                ("reset-test", "calendar"),
                ("reset-test", "other"),
                ("other-owner", "calendar"),
            ] {
                sqlx::query("INSERT INTO calendar_connector_sync VALUES(?,?,?)")
                    .bind(owner)
                    .bind(calendar)
                    .bind(&payload)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            let epoch = generation("reset-test", false).unwrap();
            assert_eq!(
                commit_reset(&pool, "reset-test", "c", "calendar", "wrong", epoch).await,
                Err("BATCH_NOT_FOUND".into())
            );
            assert_eq!(
                commit_reset(&pool, "reset-test", "wrong", "calendar", "b", epoch).await,
                Err("BATCH_NOT_FOUND".into())
            );
            generation("reset-test", true).unwrap();
            assert_eq!(
                commit_reset(&pool, "reset-test", "c", "calendar", "b", epoch).await,
                Err("BATCH_INVALIDATED".into())
            );
            assert_eq!(
                serde_json::to_string(
                    &load_checkpoint(&pool, "reset-test", "calendar")
                        .await
                        .unwrap()
                )
                .unwrap(),
                payload
            );
            assert_eq!(
                commit_reset(&pool, "reset-test", "c", "calendar", "b", epoch + 1)
                    .await
                    .unwrap(),
                json!({"reset":true})
            );
            assert_eq!(
                serde_json::to_value(
                    load_checkpoint(&pool, "reset-test", "calendar")
                        .await
                        .unwrap()
                )
                .unwrap(),
                serde_json::to_value(Checkpoint::default()).unwrap()
            );
            for (owner, calendar) in [("reset-test", "other"), ("other-owner", "calendar")] {
                assert_eq!(
                    serde_json::to_string(&load_checkpoint(&pool, owner, calendar).await.unwrap())
                        .unwrap(),
                    payload
                );
            }
            let workspace: String = sqlx::query_scalar("SELECT payload FROM study_state")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(workspace, "workspace-facts");
            assert_eq!(
                commit_reset(&pool, "reset-test", "c", "calendar", "b", epoch + 1).await,
                Err("BATCH_NOT_FOUND".into())
            );
        });
    }
    #[test]
    fn sqlite_ack_requires_durable_receipt_and_keeps_pending_after_failure() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query(
                "CREATE TABLE study_state(id INTEGER PRIMARY KEY, version INTEGER, payload TEXT)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "CREATE TABLE calendar_connector_sync(owner TEXT, calendar TEXT, payload TEXT)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let batch = Batch {
                batch_id: "b".into(),
                provider: "google".into(),
                connection_id: "c".into(),
                calendar_id: "calendar".into(),
                source_id: "s".into(),
                mode: "full".into(),
                access: "details".into(),
                title: "x".into(),
                timezone: "UTC".into(),
                items: vec![],
            };
            let checkpoint = Checkpoint {
                cursor: Some("old".into()),
                pending: Some(Pending {
                    batch,
                    next_cursor: Some("new".into()),
                }),
                ..Default::default()
            };
            sqlx::query("INSERT INTO calendar_connector_sync VALUES('test','calendar',?)")
                .bind(serde_json::to_string(&checkpoint).unwrap())
                .execute(&pool)
                .await
                .unwrap();
            let missing = json!({"version":4,"commandReceipts":[]}).to_string();
            sqlx::query("INSERT INTO study_state VALUES(1,4,?)")
                .bind(&missing)
                .execute(&pool)
                .await
                .unwrap();
            assert!(commit_ack(&pool, "test", "calendar", "b", "r", 0)
                .await
                .is_err());
            let unchanged = load_checkpoint(&pool, "test", "calendar").await.unwrap();
            assert_eq!(unchanged.cursor.as_deref(), Some("old"));
            assert!(unchanged.pending.is_some());
            let payload = json!({"version":4,"commandReceipts":[{"id":"r","idempotencyKey":"b","requestFingerprint":"hash","commandType":"calendar_external.apply","result":{"receiptId":"r","data":{"applied":true,"batchId":"b","provider":"google","connectionId":"c","calendarId":"calendar","sourceId":"s","mode":"full"}}}]}).to_string();
            sqlx::query("UPDATE study_state SET payload=? WHERE id=1")
                .bind(&payload)
                .execute(&pool)
                .await
                .unwrap();
            commit_ack(&pool, "test", "calendar", "b", "r", 0)
                .await
                .unwrap();
            let committed = load_checkpoint(&pool, "test", "calendar").await.unwrap();
            assert_eq!(committed.cursor.as_deref(), Some("new"));
            assert!(committed.pending.is_none());
            commit_ack(&pool, "test", "calendar", "b", "r", 0)
                .await
                .unwrap();
            let workspace: String =
                sqlx::query_scalar("SELECT payload FROM study_state WHERE id=1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                workspace, payload,
                "Connector acknowledgment must never write workspace facts"
            );
            sqlx::query("UPDATE study_state SET payload=? WHERE id=1")
                .bind(&missing)
                .execute(&pool)
                .await
                .unwrap();
            assert!(
                !cursor_is_backed(&committed, &workspace_payload(&pool).await.unwrap()),
                "Restored snapshots and pruned receipts require a new full sync"
            );
            assert!(
                commit_ack(&pool, "test", "calendar", "b", "r", 0)
                    .await
                    .is_err(),
                "A replay cannot falsely confirm an acknowledgment after Workspace restore"
            );
        });
    }
    #[test]
    fn source_identity_matches_js_and_safe_events_strip_provider_cursors() {
        assert_eq!(
            source_id("c", "a@b"),
            "calendar-provider:%5B%22google%22%2C%22c%22%2C%22a%40b%22%5D"
        );
        let event =
            safe_event(&json!({"id":"e", "status":"cancelled", "nextSyncToken":"sensitive"}))
                .unwrap();
        assert_eq!(event, json!({"id":"e","status":"cancelled"}));
    }
    #[test]
    fn receipt_requires_real_batch_identity_and_success() {
        let batch = Batch {
            batch_id: "b".into(),
            provider: "google".into(),
            connection_id: "c".into(),
            calendar_id: "calendar".into(),
            source_id: "s".into(),
            mode: "full".into(),
            access: "details".into(),
            title: "x".into(),
            timezone: "UTC".into(),
            items: vec![],
        };
        let mut payload = json!({"version":4,"commandReceipts":[{"id":"r","idempotencyKey":"b","requestFingerprint":"hash","commandType":"calendar_external.apply","result":{"receiptId":"r","data":{"applied":true,"batchId":"b","provider":"google","connectionId":"c","calendarId":"calendar","sourceId":"s","mode":"full"}}}]});
        assert!(verify_receipt(&payload, &batch, "r"));
        payload["commandReceipts"][0]["result"]["data"]["calendarId"] = json!("another");
        assert!(!verify_receipt(&payload, &batch, "r"));
        assert!(!verify_receipt(
            &json!({"version":4,"commandReceipts":[]}),
            &batch,
            "r"
        ));
    }
}
