//! Device persistence only. These WebView-supplied records are never authority to send provider writes.
use super::*;
use sqlx::SqlitePool;
#[path = "calendar_write_future.rs"]
pub(super) mod future;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Operation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    future: Option<Value>,
    preview: Value,
    version: u64,
    state: String,
    outcome_unknown: bool,
    attempts: u64,
    lease_id: Option<String>,
    lease_until: u64,
    error: Option<String>,
    result: Option<Value>,
    local_applied: bool,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Insert {
        operation: Operation,
    },
    Get {
        id: String,
    },
    List,
    Claim {
        id: String,
        version: u64,
        #[serde(rename = "leaseId")]
        lease_id: String,
        now: u64,
        #[serde(rename = "leaseUntil")]
        lease_until: u64,
    },
    Cas {
        id: String,
        version: u64,
        next: Operation,
    },
}
fn text_field<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value[field]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 4096 && !s.chars().any(char::is_control))
        .ok_or("OUTBOX_INVALID".into())
}
fn validate(operation: &Operation) -> Result<(), String> {
    if operation.version == 0
        || operation.version > 9_007_199_254_740_990
        || !["pending", "applying", "applied", "conflict", "failed"]
            .contains(&operation.state.as_str())
        || operation.lease_until > 9_007_199_254_740_991
        || operation.attempts > 1_000_000
    {
        return Err("OUTBOX_INVALID".into());
    }
    let preview = operation.preview.as_object().ok_or("OUTBOX_INVALID")?;
    if !(preview.len() == 7 || preview.len() == 8)
        || preview.keys().any(|k| {
            ![
                "operationId",
                "connectionId",
                "calendarId",
                "eventId",
                "sendUpdates",
                "intent",
                "hash",
                "lockKeys",
            ]
            .contains(&k.as_str())
        })
    {
        return Err("OUTBOX_INVALID".into());
    }
    for field in [
        "operationId",
        "connectionId",
        "calendarId",
        "eventId",
        "hash",
    ] {
        text_field(&operation.preview, field)?;
    }
    if !["all", "externalOnly", "none"].contains(&text_field(&operation.preview, "sendUpdates")?) {
        return Err("OUTBOX_INVALID".into());
    }
    if serde_json::to_vec(operation)
        .map_err(|_| "OUTBOX_INVALID")?
        .len()
        > 1_048_576
    {
        return Err("OUTBOX_TOO_LARGE".into());
    }
    let intent = &operation.preview["intent"];
    let kind = text_field(intent, "kind")?;
    let allowed: &[&str] = match kind {
        "create" => &["kind", "fields"],
        "update" => &["kind", "eventId", "etag", "fields"],
        "cancel" | "delete" => &["kind", "eventId", "etag"],
        "rsvp" => &["kind", "eventId", "etag", "selfEmail", "response"],
        "recurring.single" => match text_field(intent, "action")? {
            "update" => &[
                "kind",
                "parent",
                "originalStart",
                "instance",
                "action",
                "fields",
            ],
            "cancel" => &["kind", "parent", "originalStart", "instance", "action"],
            _ => return Err("OUTBOX_INVALID".into()),
        },
        "recurring.series" => match text_field(intent, "action")? {
            "update" => &["kind", "parent", "action", "fields", "recurrence"],
            "cancel" => &["kind", "parent", "action"],
            _ => return Err("OUTBOX_INVALID".into()),
        },
        "recurring.future" => &["kind", "parent", "originalStart", "fields", "plan"],
        _ => return Err("OUTBOX_INVALID".into()),
    };
    allow_fields(intent, allowed)?;
    if kind == "recurring.future" {
        future::validate(
            &operation.preview,
            operation.future.as_ref().ok_or("OUTBOX_INVALID")?,
        )?;
        if operation.local_applied {
            return Err("OUTBOX_INVALID".into());
        }
    } else if operation.future.is_some() {
        return Err("OUTBOX_INVALID".into());
    }
    if kind != "create" && !kind.starts_with("recurring.") {
        if text_field(intent, "eventId")? != text_field(&operation.preview, "eventId")? {
            return Err("OUTBOX_INVALID".into());
        }
        text_field(intent, "etag")?;
    }
    if kind == "rsvp" {
        text_field(intent, "selfEmail")?;
        if !["accepted", "declined", "tentative"].contains(&text_field(intent, "response")?) {
            return Err("OUTBOX_INVALID".into());
        }
    }
    if kind.starts_with("recurring.") {
        for name in if kind == "recurring.single" {
            ["parent", "instance"]
        } else {
            ["parent", "parent"]
        } {
            allow_fields(&intent[name], &["eventId", "etag"])?;
            text_field(&intent[name], "eventId")?;
            text_field(&intent[name], "etag")?;
        }
        if kind == "recurring.single" {
            text_field(intent, "originalStart")?;
        }
    }
    if kind == "create"
        || kind == "update"
        || (kind == "recurring.single" && intent["action"] == "update")
        || (kind == "recurring.series" && intent["action"] == "update")
    {
        let fields = &intent["fields"];
        allow_fields(fields, &["title", "time", "attendees"])?;
        if let Some(title) = fields.get("title") {
            if !title.is_string() {
                return Err("OUTBOX_INVALID".into());
            }
        }
        if let Some(time) = fields.get("time") {
            match text_field(time, "kind")? {
                "all-day" => {
                    allow_fields(time, &["kind", "startOn", "endOnExclusive"])?;
                    text_field(time, "startOn")?;
                    text_field(time, "endOnExclusive")?;
                }
                "fixed" => {
                    allow_fields(time, &["kind", "startAt", "endAt", "timezone"])?;
                    for field in ["startAt", "endAt", "timezone"] {
                        text_field(time, field)?;
                    }
                }
                _ => return Err("OUTBOX_INVALID".into()),
            }
        }
        if let Some(attendees) = fields.get("attendees") {
            if kind != "create" {
                return Err("OUTBOX_INVALID".into());
            }
            let attendees = attendees
                .as_array()
                .filter(|items| items.len() <= 200)
                .ok_or("OUTBOX_INVALID")?;
            for attendee in attendees {
                allow_fields(attendee, &["email", "optional"])?;
                text_field(attendee, "email")?;
                if !attendee["optional"].is_boolean() {
                    return Err("OUTBOX_INVALID".into());
                }
            }
        }
    }
    if let Some(result) = &operation.result {
        allow_fields(
            result,
            &[
                "operationId",
                "connectionId",
                "calendarId",
                "eventId",
                "etag",
                "future",
            ],
        )?;
        for field in ["operationId", "connectionId", "calendarId", "eventId"] {
            if text_field(result, field)? != text_field(&operation.preview, field)? {
                return Err("OUTBOX_INVALID".into());
            }
        }
        if kind != "delete" {
            text_field(result, "etag")?;
        }
        if kind == "recurring.future" {
            let proof = &result["future"];
            allow_fields(proof, &["markerHash", "parent", "successor"])?;
            if proof["markerHash"] != intent["plan"]["markerHash"]
                || !proof["parent"].is_object()
                || !proof["successor"].is_object()
            {
                return Err("OUTBOX_INVALID".into());
            }
        } else if result.get("future").is_some() {
            return Err("OUTBOX_INVALID".into());
        }
    }
    if operation.error.as_deref().is_some_and(|code| {
        ![
            "permission",
            "quota",
            "invalid",
            "OUTCOME_UNKNOWN",
            "COMPENSATION_REQUIRED",
            "COMPENSATION_CONFLICT",
            "COMPENSATED",
            "WRITE_REJECTED",
            "WRITE_SNAPSHOT_CHANGED",
        ]
        .contains(&code)
    }) {
        return Err("OUTBOX_INVALID".into());
    }
    Ok(())
}
fn allow_fields(value: &Value, fields: &[&str]) -> Result<(), String> {
    if value
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !fields.contains(&key.as_str())))
    {
        Err("OUTBOX_INVALID".into())
    } else {
        Ok(())
    }
}
pub(super) async fn schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("CREATE TABLE IF NOT EXISTS calendar_write_outbox (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL, unknown_result INTEGER NOT NULL, lease_until INTEGER NOT NULL, payload TEXT NOT NULL)")
        .execute(pool).await.map_err(|_| "OUTBOX_STORE_FAILED")?;
    Ok(())
}
async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Operation>, String> {
    let payload: Option<String> =
        sqlx::query_scalar("SELECT payload FROM calendar_write_outbox WHERE id=?")
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(|_| "OUTBOX_STORE_FAILED")?;
    payload
        .map(|s| {
            let operation: Operation = serde_json::from_str(&s).map_err(|_| "OUTBOX_INVALID")?;
            validate(&operation)?;
            Ok(operation)
        })
        .transpose()
}
#[tauri::command]
pub async fn outbox_store<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: Request,
) -> Result<Value, String> {
    let pool = sync_store::database(&app).await?;
    schema(&pool).await?;
    dispatch(&pool, request).await
}
pub(super) async fn dispatch(pool: &SqlitePool, request: Request) -> Result<Value, String> {
    match request {
        Request::Insert { operation } => {
            validate(&operation)?;
            if operation.state != "pending"
                || operation.version != 1
                || operation.outcome_unknown
                || operation.attempts != 0
                || operation.lease_id.is_some()
                || operation.lease_until != 0
                || operation.result.is_some()
                || operation.local_applied
                || operation.error.is_some()
            {
                return Err("OUTBOX_INVALID".into());
            }
            let p = &operation.preview;
            let result = sqlx::query(
                "INSERT OR IGNORE INTO calendar_write_outbox (id,connection_id,calendar_id,event_id,version,state,unknown_result,lease_until,payload) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .bind(text_field(p, "operationId")?)
            .bind(text_field(p, "connectionId")?)
            .bind(text_field(p, "calendarId")?)
            .bind(text_field(p, "eventId")?)
            .bind(1i64)
            .bind("pending")
            .bind(false)
            .bind(0i64)
            .bind(serde_json::to_string(&operation).map_err(|_| "OUTBOX_INVALID")?)
            .execute(pool)
            .await
            .map_err(|_| "OUTBOX_STORE_FAILED")?;
            Ok(json!(result.rows_affected() == 1))
        }
        Request::Get { id } => {
            serde_json::to_value(get(pool, &id).await?).map_err(|_| "OUTBOX_INVALID".into())
        }
        Request::List => {
            let rows: Vec<String> = sqlx::query_scalar(
                "SELECT payload FROM calendar_write_outbox ORDER BY rowid LIMIT 10001",
            )
            .fetch_all(pool)
            .await
            .map_err(|_| "OUTBOX_STORE_FAILED")?;
            if rows.len() > 10000 {
                return Err("OUTBOX_TOO_LARGE".into());
            }
            let operations: Result<Vec<Operation>, _> = rows
                .iter()
                .map(|s| {
                    let operation: Operation =
                        serde_json::from_str(s).map_err(|_| "OUTBOX_INVALID")?;
                    validate(&operation)?;
                    Ok::<_, String>(operation)
                })
                .collect();
            serde_json::to_value(operations.map_err(|_| "OUTBOX_INVALID")?)
                .map_err(|_| "OUTBOX_INVALID".into())
        }
        Request::Claim {
            id,
            version,
            lease_id,
            now,
            lease_until,
        } => {
            if lease_id.is_empty()
                || lease_id.len() > 128
                || lease_until <= now
                || lease_until - now > 60_000
            {
                return Err("OUTBOX_INVALID".into());
            }
            let Some(mut next) = get(pool, &id).await? else {
                return Ok(Value::Null);
            };
            if next.version != version
                || next.lease_until > now
                || !(next.state == "pending" || next.state == "applying" || next.outcome_unknown)
            {
                return Ok(Value::Null);
            }
            next.version += 1;
            next.attempts += 1;
            next.state = "applying".into();
            next.outcome_unknown = true;
            next.lease_id = Some(lease_id);
            next.lease_until = lease_until;
            validate(&next)?;
            // One conditional UPDATE arbitrates independent processes/connections without a read/write transaction upgrade race.
            let result = sqlx::query("UPDATE calendar_write_outbox SET version=?,state='applying',unknown_result=1,lease_until=?,payload=? WHERE id=? AND version=? AND lease_until<=? AND NOT EXISTS (SELECT 1 FROM calendar_write_outbox other WHERE other.id<>calendar_write_outbox.id AND other.connection_id=calendar_write_outbox.connection_id AND other.calendar_id=calendar_write_outbox.calendar_id AND other.event_id=calendar_write_outbox.event_id AND (other.state='applying' OR other.unknown_result=1))")
                .bind(next.version as i64).bind(lease_until as i64).bind(serde_json::to_string(&next).map_err(|_| "OUTBOX_INVALID")?).bind(&id).bind(version as i64).bind(now as i64).execute(pool).await.map_err(|_| "OUTBOX_STORE_FAILED")?;
            if result.rows_affected() == 1 {
                serde_json::to_value(next).map_err(|_| "OUTBOX_INVALID".into())
            } else {
                Ok(Value::Null)
            }
        }
        Request::Cas { id, version, next } => {
            validate(&next)?;
            let Some(old) = get(pool, &id).await? else {
                return Ok(json!(false));
            };
            if old.version != version {
                return Ok(json!(false));
            }
            if next.version != version + 1
                || next.preview != old.preview
                || next.attempts != old.attempts
                || next.lease_id.is_some()
                || next.lease_until != 0
                || !((old.state == "applying"
                    && ["applied", "conflict", "failed"].contains(&next.state.as_str()))
                    || (old.state == "applied"
                        && next.state == "applied"
                        && old.result == next.result
                        && next.local_applied))
                || (next.state == "applied" && (next.outcome_unknown || next.result.is_none()))
                || (old.attempts > 1
                    && old.outcome_unknown
                    && next.state != "applied"
                    && !next.outcome_unknown)
            {
                return Err("OUTBOX_INVALID".into());
            }
            let result = sqlx::query("UPDATE calendar_write_outbox SET version=?,state=?,unknown_result=?,lease_until=0,payload=? WHERE id=? AND version=?")
                .bind(next.version as i64).bind(&next.state).bind(next.outcome_unknown).bind(serde_json::to_string(&next).map_err(|_| "OUTBOX_INVALID")?).bind(id).bind(version as i64).execute(pool).await.map_err(|_| "OUTBOX_STORE_FAILED")?;
            Ok(json!(result.rows_affected() == 1))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    fn operation(id: &str, event: &str) -> Operation {
        serde_json::from_value(json!({"preview":{"operationId":id,"connectionId":"c","calendarId":"cal","eventId":event,"sendUpdates":"all","intent":{"kind":"cancel","eventId":event,"etag":"v1"},"hash":"sha256:fixture"},"version":1,"state":"pending","outcomeUnknown":false,"attempts":0,"leaseId":null,"leaseUntil":0,"error":null,"result":null,"localApplied":false})).unwrap()
    }
    #[test]
    fn sqlite_reopen_cas_and_unknown_operations_prevent_duplicate_claims() {
        tauri::async_runtime::block_on(async {
            let path = std::env::temp_dir().join(format!("meow-outbox-{}.db", random().unwrap()));
            let options = SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .busy_timeout(Duration::from_secs(5));
            let pool = SqlitePoolOptions::new()
                .max_connections(3)
                .connect_with(options.clone())
                .await
                .unwrap();
            schema(&pool).await.unwrap();
            sqlx::query("CREATE TABLE study_state(payload TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO study_state VALUES('unchanged-workspace')")
                .execute(&pool)
                .await
                .unwrap();
            for (id, event) in [("a", "e"), ("b", "e"), ("c", "other")] {
                assert_eq!(
                    dispatch(
                        &pool,
                        Request::Insert {
                            operation: operation(id, event)
                        }
                    )
                    .await
                    .unwrap(),
                    json!(true)
                );
            }
            assert_eq!(
                dispatch(
                    &pool,
                    Request::Insert {
                        operation: operation("a", "e")
                    }
                )
                .await
                .unwrap(),
                json!(false)
            );
            let claim = |id: &str, version, now| Request::Claim {
                id: id.into(),
                version,
                lease_id: random().unwrap(),
                now,
                lease_until: now + 1000,
            };
            let (first, second) = tokio::join!(
                dispatch(&pool, claim("a", 1, 10)),
                dispatch(&pool, claim("b", 1, 10))
            );
            let first = first.unwrap();
            let second = second.unwrap();
            assert_ne!(
                first.is_null(),
                second.is_null(),
                "Only one writer may own an event"
            );
            let (winner, loser) = if first.is_null() {
                ("b", "a")
            } else {
                ("a", "b")
            };
            assert!(!dispatch(&pool, claim("c", 1, 10)).await.unwrap().is_null());
            pool.close().await;
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .unwrap();
            let old = get(&pool, winner).await.unwrap().unwrap();
            assert_eq!(old.state, "applying");
            assert!(old.outcome_unknown);
            assert!(
                dispatch(&pool, claim(loser, 1, 2000))
                    .await
                    .unwrap()
                    .is_null(),
                "Expired unknown operation still blocks later writes"
            );
            let recovered: Operation =
                serde_json::from_value(dispatch(&pool, claim(winner, 2, 2000)).await.unwrap())
                    .unwrap();
            assert_eq!(recovered.attempts, 2);
            let mut failed = recovered.clone();
            failed.version += 1;
            failed.state = "failed".into();
            failed.lease_id = None;
            failed.lease_until = 0;
            failed.error = Some("OUTCOME_UNKNOWN".into());
            let mut falsely_resolved = failed.clone();
            falsely_resolved.outcome_unknown = false;
            assert!(
                dispatch(
                    &pool,
                    Request::Cas {
                        id: winner.into(),
                        version: 3,
                        next: falsely_resolved
                    }
                )
                .await
                .is_err(),
                "A failed reconciliation cannot release an unknown prior write"
            );
            assert_eq!(
                dispatch(
                    &pool,
                    Request::Cas {
                        id: winner.into(),
                        version: 2,
                        next: failed.clone()
                    }
                )
                .await
                .unwrap(),
                json!(false)
            );
            assert_eq!(
                dispatch(
                    &pool,
                    Request::Cas {
                        id: winner.into(),
                        version: 3,
                        next: failed.clone()
                    }
                )
                .await
                .unwrap(),
                json!(true)
            );
            assert!(dispatch(&pool, claim(loser, 1, 5000))
                .await
                .unwrap()
                .is_null());
            let reconciling: Operation =
                serde_json::from_value(dispatch(&pool, claim(winner, 4, 5000)).await.unwrap())
                    .unwrap();
            let mut applied = reconciling.clone();
            applied.version += 1;
            applied.state = "applied".into();
            applied.outcome_unknown = false;
            applied.lease_id = None;
            applied.lease_until = 0;
            applied.result = Some(
                json!({"operationId":winner,"connectionId":"c","calendarId":"cal","eventId":"e","etag":"v2"}),
            );
            let mut tampered = applied.clone();
            tampered.preview["sendUpdates"] = json!("none");
            assert!(dispatch(
                &pool,
                Request::Cas {
                    id: winner.into(),
                    version: 5,
                    next: tampered
                }
            )
            .await
            .is_err());
            assert_eq!(
                dispatch(
                    &pool,
                    Request::Cas {
                        id: winner.into(),
                        version: 5,
                        next: applied
                    }
                )
                .await
                .unwrap(),
                json!(true)
            );
            assert!(!dispatch(&pool, claim(loser, 1, 6000))
                .await
                .unwrap()
                .is_null());
            let workspace: String = sqlx::query_scalar("SELECT payload FROM study_state")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(workspace, "unchanged-workspace");
            pool.close().await;
            std::fs::remove_file(path).unwrap();
        });
    }
}

#[cfg(test)]
mod future_contract_tests {
    use super::*;
    #[test]
    fn future_mirror_rejects_malformed_fields() {
        let value: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-operation.json"
        ))
        .unwrap();
        for (pointer, replacement) in [
            ("/future/compensation/etag", json!(42)),
            ("/future/parent/proof", json!([])),
            ("/future/successor/state", json!("sent")),
            ("/preview/intent/plan/version", json!(2)),
            ("/preview/intent/plan/compensation/etag", json!("stale")),
            ("/preview/lockKeys", json!(["parent"])),
        ] {
            let mut bad = value.clone();
            let (parent, key) = pointer.rsplit_once('/').unwrap();
            bad.pointer_mut(parent).unwrap()[key] = replacement;
            assert!(serde_json::from_value::<Operation>(bad)
                .map(|v| validate(&v).is_err())
                .unwrap_or(true));
        }
        let mut bad = value;
        bad["future"]["parent"]["resend"] = json!(true);
        assert!(validate(&serde_json::from_value(bad).unwrap()).is_err());
    }
    #[test]
    fn future_mirror_preserves_typescript_frozen_json() {
        let value: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-operation.json"
        ))
        .unwrap();
        let operation: Operation = serde_json::from_value(value.clone()).unwrap();
        validate(&operation).unwrap();
        assert_eq!(serde_json::to_value(operation).unwrap(), value);
    }
}
