//! Native-owned authorization. SQL rows are untrusted; only keyring anchors permit execution.
use super::*;
use sqlx::SqlitePool;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
#[path = "calendar_write_future_plan.rs"]
mod future_plan;
#[path = "calendar_write_future_prepare.rs"]
mod future_prepare;
#[path = "calendar_write_future_read.rs"]
mod future_read;
#[path = "calendar_workspace_hash.rs"]
mod workspace_hash;
#[path = "calendar_write_local.rs"]
pub(super) mod write_local;
const WRITE_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events";
const AUTHORITY_SERVICE: &str = "meow-study:calendar-write-authority";
static ENABLED: AtomicBool = AtomicBool::new(false);
static WRITE_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
type ConfirmationTicket = (String, u64, u64, bool);
static TICKETS: OnceLock<Mutex<HashMap<String, ConfirmationTicket>>> = OnceLock::new();
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ledger {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    future: Option<Value>,
    preview: Value,
    grant_epoch: String,
    version: u64,
    state: String,
    outcome_unknown: bool,
    result: Option<Value>,
    #[serde(default)]
    local: Option<write_local::LocalBinding>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Anchor {
    digest: String,
    version: u64,
    state: String,
    result: Option<Value>,
    grant_epoch: String,
    event_id: String,
    calendar_id: String,
    previous: Option<String>,
    #[serde(default)]
    lock_keys: Vec<String>,
}
trait Vault {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
}
struct Keyring;
impl Vault for Keyring {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match Entry::new(AUTHORITY_SERVICE, key)
            .map_err(|_| "WRITE_AUTHORITY_UNAVAILABLE")?
            .get_password()
        {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("WRITE_AUTHORITY_UNAVAILABLE".into()),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        Entry::new(AUTHORITY_SERVICE, key)
            .map_err(|_| "WRITE_AUTHORITY_UNAVAILABLE")?
            .set_password(value)
            .map_err(|_| "WRITE_AUTHORITY_UNAVAILABLE".into())
    }
}
fn digest(value: &Value) -> Result<String, String> {
    let bytes = serde_json::to_vec(value).map_err(|_| "WRITE_INVALID")?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}
fn owner_key(owner: &str) -> String {
    format!("{:x}", Sha256::digest(owner.as_bytes()))
}
fn anchor_key(owner: &str, id: &str) -> String {
    format!("{}:{id}", owner_key(owner))
}
fn head_key(owner: &str) -> String {
    format!("{}:head", owner_key(owner))
}
fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control))
        .ok_or("WRITE_INVALID".into())
}
fn exact(value: &Value, allowed: &[&str]) -> Result<(), String> {
    if value
        .as_object()
        .is_none_or(|v| v.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        Err("WRITE_UNSUPPORTED".into())
    } else {
        Ok(())
    }
}
fn validate_intent(intent: &Value) -> Result<(), String> {
    let kind = field(intent, "kind")?;
    exact(
        intent,
        match kind {
            "create" => &["kind", "fields"],
            "update" => &["kind", "eventId", "etag", "fields"],
            "cancel" | "delete" => &["kind", "eventId", "etag"],
            "rsvp" => &["kind", "eventId", "etag", "selfEmail", "response"],
            "recurring.single" => match field(intent, "action")? {
                "update" => &[
                    "kind",
                    "parent",
                    "originalStart",
                    "instance",
                    "action",
                    "fields",
                ],
                "cancel" => &["kind", "parent", "originalStart", "instance", "action"],
                _ => return Err("WRITE_INVALID".into()),
            },
            "recurring.series" => match field(intent, "action")? {
                "update" => &["kind", "parent", "action", "fields", "recurrence"],
                "cancel" => &["kind", "parent", "action"],
                _ => return Err("WRITE_INVALID".into()),
            },
            _ => return Err("WRITE_UNSUPPORTED".into()),
        },
    )?;
    if kind != "create" && !kind.starts_with("recurring.") {
        field(intent, "eventId")?;
        field(intent, "etag")?;
    }
    if kind == "rsvp" {
        field(intent, "selfEmail")?;
        if !["accepted", "declined", "tentative"].contains(&field(intent, "response")?) {
            return Err("WRITE_INVALID".into());
        }
    }
    if kind.starts_with("recurring.") {
        for name in if kind == "recurring.single" {
            ["parent", "instance"]
        } else {
            ["parent", "parent"]
        } {
            exact(&intent[name], &["eventId", "etag"])?;
            field(&intent[name], "eventId")?;
            field(&intent[name], "etag")?;
        }
        if kind == "recurring.single" {
            let original = field(intent, "originalStart")?;
            if chrono::DateTime::parse_from_rfc3339(original).is_err()
                && chrono::NaiveDate::parse_from_str(original, "%Y-%m-%d").is_err()
            {
                return Err("WRITE_INVALID".into());
            }
        }
        if let Some(rules) = intent.get("recurrence") {
            if !rules.as_array().is_some_and(|items| {
                items.len() == 1 && items[0].as_str().is_some_and(|v| v.starts_with("RRULE:"))
            }) {
                return Err("WRITE_UNSUPPORTED".into());
            }
        }
    }
    if kind == "create"
        || kind == "update"
        || (kind == "recurring.single" && intent["action"] == "update")
        || (kind == "recurring.series" && intent["action"] == "update")
    {
        let fields = &intent["fields"];
        exact(fields, &["title", "time", "attendees"])?;
        if fields.as_object().is_none_or(|v| v.is_empty()) {
            return Err("WRITE_INVALID".into());
        }
        if fields.get("title").is_some() {
            field(fields, "title")?;
        }
        if kind == "create" && (fields.get("title").is_none() || fields.get("time").is_none()) {
            return Err("WRITE_INVALID".into());
        }
        if let Some(time) = fields.get("time") {
            match field(time, "kind")? {
                "all-day" => {
                    exact(time, &["kind", "startOn", "endOnExclusive"])?;
                    let start =
                        chrono::NaiveDate::parse_from_str(field(time, "startOn")?, "%Y-%m-%d")
                            .map_err(|_| "WRITE_INVALID")?;
                    let end = chrono::NaiveDate::parse_from_str(
                        field(time, "endOnExclusive")?,
                        "%Y-%m-%d",
                    )
                    .map_err(|_| "WRITE_INVALID")?;
                    if end <= start {
                        return Err("WRITE_INVALID".into());
                    }
                }
                "fixed" => {
                    exact(time, &["kind", "startAt", "endAt", "timezone"])?;
                    let start = chrono::DateTime::parse_from_rfc3339(field(time, "startAt")?)
                        .map_err(|_| "WRITE_INVALID")?;
                    let end = chrono::DateTime::parse_from_rfc3339(field(time, "endAt")?)
                        .map_err(|_| "WRITE_INVALID")?;
                    let timezone = field(time, "timezone")?;
                    // First native sender supports only zones whose semantics are verified locally without a TZ database dependency.
                    if !["UTC", "Etc/UTC"].contains(&timezone)
                        && !(timezone == "Asia/Shanghai"
                            && start.timestamp() >= 694224000
                            && end.timestamp() >= 694224000)
                    {
                        return Err("WRITE_UNSUPPORTED_TIMEZONE".into());
                    }
                    if end <= start {
                        return Err("WRITE_INVALID".into());
                    }
                }
                _ => return Err("WRITE_UNSUPPORTED".into()),
            }
        }
        if let Some(attendees) = fields.get("attendees") {
            if kind != "create" {
                return Err("WRITE_UNSUPPORTED".into());
            }
            let attendees = attendees
                .as_array()
                .filter(|v| v.len() <= 12)
                .ok_or("WRITE_INVALID")?;
            let mut seen = HashSet::new();
            for item in attendees {
                exact(item, &["email", "optional"])?;
                let email = field(item, "email")?;
                if !email.contains('@')
                    || email.chars().any(char::is_whitespace)
                    || !item["optional"].is_boolean()
                    || !seen.insert(email.to_lowercase())
                {
                    return Err("WRITE_INVALID".into());
                }
            }
        }
    }
    Ok(())
}
async fn schema(pool: &SqlitePool) -> Result<(), String> {
    write_outbox::schema(pool).await?;
    for column in ["native_payload", "native_previous"] {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pragma_table_info('calendar_write_outbox') WHERE name=?",
        )
        .bind(column)
        .fetch_one(pool)
        .await
        .map_err(|_| "WRITE_STORE_FAILED")?;
        if count == 0 {
            sqlx::query(&format!(
                "ALTER TABLE calendar_write_outbox ADD COLUMN {column} TEXT"
            ))
            .execute(pool)
            .await
            .map_err(|_| "WRITE_STORE_FAILED")?;
        }
    }
    Ok(())
}
fn anchor<V: Vault>(vault: &V, owner: &str, id: &str) -> Result<Anchor, String> {
    serde_json::from_str(
        &vault
            .get(&anchor_key(owner, id))?
            .ok_or("WRITE_AUTHORITY_MISSING")?,
    )
    .map_err(|_| "WRITE_AUTHORITY_INVALID".into())
}
fn indexed<V: Vault>(vault: &V, owner: &str) -> Result<Vec<(String, Anchor)>, String> {
    let mut next = vault.get(&head_key(owner))?;
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    while let Some(id) = next {
        if result.len() >= 512 || !seen.insert(id.clone()) {
            return Err("WRITE_AUTHORITY_INVALID".into());
        }
        let a = anchor(vault, owner, &id)?;
        next = a.previous.clone();
        result.push((id, a));
    }
    Ok(result)
}
async fn ledger<V: Vault>(
    pool: &SqlitePool,
    vault: &V,
    owner: &str,
    id: &str,
    epoch: &str,
) -> Result<Ledger, String> {
    let a = anchor(vault, owner, id)?;
    if a.grant_epoch != epoch {
        return Err("WRITE_GRANT_CHANGED".into());
    }
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT native_payload,native_previous FROM calendar_write_outbox WHERE id=?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|_| "WRITE_STORE_FAILED")?;
    let (current, previous) = row.ok_or("WRITE_AUTHORITY_MISMATCH")?;
    let value = [current, previous]
        .into_iter()
        .flatten()
        .filter_map(|s| serde_json::from_str::<Value>(&s).ok())
        .find(|v| digest(v).ok().as_deref() == Some(a.digest.as_str()))
        .ok_or("WRITE_AUTHORITY_MISMATCH")?;
    let record: Ledger = serde_json::from_value(value).map_err(|_| "WRITE_AUTHORITY_MISMATCH")?;
    if record.version != a.version
        || record.state != a.state
        || record.result != a.result
        || record.grant_epoch != a.grant_epoch
        || record.preview["operationId"] != id
    {
        return Err("WRITE_AUTHORITY_MISMATCH".into());
    }
    validate_future_record(&record)?;
    if record.future.is_some() && a.lock_keys != lock_keys(&record.preview["intent"])? {
        return Err("WRITE_AUTHORITY_MISMATCH".into());
    }
    Ok(record)
}
async fn persist<V: Vault>(
    pool: &SqlitePool,
    vault: &V,
    owner: &str,
    id: &str,
    record: &Ledger,
    previous: Option<String>,
) -> Result<(), String> {
    validate_future_record(record)?;
    let value = serde_json::to_value(record).map_err(|_| "WRITE_INVALID")?;
    // Keep the exact anchored version when a SQL commit precedes a failed keyring commit.
    let trusted = match ledger(pool, vault, owner, id, &record.grant_epoch).await {
        Ok(old) => Some(
            serde_json::to_value(old)
                .map_err(|_| "WRITE_INVALID")?
                .to_string(),
        ),
        Err(_) if vault.get(&anchor_key(owner, id))?.is_none() => None,
        Err(error) => return Err(error),
    };
    let result = sqlx::query(
        "UPDATE calendar_write_outbox SET native_previous=?,native_payload=? WHERE id=?",
    )
    .bind(trusted)
    .bind(value.to_string())
    .bind(id)
    .execute(pool)
    .await
    .map_err(|_| "WRITE_STORE_FAILED")?;
    if result.rows_affected() != 1 {
        return Err("WRITE_AUTHORITY_MISMATCH".into());
    }
    let a = Anchor {
        digest: digest(&value)?,
        version: record.version,
        state: record.state.clone(),
        result: record.result.clone(),
        grant_epoch: record.grant_epoch.clone(),
        event_id: field(&record.preview, "eventId")?.into(),
        calendar_id: field(&record.preview, "calendarId")?.into(),
        previous,
        lock_keys: if record.preview["intent"]["kind"] == "create" {
            vec![field(&record.preview, "eventId")?.into()]
        } else {
            lock_keys(&record.preview["intent"])?
        },
    };
    vault.set(
        &anchor_key(owner, id),
        &serde_json::to_string(&a).map_err(|_| "WRITE_INVALID")?,
    )
}
fn validate_future_record(record: &Ledger) -> Result<(), String> {
    if record.preview["intent"]["kind"] == "recurring.future" {
        write_outbox::future::validate(
            &record.preview,
            record.future.as_ref().ok_or("WRITE_INVALID")?,
        )?;
        if record.local.is_some() {
            return Err("WRITE_UNSUPPORTED".into());
        }
        let mut content = record.preview.clone();
        content
            .as_object_mut()
            .ok_or("WRITE_INVALID")?
            .remove("hash");
        if record.preview["hash"] != workspace_hash::fingerprint(&content)? {
            return Err("WRITE_PREVIEW_CHANGED".into());
        }
    } else if record.future.is_some() {
        return Err("WRITE_INVALID".into());
    }
    Ok(())
}
fn safe(record: &Ledger) -> Value {
    json!({"operationId":record.preview["operationId"],"state":record.state,"outcomeUnknown":record.outcome_unknown,"result":record.result})
}
fn confirmation_time(time: &Value, key: &str) -> Result<String, String> {
    let instant =
        chrono::DateTime::parse_from_rfc3339(field(time, key)?).map_err(|_| "WRITE_INVALID")?;
    // validate_intent limits native writes to UTC and post-1991 Shanghai; no DST inference here.
    let offset = if time["timezone"] == "Asia/Shanghai" {
        28800
    } else {
        0
    };
    Ok(instant
        .with_timezone(&chrono::FixedOffset::east_opt(offset).ok_or("WRITE_INVALID")?)
        .format("%Y-%m-%d %H:%M:%S %:z")
        .to_string())
}
fn confirmation_message(preview: &Value) -> Result<String, String> {
    let intent = &preview["intent"];
    if intent["kind"] == "recurring.future" {
        return future_prepare::confirmation(preview);
    }
    validate_intent(intent)?;
    let action = match field(intent, "kind")? {
        "create" => "创建日程",
        "update" => "修改日程",
        "cancel" => "取消日程",
        "delete" => "删除日程",
        "rsvp" => "回复邀请",
        "recurring.single" => match field(intent, "action")? {
            "update" => "修改日程",
            "cancel" => "取消日程",
            _ => return Err("WRITE_INVALID".into()),
        },
        "recurring.series" => match field(intent, "action")? {
            "update" => "修改日程",
            "cancel" => "取消日程",
            _ => return Err("WRITE_INVALID".into()),
        },
        _ => return Err("WRITE_UNSUPPORTED".into()),
    };
    let notification = match field(preview, "sendUpdates")? {
        "all" => "所有参与者",
        "externalOnly" => "非 Google 日历参与者",
        "none" => "不发送更新通知（提供方仍可能发送其他邮件）",
        _ => return Err("WRITE_INVALID".into()),
    };
    let mut lines = vec![
        format!("操作：{action}"),
        format!("日历：{}", field(preview, "calendarId")?),
    ];
    if intent["kind"] == "recurring.single" {
        lines.push("范围：单次日程（single occurrence）".into());
        lines.push(format!("系列 ID：{}", field(&intent["parent"], "eventId")?));
        lines.push(format!(
            "实例 ID：{}",
            field(&intent["instance"], "eventId")?
        ));
        lines.push(format!("原始开始：{}", field(intent, "originalStart")?));
    } else if intent["kind"] == "recurring.series" {
        lines.push("范围：整个系列（entire series）".into());
        lines.push(format!("系列 ID：{}", field(&intent["parent"], "eventId")?));
    } else if intent["kind"] != "create" {
        lines.push(format!("日程 ID：{}", field(preview, "eventId")?));
    }
    if let Some(title) = intent["fields"]["title"].as_str() {
        lines.push(format!("标题：{title}"));
    }
    if let Some(time) = intent["fields"].get("time") {
        if time["kind"] == "all-day" {
            lines.push(format!(
                "全天：{} 至 {}（结束日期不包含在内）",
                field(time, "startOn")?,
                field(time, "endOnExclusive")?
            ));
        } else {
            lines.push(format!(
                "开始：{}\n结束：{}\n时区：{}",
                confirmation_time(time, "startAt")?,
                confirmation_time(time, "endAt")?,
                field(time, "timezone")?
            ));
        }
    }
    if let Some(attendees) = intent["fields"]["attendees"].as_array() {
        for attendee in attendees {
            lines.push(format!(
                "{}参与者：{}",
                if attendee["optional"] == true {
                    "可选"
                } else {
                    "必选"
                },
                field(attendee, "email")?
            ));
        }
    }
    if intent["kind"] == "rsvp" {
        lines.push(format!(
            "回复人：{}\n回复：{}",
            field(intent, "selfEmail")?,
            match field(intent, "response")? {
                "accepted" => "接受",
                "declined" => "拒绝",
                "tentative" => "暂定",
                _ => return Err("WRITE_INVALID".into()),
            }
        ));
    }
    lines.push(format!("通知范围：{notification}"));
    let message = lines.join("\n");
    // Native message dialogs cannot reliably scroll long summaries. Reject, never truncate the approved target/attendees.
    if message.chars().count() > 1500 {
        return Err("WRITE_PREVIEW_TOO_LARGE".into());
    }
    Ok(message)
}
fn grant(config: &Config) -> Result<(String, String, u64), String> {
    let owner = account(config)?;
    let session = load(&owner)?.ok_or("DISCONNECTED")?;
    let epoch = session.grant_epoch.ok_or("WRITE_REAUTHORIZE")?;
    Ok((owner.clone(), epoch, generation(&owner, false)?))
}
fn ticket(id: &str, hash: &str, generation: u64, consume: bool) -> Result<(), String> {
    let mut map = TICKETS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "WRITE_LOCK_FAILED")?;
    let t = map.get_mut(id).ok_or("WRITE_CONFIRM_REQUIRED")?;
    if t.0 != hash || t.1 != generation || t.2 < now()? || t.3 {
        return Err("WRITE_CONFIRM_REQUIRED".into());
    }
    if consume {
        t.3 = true;
    }
    Ok(())
}
#[tauri::command]
pub async fn write_prepare<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    calendar_id: String,
    intent: Value,
    send_updates: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, generation) = grant(&config)?;
    if intent["kind"] != "recurring.future" {
        validate_intent(&intent)?;
    }
    if calendar_id.is_empty()
        || calendar_id.len() > 1024
        || !["all", "externalOnly", "none"].contains(&send_updates.as_str())
    {
        return Err("WRITE_INVALID".into());
    }
    if indexed(&Keyring, &owner)?.len() >= 512 {
        return Err("WRITE_OUTBOX_FULL".into());
    }
    if intent["kind"] == "recurring.future" {
        let pool = sync_store::database(&app).await?;
        schema(&pool).await?;
        let http = GoogleHttp {
            config: &config,
            owner: &owner,
            epoch: generation,
        };
        let id = future_prepare::operation_id()?;
        let base = json!({"operationId":id,"connectionId":config.connection_id,"calendarId":calendar_id,"eventId":field(&intent["parent"], "eventId")?,"lockKeys":[],"sendUpdates":send_updates,"intent":intent});
        let check = || {
            http.check_future_session()?;
            if grant(&config)? != (owner.clone(), epoch.clone(), generation) {
                return Err("WRITE_GRANT_CHANGED".into());
            }
            Ok(())
        };
        let preview =
            future_prepare::prepare(&pool, &Keyring, &http, &owner, &epoch, &base, check).await?;
        return prepared_ticket(&preview, generation);
    }
    let id = random()?;
    let event_id = if intent["kind"] == "create" {
        format!("m{:x}", Sha256::digest(random()?.as_bytes()))
    } else {
        intent_event_id(&intent)?.into()
    };
    let mut preview = json!({"operationId":id,"connectionId":config.connection_id,"calendarId":calendar_id,"eventId":event_id,"sendUpdates":send_updates,"intent":intent});
    let hash = digest(&preview)?;
    preview["hash"] = json!(hash);
    if preview["intent"]["kind"]
        .as_str()
        .is_some_and(|kind| kind.starts_with("recurring."))
    {
        let http = GoogleHttp {
            config: &config,
            owner: &owner,
            epoch: generation,
        };
        if !preflight(&http, &preview).await? {
            return Err("WRITE_CONFLICT".into());
        }
    }
    let pool = sync_store::database(&app).await?;
    schema(&pool).await?;
    let mirror=serde_json::from_value(json!({"preview":preview,"version":1,"state":"pending","outcomeUnknown":false,"attempts":0,"leaseId":null,"leaseUntil":0,"error":null,"result":null,"localApplied":false})).map_err(|_|"WRITE_INVALID")?;
    write_outbox::dispatch(&pool, write_outbox::Request::Insert { operation: mirror }).await?;
    let record = Ledger {
        preview: preview.clone(),
        grant_epoch: epoch,
        version: 1,
        state: "prepared".into(),
        outcome_unknown: false,
        result: None,
        local: None,
        future: None,
    };
    let previous = Keyring.get(&head_key(&owner))?;
    persist(&pool, &Keyring, &owner, &id, &record, previous).await?;
    Keyring.set(&head_key(&owner), &id)?;
    prepared_ticket(&preview, generation)
}
fn prepared_ticket(preview: &Value, generation: u64) -> Result<Value, String> {
    let id = field(preview, "operationId")?;
    let hash = field(preview, "hash")?;
    let expires = now()? + 300;
    TICKETS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "WRITE_LOCK_FAILED")?
        .insert(id.into(), (hash.into(), generation, expires, false));
    Ok(json!({"operationId":id,"preview":preview,"hash":hash,"expiresAt":expires*1000}))
}

#[tauri::command]
pub async fn write_confirm<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
    hash: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, generation) = grant(&config)?;
    let pool = sync_store::database(&app).await?;
    let record = ledger(&pool, &Keyring, &owner, &operation_id, &epoch).await?;
    if record.state != "prepared" || record.preview["hash"] != hash {
        return Err("WRITE_CONFIRM_REQUIRED".into());
    }
    ticket(&operation_id, &hash, generation, false)?;
    let message = confirmation_message(&record.preview)?;
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title("确认日历写入")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "确认".into(),
                "取消".into(),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| "WRITE_CONFIRM_FAILED")?;
    if !accepted || grant(&config)? != (owner.clone(), epoch.clone(), generation) {
        return Err("WRITE_CONFIRM_CANCELLED".into());
    }
    future_prepare::confirm(&pool, &Keyring, &owner, &record, generation, || {
        if grant(&config)? != (owner.clone(), epoch.clone(), generation) {
            return Err("WRITE_GRANT_CHANGED".into());
        }
        if record.future.is_some() {
            GoogleHttp {
                config: &config,
                owner: &owner,
                epoch: generation,
            }
            .check_future_session()?;
        }
        Ok(())
    })
    .await?;
    Ok(json!({"confirmed":true}))
}
#[tauri::command]
pub async fn write_lookup<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, _) = grant(&config)?;
    let pool = sync_store::database(&app).await?;
    Ok(safe(
        &ledger(&pool, &Keyring, &owner, &operation_id, &epoch).await?,
    ))
}
#[tauri::command]
pub fn write_disable(config: Config) -> Result<Value, String> {
    let owner = account(&config)?;
    ENABLED.store(false, Ordering::SeqCst);
    generation(&owner, true)?;
    Ok(json!({"enabled":false}))
}

struct HttpReply {
    status: u16,
    body: Value,
}
trait Http {
    fn check_future_session(&self) -> Result<(), String> {
        Err("WRITE_UNSUPPORTED".into())
    }
    async fn call(
        &self,
        method: &str,
        path: &str,
        etag: Option<&str>,
        send_updates: Option<&str>,
        body: Option<Value>,
    ) -> Result<HttpReply, String>;
}
struct GoogleHttp<'a> {
    config: &'a Config,
    owner: &'a str,
    epoch: u64,
}
fn http_scope_allowed(method: &str, path: &str, scopes: &[String]) -> bool {
    if method != "GET" {
        scopes.iter().any(|s| s == WRITE_SCOPE)
    } else if path.starts_with("users/me/calendarList/") {
        scopes.iter().any(|s| s == LIST_SCOPE)
    } else if path.starts_with("calendars/")
        && (path.contains("/events/")
            || path
                .split('?')
                .next()
                .is_some_and(|p| p.ends_with("/events")))
    {
        scopes.iter().any(|s| s == EVENT_SCOPE || s == WRITE_SCOPE)
    } else {
        false
    }
}
impl Http for GoogleHttp<'_> {
    fn check_future_session(&self) -> Result<(), String> {
        let session = load(self.owner)?.ok_or("DISCONNECTED")?;
        if account(self.config)? != self.owner
            || generation(self.owner, false)? != self.epoch
            || session.grant_epoch.is_none()
            || !session.scopes.iter().any(|s| s == WRITE_SCOPE)
            || !session.scopes.iter().any(|s| s == LIST_SCOPE)
        {
            return Err("WRITE_SCOPE_REQUIRED".into());
        }
        Ok(())
    }
    async fn call(
        &self,
        method: &str,
        path: &str,
        etag: Option<&str>,
        send_updates: Option<&str>,
        body: Option<Value>,
    ) -> Result<HttpReply, String> {
        if method != "GET" && !ENABLED.load(Ordering::SeqCst) {
            return Err("WRITE_UNAVAILABLE".into());
        }
        if generation(self.owner, false)? != self.epoch {
            return Err("DISCONNECTED".into());
        }
        let session = authorized(self.owner, self.config, None).await?;
        let scope_ok = http_scope_allowed(method, path, &session.scopes);
        if !scope_ok || generation(self.owner, false)? != self.epoch {
            return Err("WRITE_SCOPE_REQUIRED".into());
        }
        let mut request = client()?
            .request(
                reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "WRITE_INVALID")?,
                format!("{API}{path}"),
            )
            .bearer_auth(session.access_token);
        if let Some(etag) = etag {
            request = request.header("If-Match", etag);
        }
        if let Some(send) = send_updates {
            request = request.query(&[("sendUpdates", send)]);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        if method != "GET" && !ENABLED.load(Ordering::SeqCst) {
            return Err("WRITE_UNAVAILABLE".into());
        }
        // Exactly one transport attempt, including on 401/5xx. Read retry policy is never used here.
        let response = request.send().await.map_err(|_| "WRITE_OUTCOME_UNKNOWN")?;
        let status = response.status().as_u16();
        let body = if status == 204 {
            Value::Null
        } else {
            read_body(response).await?
        };
        if generation(self.owner, false)? != self.epoch {
            return Err("DISCONNECTED".into());
        }
        Ok(HttpReply { status, body })
    }
}
fn segment(value: &str) -> String {
    let mut url = Url::parse("https://unused.invalid/").unwrap();
    url.path_segments_mut().unwrap().push(value);
    url.path().trim_start_matches('/').to_string()
}
fn event_path(preview: &Value) -> Result<String, String> {
    Ok(format!(
        "calendars/{}/events/{}",
        segment(field(preview, "calendarId")?),
        segment(field(preview, "eventId")?)
    ))
}
fn intent_event_id(intent: &Value) -> Result<&str, String> {
    match field(intent, "kind")? {
        "recurring.single" => field(&intent["instance"], "eventId"),
        "recurring.series" => field(&intent["parent"], "eventId"),
        _ => field(intent, "eventId"),
    }
}
fn intent_etag(intent: &Value) -> Result<&str, String> {
    match field(intent, "kind")? {
        "recurring.single" => field(&intent["instance"], "etag"),
        "recurring.series" => field(&intent["parent"], "etag"),
        _ => field(intent, "etag"),
    }
}
fn lock_keys(intent: &Value) -> Result<Vec<String>, String> {
    let mut keys = match field(intent, "kind")? {
        "recurring.single" => vec![
            field(&intent["parent"], "eventId")?.into(),
            field(&intent["instance"], "eventId")?.into(),
        ],
        "recurring.future" => vec![
            field(&intent["plan"]["parent"], "eventId")?.into(),
            field(&intent["plan"]["pivot"], "eventId")?.into(),
            field(&intent["plan"]["successor"], "eventId")?.into(),
        ],
        "recurring.series" => vec![field(&intent["parent"], "eventId")?.into()],
        _ => vec![intent_event_id(intent)?.into()],
    };
    keys.sort();
    keys.dedup();
    Ok(keys)
}
fn result(preview: &Value, etag: Value) -> Value {
    json!({"operationId":preview["operationId"],"connectionId":preview["connectionId"],"calendarId":preview["calendarId"],"eventId":preview["eventId"],"etag":etag})
}
fn supported(event: &Value, intent: &Value) -> bool {
    let kind = intent["kind"].as_str();
    event.get("eventType").is_none_or(|t| t == "default")
        && event["locked"] != true
        && match kind {
            Some("recurring.single") => {
                event["recurringEventId"] == intent["parent"]["eventId"]
                    && event["originalStartTime"].is_object()
            }
            Some("recurring.series") => {
                event["recurrence"].as_array().is_some_and(|v| v.len() == 1)
            }
            _ => event.get("recurrence").is_none() && event.get("recurringEventId").is_none(),
        }
}
fn body(preview: &Value) -> Result<Value, String> {
    let intent = &preview["intent"];
    validate_intent(intent)?;
    let kind = field(intent, "kind")?;
    let mut body = json!({"extendedProperties":{"private":{"meowOperationId":preview["operationId"],"meowOperationHash":preview["hash"]}}});
    match kind {
        "create" | "update" | "recurring.single" | "recurring.series" => {
            if kind == "create" {
                body["id"] = preview["eventId"].clone();
            }
            if kind == "recurring.single" && intent["action"] == "cancel"
                || kind == "recurring.series" && intent["action"] == "cancel"
            {
                body["status"] = json!("cancelled");
                return Ok(body);
            }
            let fields = &intent["fields"];
            if let Some(title) = fields.get("title") {
                body["summary"] = title.clone();
            }
            if let Some(time) = fields.get("time") {
                if time["kind"] == "all-day" {
                    body["start"] = json!({"date":time["startOn"]});
                    body["end"] = json!({"date":time["endOnExclusive"]});
                } else {
                    body["start"] = json!({"dateTime":time["startAt"],"timeZone":time["timezone"]});
                    body["end"] = json!({"dateTime":time["endAt"],"timeZone":time["timezone"]});
                }
            }
            if let Some(attendees) = fields["attendees"].as_array() {
                body["attendees"]=Value::Array(attendees.iter().map(|a|json!({"email":a["email"],"optional":a["optional"],"responseStatus":"needsAction"})).collect());
            }
            if kind == "recurring.series" {
                if let Some(rules) = intent.get("recurrence") {
                    body["recurrence"] = rules.clone();
                }
            }
        }
        "cancel" => body["status"] = json!("cancelled"),
        "rsvp" => {
            body["attendeesOmitted"] = json!(true);
            body["attendees"] =
                json!([{"email":intent["selfEmail"],"responseStatus":intent["response"]}]);
        }
        "delete" => return Ok(Value::Null),
        _ => return Err("WRITE_UNSUPPORTED".into()),
    }
    Ok(body)
}
fn proof(preview: &Value, event: &Value) -> Result<bool, String> {
    let intent = &preview["intent"];
    if !supported(event, &preview["intent"])
        || event["id"] != preview["eventId"]
        || event["etag"].as_str().is_none_or(str::is_empty)
        || event["extendedProperties"]["private"]["meowOperationId"] != preview["operationId"]
        || event["extendedProperties"]["private"]["meowOperationHash"] != preview["hash"]
        || (intent["kind"] == "recurring.single"
            && !original_start_matches(
                &event["originalStartTime"],
                field(intent, "originalStart")?,
            ))
    {
        return Ok(false);
    }
    if intent["kind"] == "delete" {
        return Ok(false);
    }
    let expected = body(preview)?;
    if intent["kind"] == "rsvp" {
        return Ok(event["attendees"].as_array().is_some_and(|items| {
            items.iter().any(|a| {
                a["self"] == true
                    && a["email"] == intent["selfEmail"]
                    && a["responseStatus"] == intent["response"]
            })
        }));
    }
    for name in ["summary", "status", "start", "end", "recurrence"] {
        if let Some(value) = expected.get(name) {
            if name == "start" || name == "end" {
                let actual = &event[name];
                if value.get("date").is_some() {
                    if value["date"] != actual["date"] {
                        return Ok(false);
                    }
                } else {
                    let a = chrono::DateTime::parse_from_rfc3339(field(value, "dateTime")?)
                        .map_err(|_| "WRITE_INVALID")?;
                    let b = chrono::DateTime::parse_from_rfc3339(field(actual, "dateTime")?)
                        .map_err(|_| "WRITE_INVALID")?;
                    if a != b || value["timeZone"] != actual["timeZone"] {
                        return Ok(false);
                    }
                }
            } else if *value != event[name] {
                return Ok(false);
            }
        }
    }
    if let Some(attendees) = expected["attendees"].as_array() {
        let Some(actual) = event["attendees"].as_array() else {
            return Ok(false);
        };
        if attendees.len() != actual.len()
            || !attendees.iter().all(|a| {
                actual.iter().any(|b| {
                    a["email"] == b["email"] && (a["optional"] == true) == (b["optional"] == true)
                })
            })
        {
            return Ok(false);
        }
    }
    Ok(true)
}
fn original_start_matches(raw: &Value, frozen: &str) -> bool {
    let Some(actual) = raw
        .get("dateTime")
        .or_else(|| raw.get("date"))
        .and_then(Value::as_str)
    else {
        return false;
    };
    if frozen.len() == 10 {
        return actual == frozen;
    }
    chrono::DateTime::parse_from_rfc3339(actual).ok()
        == chrono::DateTime::parse_from_rfc3339(frozen).ok()
}
async fn preflight<H: Http>(http: &H, preview: &Value) -> Result<bool, String> {
    let directory = http
        .call(
            "GET",
            &format!(
                "users/me/calendarList/{}",
                segment(field(preview, "calendarId")?)
            ),
            None,
            None,
            None,
        )
        .await?;
    if directory.status != 200
        || directory.body["id"] != preview["calendarId"]
        || !matches!(
            directory.body["accessRole"].as_str(),
            Some("owner" | "writer")
        )
    {
        return Err("WRITE_PERMISSION".into());
    }
    let remote = http
        .call("GET", &event_path(preview)?, None, None, None)
        .await?;
    let intent = &preview["intent"];
    if intent["kind"] == "create" {
        return Ok(remote.status == 404);
    }
    if remote.status != 200 {
        return Err("WRITE_READ_FAILED".into());
    }
    let event = &remote.body;
    if intent["kind"] == "recurring.single" {
        let parent = http
            .call(
                "GET",
                &format!(
                    "calendars/{}/events/{}",
                    segment(field(preview, "calendarId")?),
                    segment(field(&intent["parent"], "eventId")?)
                ),
                None,
                None,
                None,
            )
            .await?;
        if parent.status != 200
            || parent.body["id"] != intent["parent"]["eventId"]
            || parent.body["etag"] != intent["parent"]["etag"]
            || parent.body["recurrence"]
                .as_array()
                .is_none_or(|rules| rules.len() != 1)
        {
            return Err("WRITE_UNSUPPORTED".into());
        }
    }
    if event["id"] != preview["eventId"] || !supported(event, intent) {
        return Err("WRITE_UNSUPPORTED".into());
    }
    if intent["kind"] == "rsvp"
        && !event["attendees"].as_array().is_some_and(|items| {
            items
                .iter()
                .any(|a| a["self"] == true && a["email"] == intent["selfEmail"])
        })
    {
        return Err("WRITE_PERMISSION".into());
    }
    if (intent["kind"] == "cancel"
        || (intent["kind"] == "recurring.single" && intent["action"] == "cancel")
        || (intent["kind"] == "recurring.series" && intent["action"] == "cancel"))
        && event["organizer"]["self"] != true
    {
        return Err("WRITE_PERMISSION".into());
    }
    if intent["kind"] == "recurring.single"
        && !original_start_matches(&event["originalStartTime"], field(intent, "originalStart")?)
    {
        return Err("WRITE_UNSUPPORTED".into());
    }
    Ok(event["etag"] == intent_etag(intent)?)
}
async fn execute<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    reconcile: bool,
) -> Result<Value, String> {
    let mut record = ledger(pool, vault, owner, id, epoch).await?;
    if record.preview["intent"]["kind"] == "recurring.future" {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let a = anchor(vault, owner, id)?;
    if record.state == "applied" {
        return Ok(safe(&record));
    }
    if reconcile {
        if !record.outcome_unknown {
            return Err("WRITE_RECONCILE_NOT_REQUIRED".into());
        }
        if let Ok(reply) = http
            .call("GET", &event_path(&record.preview)?, None, None, None)
            .await
        {
            if reply.status == 200 && proof(&record.preview, &reply.body).unwrap_or(false) {
                record.state = "applied".into();
                record.outcome_unknown = false;
                record.result = Some(result(&record.preview, reply.body["etag"].clone()));
                record.version += 1;
                persist(pool, vault, owner, id, &record, a.previous).await?;
            }
        }
        return Ok(safe(&record));
    }
    if record.state != "confirmed" || record.outcome_unknown {
        return Err("WRITE_RECONCILE_REQUIRED".into());
    }
    for (other_id, other) in indexed(vault, owner)? {
        if other_id != id
            && other.calendar_id == a.calendar_id
            && other.lock_keys.iter().any(|key| a.lock_keys.contains(key))
            && other.state == "applying"
        {
            return Err("WRITE_BUSY".into());
        }
    }
    validate_intent(&record.preview["intent"])?;
    if !preflight(http, &record.preview).await? {
        record.state = "conflict".into();
        record.version += 1;
        persist(pool, vault, owner, id, &record, a.previous).await?;
        return Ok(safe(&record));
    }
    let request_body = body(&record.preview)?;
    let kind = field(&record.preview["intent"], "kind")?.to_owned();
    record.state = "applying".into();
    record.outcome_unknown = true;
    record.version += 1;
    // Durable keyring applying anchor is mandatory before crossing the mutation boundary.
    persist(pool, vault, owner, id, &record, a.previous.clone()).await?;
    let path = if kind == "create" {
        format!(
            "calendars/{}/events",
            segment(field(&record.preview, "calendarId")?)
        )
    } else {
        event_path(&record.preview)?
    };
    let reply = http
        .call(
            if kind == "create" {
                "POST"
            } else if kind == "delete" {
                "DELETE"
            } else {
                "PATCH"
            },
            &path,
            if kind == "create" {
                None
            } else {
                Some(intent_etag(&record.preview["intent"])?)
            },
            Some(field(&record.preview, "sendUpdates")?),
            if kind == "delete" {
                None
            } else {
                Some(request_body)
            },
        )
        .await;
    if let Ok(reply) = reply {
        if (reply.status == 204 && kind == "delete")
            || ((reply.status == 200 || reply.status == 201)
                && proof(&record.preview, &reply.body).unwrap_or(false))
        {
            record.state = "applied".into();
            record.outcome_unknown = false;
            record.result = Some(result(
                &record.preview,
                if kind == "delete" {
                    Value::Null
                } else {
                    reply.body["etag"].clone()
                },
            ));
        } else if reply.status == 412 || reply.status == 409 {
            record.state = "conflict".into();
            record.outcome_unknown = false;
        } else if [400, 401, 403, 429].contains(&reply.status) {
            record.state = "failed".into();
            record.outcome_unknown = false;
        }
    }
    record.version += 1;
    persist(pool, vault, owner, id, &record, a.previous).await?;
    Ok(safe(&record))
}
#[tauri::command]
pub async fn write_run<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
) -> Result<Value, String> {
    if !ENABLED.load(Ordering::SeqCst) {
        return Err("WRITE_UNAVAILABLE".into());
    }
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, generation) = grant(&config)?;
    let pool = sync_store::database(&app).await?;
    let record = ledger(&pool, &Keyring, &owner, &operation_id, &epoch).await?;
    ticket(
        &operation_id,
        field(&record.preview, "hash")?,
        generation,
        true,
    )?;
    let http = GoogleHttp {
        config: &config,
        owner: &owner,
        epoch: generation,
    };
    execute(&pool, &Keyring, &http, &owner, &operation_id, &epoch, false).await
}
#[tauri::command]
pub async fn write_reconcile<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, generation) = grant(&config)?;
    let pool = sync_store::database(&app).await?;
    let http = GoogleHttp {
        config: &config,
        owner: &owner,
        epoch: generation,
    };
    execute(&pool, &Keyring, &http, &owner, &operation_id, &epoch, true).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    #[derive(Default)]
    struct MemoryVault {
        data: Mutex<HashMap<String, String>>,
        fail: AtomicBool,
        fail_applied: AtomicBool,
    }
    impl Vault for MemoryVault {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.data.lock().unwrap().get(key).cloned())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            if self.fail.load(Ordering::SeqCst)
                || self.fail_applied.load(Ordering::SeqCst)
                    && serde_json::from_str::<Value>(value)
                        .ok()
                        .is_some_and(|v| v["state"] == "applied")
            {
                return Err("KEYRING_FAILED".into());
            }
            self.data.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
    }
    type RecordedRequest = (String, Option<String>, Option<Value>);
    struct FakeHttp {
        event: Mutex<Option<Value>>,
        parents: Mutex<HashMap<String, Value>>,
        writes: AtomicUsize,
        lose: bool,
        reject: u16,
        requests: Mutex<Vec<RecordedRequest>>,
    }
    impl FakeHttp {
        fn new() -> Self {
            Self {
                event: Mutex::new(None),
                parents: Mutex::new(HashMap::new()),
                writes: AtomicUsize::new(0),
                lose: false,
                reject: 0,
                requests: Mutex::new(vec![]),
            }
        }
    }
    impl Http for FakeHttp {
        async fn call(
            &self,
            method: &str,
            path: &str,
            etag: Option<&str>,
            send: Option<&str>,
            body: Option<Value>,
        ) -> Result<HttpReply, String> {
            assert!(
                !path.starts_with('/'),
                "Fixed API paths must not create double slashes"
            );
            self.requests.lock().unwrap().push((
                method.into(),
                etag.map(str::to_owned),
                body.clone(),
            ));
            if method == "GET" {
                if path.starts_with("users/me/") {
                    return Ok(HttpReply {
                        status: 200,
                        body: json!({"id":"cal","accessRole":"owner"}),
                    });
                }
                if let Some(parent) = self
                    .parents
                    .lock()
                    .unwrap()
                    .get(path.rsplit('/').next().unwrap())
                    .cloned()
                {
                    return Ok(HttpReply {
                        status: 200,
                        body: parent,
                    });
                }
                return Ok(match self.event.lock().unwrap().clone() {
                    Some(event) => HttpReply {
                        status: 200,
                        body: event,
                    },
                    None => HttpReply {
                        status: 404,
                        body: Value::Null,
                    },
                });
            }
            assert_eq!(send, Some("all"));
            if self.reject != 0 {
                return Ok(HttpReply {
                    status: self.reject,
                    body: Value::Null,
                });
            }
            self.writes.fetch_add(1, Ordering::SeqCst);
            if method == "DELETE" {
                *self.event.lock().unwrap() = None;
                if self.lose {
                    return Err("LOST".into());
                }
                return Ok(HttpReply {
                    status: 204,
                    body: Value::Null,
                });
            }
            let mut event = self.event.lock().unwrap().clone().unwrap_or(json!({}));
            for (k, v) in body.unwrap().as_object().unwrap() {
                event[k] = v.clone();
            }
            event["etag"] = json!("v2");
            if event["attendeesOmitted"] == true {
                event["attendees"][0]["self"] = json!(true);
            }
            *self.event.lock().unwrap() = Some(event.clone());
            if self.lose {
                return Err("LOST".into());
            }
            Ok(HttpReply {
                status: 200,
                body: event,
            })
        }
    }
    async fn fixture(intent: Value) -> (SqlitePool, MemoryVault, Ledger) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        schema(&pool).await.unwrap();
        let event_id = if intent["kind"] == "create" {
            "mevent123".into()
        } else {
            intent_event_id(&intent).unwrap().to_owned()
        };
        let mut preview = json!({"operationId":"op","connectionId":"c","calendarId":"cal","eventId":event_id,"intent":intent,"sendUpdates":"all"});
        preview["hash"] = json!(digest(&preview).unwrap());
        let mirror=serde_json::from_value(json!({"preview":preview,"version":1,"state":"pending","outcomeUnknown":false,"attempts":0,"leaseId":null,"leaseUntil":0,"error":null,"result":null,"localApplied":false})).unwrap();
        write_outbox::dispatch(&pool, write_outbox::Request::Insert { operation: mirror })
            .await
            .unwrap();
        let vault = MemoryVault::default();
        let record = Ledger {
            preview,
            grant_epoch: "grant".into(),
            version: 1,
            state: "confirmed".into(),
            outcome_unknown: false,
            result: None,
            local: None,
            future: None,
        };
        persist(&pool, &vault, "owner", "op", &record, None)
            .await
            .unwrap();
        vault.set(&head_key("owner"), "op").unwrap();
        (pool, vault, record)
    }
    #[test]
    fn future_typescript_numeric_boundary_hash_is_accepted_unchanged() {
        tauri::async_runtime::block_on(async {
            for input in [
                include_str!("../../tests/fixtures/calendar-future-numeric-boundary.json"),
                include_str!("../../tests/fixtures/calendar-future-numeric-integer.json"),
            ] {
                let (pool, vault, mut record) = fixture(create()).await;
                let frozen: Value = serde_json::from_str(input).unwrap();
                let id = frozen["preview"]["operationId"].as_str().unwrap();
                write_outbox::dispatch(
                    &pool,
                    write_outbox::Request::Insert {
                        operation: serde_json::from_value(frozen.clone()).unwrap(),
                    },
                )
                .await
                .unwrap();
                record.preview = frozen["preview"].clone();
                record.future = Some(frozen["future"].clone());

                persist(&pool, &vault, "owner", id, &record, None)
                    .await
                    .unwrap();
                assert_eq!(
                    ledger(&pool, &vault, "owner", id, "grant")
                        .await
                        .unwrap()
                        .preview,
                    record.preview
                );
                record.preview["intent"]["plan"]["originalParent"]["sequence"] = json!(42);
                assert_eq!(
                    validate_future_record(&record).unwrap_err(),
                    "WRITE_PREVIEW_CHANGED"
                );
            }
        });
    }
    #[test]
    fn future_anchor_binds_plan_steps_and_locks_without_enabling_send() {
        tauri::async_runtime::block_on(async {
            let (pool, vault, mut record) = fixture(create()).await;
            let frozen: Value = serde_json::from_str(include_str!(
                "../../tests/fixtures/calendar-future-operation.json"
            ))
            .unwrap();
            let id = frozen["preview"]["operationId"].as_str().unwrap();
            write_outbox::dispatch(
                &pool,
                write_outbox::Request::Insert {
                    operation: serde_json::from_value(frozen.clone()).unwrap(),
                },
            )
            .await
            .unwrap();
            record.preview = frozen["preview"].clone();
            record.future = Some(frozen["future"].clone());
            persist(&pool, &vault, "owner", id, &record, None)
                .await
                .unwrap();
            assert_eq!(
                json!(anchor(&vault, "owner", id).unwrap().lock_keys),
                record.preview["lockKeys"]
            );
            assert_eq!(
                ledger(&pool, &vault, "owner", id, "grant")
                    .await
                    .unwrap()
                    .future,
                record.future
            );
            let mut next = record.clone();
            next.version += 1;
            next.future.as_mut().unwrap()["compensation"] = json!({"state":"applying","outcomeUnknown":true,"etag":"latest","proof":{"etag":"p2"}});
            persist(&pool, &vault, "owner", id, &next, None)
                .await
                .unwrap();
            assert_eq!(
                ledger(&pool, &vault, "owner", id, "grant")
                    .await
                    .unwrap()
                    .future,
                next.future
            );
            let http = FakeHttp::new();
            assert_eq!(
                execute(&pool, &vault, &http, "owner", id, "grant", true)
                    .await
                    .unwrap_err(),
                "WRITE_UNSUPPORTED"
            );
            assert!(confirmation_message(&record.preview)
                .unwrap()
                .contains("本次及以后"));
            assert_eq!(http.writes.load(Ordering::SeqCst), 0);
            sqlx::query(
                "UPDATE calendar_write_outbox SET native_payload=?,native_previous=NULL WHERE id=?",
            )
            .bind(serde_json::to_string(&record).unwrap())
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
            assert!(ledger(&pool, &vault, "owner", id, "grant").await.is_err());
        });
    }
    fn create() -> Value {
        json!({"kind":"create","fields":{"title":"Meeting","time":{"kind":"all-day","startOn":"2026-09-09","endOnExclusive":"2026-09-10"},"attendees":[{"email":"guest@example.com","optional":false}]}})
    }
    #[test]
    fn native_authority_detects_sql_tamper_rollback_and_fake_mirror_success() {
        tauri::async_runtime::block_on(async {
            let (pool, vault, record) = fixture(create()).await;
            let original = serde_json::to_value(&record).unwrap().to_string();
            sqlx::query(
                "UPDATE calendar_write_outbox SET state='applied',payload='{}' WHERE id='op'",
            )
            .execute(&pool)
            .await
            .unwrap();
            assert_eq!(
                ledger(&pool, &vault, "owner", "op", "grant")
                    .await
                    .unwrap()
                    .state,
                "confirmed"
            );
            assert!(ledger(&pool, &vault, "owner", "op", "other-account-grant")
                .await
                .is_err());
            let mut next = record.clone();
            next.state = "applying".into();
            next.outcome_unknown = true;
            next.version += 1;
            persist(&pool, &vault, "owner", "op", &next, None)
                .await
                .unwrap();
            sqlx::query("UPDATE calendar_write_outbox SET native_payload=? WHERE id='op'")
                .bind(original)
                .execute(&pool)
                .await
                .unwrap();
            assert!(ledger(&pool, &vault, "owner", "op", "grant").await.is_err());
            let http = FakeHttp::new();
            assert!(execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .is_err());
            assert_eq!(http.writes.load(Ordering::SeqCst), 0);
            sqlx::query("DELETE FROM calendar_write_outbox")
                .execute(&pool)
                .await
                .unwrap();
            assert!(ledger(&pool, &vault, "owner", "op", "grant").await.is_err());
            assert_eq!(indexed(&vault, "owner").unwrap().len(), 1);
        });
    }
    #[test]
    fn applying_anchor_precedes_write_and_lost_response_only_reconciles() {
        tauri::async_runtime::block_on(async {
            let (pool, vault, _) = fixture(create()).await;
            let mut http = FakeHttp::new();
            http.lose = true;
            let result = execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .unwrap();
            assert_eq!(result["outcomeUnknown"], true);
            assert_eq!(anchor(&vault, "owner", "op").unwrap().state, "applying");
            assert!(execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .is_err());
            assert_eq!(
                execute(&pool, &vault, &http, "owner", "op", "grant", true)
                    .await
                    .unwrap()["state"],
                "applied"
            );
            assert_eq!(http.writes.load(Ordering::SeqCst), 1);
            let (pool, vault, _) = fixture(create()).await;
            vault.fail.store(true, Ordering::SeqCst);
            let http = FakeHttp::new();
            assert!(execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .is_err());
            assert_eq!(http.writes.load(Ordering::SeqCst), 0);
            assert_eq!(
                ledger(&pool, &vault, "owner", "op", "grant")
                    .await
                    .unwrap()
                    .state,
                "confirmed"
            );
        });
    }
    #[test]
    fn single_event_verbs_if_match_rsvp_and_delete_unknown_contract() {
        tauri::async_runtime::block_on(async {
            for kind in ["update", "cancel", "delete", "rsvp"] {
                let mut intent = json!({"kind":kind,"eventId":"mevent123","etag":"v1"});
                if kind == "update" {
                    intent["fields"] = json!({"title":"Changed"});
                }
                if kind == "rsvp" {
                    intent["selfEmail"] = json!("me@example.com");
                    intent["response"] = json!("accepted");
                }
                let (pool, vault, _) = fixture(intent).await;
                let mut http = FakeHttp::new();
                http.lose = kind == "delete";
                *http.event.lock().unwrap() = Some(
                    json!({"id":"mevent123","etag":"v1","organizer":{"self":true},"attendees":[{"email":"me@example.com","self":true}]}),
                );
                let result = execute(&pool, &vault, &http, "owner", "op", "grant", false)
                    .await
                    .unwrap();
                let requests = http.requests.lock().unwrap().clone();
                let write = requests.iter().find(|r| r.0 != "GET").unwrap();
                assert_eq!(write.1.as_deref(), Some("v1"));
                assert_eq!(write.0, if kind == "delete" { "DELETE" } else { "PATCH" });
                if kind == "rsvp" {
                    assert_eq!(write.2.as_ref().unwrap()["attendeesOmitted"], true);
                }
                if kind == "delete" {
                    assert_eq!(result["outcomeUnknown"], true);
                    assert_eq!(
                        execute(&pool, &vault, &http, "owner", "op", "grant", true)
                            .await
                            .unwrap()["outcomeUnknown"],
                        true
                    );
                } else {
                    assert_eq!(result["state"], "applied");
                }
            }
        });
    }
    #[test]
    fn successful_http_keyring_commit_failure_recovers_anchored_applying_without_resend() {
        tauri::async_runtime::block_on(async {
            let (pool, vault, _) = fixture(create()).await;
            let http = FakeHttp::new();
            vault.fail_applied.store(true, Ordering::SeqCst);
            assert!(execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .is_err());
            assert_eq!(http.writes.load(Ordering::SeqCst), 1);
            assert_eq!(
                ledger(&pool, &vault, "owner", "op", "grant")
                    .await
                    .unwrap()
                    .state,
                "applying"
            );
            vault.fail_applied.store(false, Ordering::SeqCst);
            assert_eq!(
                execute(&pool, &vault, &http, "owner", "op", "grant", true)
                    .await
                    .unwrap()["state"],
                "applied"
            );
            assert_eq!(http.writes.load(Ordering::SeqCst), 1);
        });
    }
    #[test]
    fn confirmation_is_readable_bounded_and_timezones_are_explicitly_supported() {
        let mut preview =
            json!({"calendarId":"cal","eventId":"id","sendUpdates":"all","intent":create()});
        let text = confirmation_message(&preview).unwrap();
        assert!(
            text.contains("创建日程")
                && text.contains("guest@example.com")
                && text.contains("2026-09-09")
        );
        preview["intent"]["fields"]["time"] = json!({"kind":"fixed","startAt":"2026-09-09T01:00:00Z","endAt":"2026-09-09T02:00:00Z","timezone":"Asia/Shanghai"});
        assert!(confirmation_message(&preview)
            .unwrap()
            .contains("09:00:00 +08:00"));
        preview["intent"]["fields"]["time"]["timezone"] = json!("Made/Up");
        assert!(confirmation_message(&preview).is_err());
        preview["intent"] = create();
        preview["calendarId"] = json!("x".repeat(1600));
        assert_eq!(
            confirmation_message(&preview).unwrap_err(),
            "WRITE_PREVIEW_TOO_LARGE"
        );
        preview["calendarId"] = json!("cal");
        preview["intent"]["fields"]["attendees"] =
            json!(vec![json!({"email":"g@example.com","optional":false}); 13]);
        assert!(confirmation_message(&preview).is_err());
    }
    #[test]
    fn local_batch_reads_latest_remote_edit_and_is_anchored_without_touching_sync_cursor() {
        tauri::async_runtime::block_on(async {
            let (pool, vault, _) = fixture(create()).await;
            let http = FakeHttp::new();
            sqlx::query("CREATE TABLE study_state(id INTEGER,version INTEGER,payload TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO study_state VALUES(1,4,?)").bind(json!({"version":4,"commandReceipts":[],"calendarSources":[],"calendarEvents":[],"tasks":[]}).to_string()).execute(&pool).await.unwrap();
            execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .unwrap();
            http.event.lock().unwrap().as_mut().unwrap()["summary"] = json!("Later remote edit");
            let scopes = vec![LIST_SCOPE.into(), EVENT_SCOPE.into()];
            let batch = write_local::stage(&pool, &vault, &http, "owner", "op", "grant", &scopes)
                .await
                .unwrap();
            assert_eq!(batch["items"][0]["summary"], "Later remote edit");
            assert_eq!(batch["operationId"], "op");
            assert_eq!(batch["mode"], "incremental");
            assert_eq!(
                write_local::stage(&pool, &vault, &http, "owner", "op", "grant", &scopes)
                    .await
                    .unwrap(),
                batch
            );
            let downgraded = write_local::stage(
                &pool,
                &vault,
                &http,
                "owner",
                "op",
                "grant",
                &[LIST_SCOPE.into(), BUSY_SCOPE.into()],
            )
            .await
            .unwrap();
            assert_eq!(downgraded["access"], "freebusy");
            assert_eq!(downgraded["items"], json!([]));
            assert_ne!(downgraded["batchId"], batch["batchId"]);
            assert_eq!(http.writes.load(Ordering::SeqCst), 1);
            let tables: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM sqlite_master WHERE name='calendar_connector_sync'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(tables, 0);
        });
    }
    #[test]
    fn read_scope_survives_write_downgrade_but_never_authorizes_mutation() {
        let scopes = vec![LIST_SCOPE.into(), EVENT_SCOPE.into()];
        assert!(http_scope_allowed(
            "GET",
            "users/me/calendarList/cal",
            &scopes
        ));
        assert!(http_scope_allowed(
            "GET",
            "calendars/cal/events/id",
            &scopes
        ));
        for method in ["POST", "PATCH", "DELETE"] {
            assert!(!http_scope_allowed(
                method,
                "calendars/cal/events/id",
                &scopes
            ));
        }
        assert!(!http_scope_allowed(
            "GET",
            "calendars/cal/events/id",
            &[BUSY_SCOPE.into()]
        ));
        assert!(!http_scope_allowed("GET", "https://evil.test", &scopes));
    }
    #[test]
    fn local_ack_checks_real_sqlite_projection_not_a_forged_success_receipt() {
        tauri::async_runtime::block_on(async {
            let fixtures: Value = serde_json::from_str(include_str!(
                "../../tests/fixtures/calendar-write-projection.json"
            ))
            .unwrap();
            for case in fixtures["cases"].as_array().unwrap() {
                let (pool, vault, mut record) = fixture(create()).await;
                let mut batch = case["batch"].clone();
                batch["operationId"] = json!("op");
                let mut current = case["current"].clone();
                let receipt_index = current["commandReceipts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .position(|r| r["idempotencyKey"] == batch["batchId"])
                    .unwrap();
                current["commandReceipts"][receipt_index]["result"]["data"]["operationId"] =
                    json!("op");
                current["commandReceipts"][receipt_index]["expiresAt"] =
                    json!("2999-01-01T00:00:00.000Z");
                record.preview["connectionId"] = batch["connectionId"].clone();
                record.preview["calendarId"] = batch["calendarId"].clone();
                record.preview["eventId"] = json!("remote-event");
                record.state = "applied".into();
                record.result = Some(result(&record.preview, json!("v2")));
                record.version += 1;
                record.local = Some(write_local::LocalBinding {
                    base: case["base"].clone(),
                    batch: batch.clone(),
                    receipt_id: None,
                });
                persist(&pool, &vault, "owner", "op", &record, None)
                    .await
                    .unwrap();
                sqlx::query("CREATE TABLE study_state(id INTEGER,version INTEGER,payload TEXT)")
                    .execute(&pool)
                    .await
                    .unwrap();
                sqlx::query(
                    "CREATE TABLE calendar_connector_sync(owner TEXT, calendar TEXT, payload TEXT)",
                )
                .execute(&pool)
                .await
                .unwrap();
                sqlx::query("INSERT INTO calendar_connector_sync VALUES('owner','calendar','ordinary-cursor-sentinel')")
                    .execute(&pool)
                    .await
                    .unwrap();
                let mut forged = current.clone();
                forged["calendarEvents"][0]["title"] = json!("forged projection");
                sqlx::query("INSERT INTO study_state VALUES(1,4,?)")
                    .bind(forged.to_string())
                    .execute(&pool)
                    .await
                    .unwrap();
                let receipt = current["commandReceipts"][receipt_index]["id"]
                    .as_str()
                    .unwrap();
                let batch_id = batch["batchId"].as_str().unwrap();
                assert!(
                    write_local::ack(&pool, &vault, "owner", "op", "grant", batch_id, receipt)
                        .await
                        .is_err(),
                    "{}",
                    case["name"]
                );
                sqlx::query("UPDATE study_state SET payload=?")
                    .bind(current.to_string())
                    .execute(&pool)
                    .await
                    .unwrap();
                assert_eq!(
                    write_local::ack(&pool, &vault, "owner", "op", "grant", batch_id, receipt)
                        .await
                        .unwrap()["applied"],
                    true,
                    "{}",
                    case["name"]
                );
                assert!(ledger(&pool, &vault, "owner", "op", "grant")
                    .await
                    .unwrap()
                    .local
                    .unwrap()
                    .receipt_id
                    .is_some());
                let unchanged: String = sqlx::query_scalar("SELECT payload FROM study_state")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(unchanged, current.to_string());
            }
        });
    }
    #[test]
    fn local_ack_accepts_only_the_ts_recurrence_projection_fixture() {
        tauri::async_runtime::block_on(async {
            let fixtures: Value = serde_json::from_str(include_str!(
                "../../tests/fixtures/calendar-recurrence-projection.json"
            ))
            .unwrap();
            for case in fixtures["cases"].as_array().unwrap() {
                let (pool, vault, mut record) = fixture(create()).await;
                let batch = case["batch"].clone();
                let plan = &batch["plan"];
                let intent = if plan["kind"] == "recurring.single" {
                    json!({"kind":"recurring.single","parent":{"eventId":plan["parentEventId"],"etag":"p1"},"originalStart":plan["originalStart"],"instance":{"eventId":plan["instanceEventId"],"etag":"i1"},"action":"cancel"})
                } else {
                    json!({"kind":"recurring.series","parent":{"eventId":plan["parentEventId"],"etag":"p1"},"fields":{"title":"Series"}})
                };
                record.preview = json!({"operationId":"op","connectionId":batch["connectionId"],"calendarId":batch["calendarId"],"eventId":if plan["kind"] == "recurring.single" {plan["instanceEventId"].clone()} else {plan["parentEventId"].clone()},"hash":plan["hash"],"intent":intent,"sendUpdates":"all"});
                record.state = "applied".into();
                record.result = Some(result(&record.preview, json!("v2")));
                record.version += 1;
                record.local = Some(write_local::LocalBinding {
                    base: case["base"].clone(),
                    batch: batch.clone(),
                    receipt_id: None,
                });
                persist(&pool, &vault, "owner", "op", &record, None)
                    .await
                    .unwrap();
                sqlx::query("CREATE TABLE study_state(id INTEGER,version INTEGER,payload TEXT)")
                    .execute(&pool)
                    .await
                    .unwrap();
                sqlx::query(
                    "CREATE TABLE calendar_connector_sync(owner TEXT, calendar TEXT, payload TEXT)",
                )
                .execute(&pool)
                .await
                .unwrap();
                sqlx::query("INSERT INTO calendar_connector_sync VALUES('owner','calendar','ordinary-cursor-sentinel')")
                    .execute(&pool)
                    .await
                    .unwrap();
                let mut current = case["current"].clone();
                let receipt_index = current["commandReceipts"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .position(|r| r["idempotencyKey"] == batch["batchId"])
                    .unwrap();
                current["commandReceipts"][receipt_index]["expiresAt"] =
                    json!("2999-01-01T00:00:00.000Z");
                sqlx::query("INSERT INTO study_state VALUES(1,4,?)")
                    .bind(current.to_string())
                    .execute(&pool)
                    .await
                    .unwrap();
                let receipt = current["commandReceipts"][receipt_index]["id"]
                    .as_str()
                    .unwrap();
                assert_eq!(
                    write_local::ack(
                        &pool,
                        &vault,
                        "owner",
                        "op",
                        "grant",
                        batch["batchId"].as_str().unwrap(),
                        receipt
                    )
                    .await
                    .unwrap()["applied"],
                    true,
                    "{}",
                    case["name"]
                );
                let mut tampered = current.clone();
                tampered["commandReceipts"][receipt_index]["result"]["data"]["writeProjection"]
                    ["plan"]["hash"] = json!("sha256:forged");
                sqlx::query("UPDATE study_state SET payload=?")
                    .bind(tampered.to_string())
                    .execute(&pool)
                    .await
                    .unwrap();
                assert!(
                    write_local::ack(
                        &pool,
                        &vault,
                        "owner",
                        "op",
                        "grant",
                        batch["batchId"].as_str().unwrap(),
                        receipt
                    )
                    .await
                    .is_err(),
                    "{}",
                    case["name"]
                );
                let cursor: String = sqlx::query_scalar(
                    "SELECT payload FROM calendar_connector_sync WHERE owner='owner' AND calendar='calendar'",
                )
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(
                    cursor, "ordinary-cursor-sentinel",
                    "{} must preserve ordinary sync cursor state",
                    case["name"]
                );
            }
        });
    }
    #[test]
    fn confirmation_tickets_are_process_scoped_expiring_and_single_use() {
        let id = "ticket-test";
        TICKETS
            .get_or_init(Default::default)
            .lock()
            .unwrap()
            .insert(id.into(), ("hash".into(), 7, now().unwrap() + 60, false));
        assert!(ticket(id, "wrong", 7, false).is_err());
        assert!(ticket(id, "hash", 8, false).is_err());
        assert!(ticket("after-restart", "hash", 7, false).is_err());
        ticket(id, "hash", 7, true).unwrap();
        assert!(ticket(id, "hash", 7, true).is_err());
        TICKETS
            .get()
            .unwrap()
            .lock()
            .unwrap()
            .insert(id.into(), ("hash".into(), 7, 0, false));
        assert!(ticket(id, "hash", 7, false).is_err());
        assert!(!ENABLED.load(Ordering::SeqCst));
    }

    #[test]
    fn recurring_single_and_series_use_frozen_target_etags_and_only_reconcile_unknown_results() {
        tauri::async_runtime::block_on(async {
            let single = json!({"kind":"recurring.single","parent":{"eventId":"parent","etag":"p1"},"originalStart":"2026-09-09T09:00:00Z","instance":{"eventId":"instance","etag":"i1"},"action":"update","fields":{"time":{"kind":"fixed","startAt":"2026-09-09T11:00:00Z","endAt":"2026-09-09T12:00:00Z","timezone":"UTC"}}});
            let (pool, vault, record) = fixture(single).await;
            let message = confirmation_message(&record.preview).unwrap();
            assert!(
                message.contains("单次日程（single occurrence）")
                    && message.contains("系列 ID：parent")
                    && message.contains("实例 ID：instance")
            );
            let http = FakeHttp::new();
            http.parents.lock().unwrap().insert(
                "parent".into(),
                json!({"id":"parent","etag":"p1","recurrence":["RRULE:FREQ=DAILY"]}),
            );
            *http.event.lock().unwrap() = Some(
                json!({"id":"instance","etag":"i1","recurringEventId":"parent","originalStartTime":{"dateTime":"2026-09-09T09:00:00Z"},"start":{"dateTime":"2026-09-09T09:00:00Z","timeZone":"UTC"},"end":{"dateTime":"2026-09-09T10:00:00Z","timeZone":"UTC"}}),
            );
            assert_eq!(
                execute(&pool, &vault, &http, "owner", "op", "grant", false)
                    .await
                    .unwrap()["state"],
                "applied"
            );
            assert_eq!(
                http.requests
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|v| v.0 == "PATCH")
                    .unwrap()
                    .1
                    .as_deref(),
                Some("i1")
            );

            let (pool, vault, series_record) = fixture(json!({"kind":"recurring.series","parent":{"eventId":"parent","etag":"p1"},"action":"cancel"})).await;
            assert!(confirmation_message(&series_record.preview)
                .unwrap()
                .contains("整个系列（entire series）"));
            let mut http = FakeHttp::new();
            http.reject = 412;
            *http.event.lock().unwrap() = Some(
                json!({"id":"parent","etag":"p1","recurrence":["RRULE:FREQ=DAILY"],"organizer":{"self":true}}),
            );
            assert_eq!(
                execute(&pool, &vault, &http, "owner", "op", "grant", false)
                    .await
                    .unwrap()["state"],
                "conflict"
            );

            let (pool, vault, _) = fixture(json!({"kind":"recurring.single","parent":{"eventId":"parent","etag":"p1"},"originalStart":"2026-09-09T09:00:00Z","instance":{"eventId":"instance","etag":"i1"},"action":"cancel"})).await;
            let http = FakeHttp::new();
            *http.event.lock().unwrap() = Some(
                json!({"id":"instance","etag":"i1","recurringEventId":"parent","originalStartTime":{"dateTime":"2026-09-10T09:00:00Z"},"organizer":{"self":true}}),
            );
            assert!(execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .is_err());
            assert_eq!(http.writes.load(Ordering::SeqCst), 0);
        });
    }

    #[test]
    fn recurring_proof_rejects_marker_on_the_wrong_instance_or_original_start_and_locks_parent() {
        tauri::async_runtime::block_on(async {
            let intent = json!({"kind":"recurring.single","parent":{"eventId":"parent","etag":"p1"},"originalStart":"2026-09-09T09:00:00Z","instance":{"eventId":"instance","etag":"i1"},"action":"cancel"});
            let (pool, vault, record) = fixture(intent).await;
            let http = FakeHttp::new();
            *http.event.lock().unwrap() = Some(
                json!({"id":"wrong","etag":"i1","recurringEventId":"parent","originalStartTime":{"dateTime":"2026-09-09T09:00:00Z"},"organizer":{"self":true}}),
            );
            assert!(execute(&pool, &vault, &http, "owner", "op", "grant", false)
                .await
                .is_err());
            assert_eq!(http.writes.load(Ordering::SeqCst), 0);

            let mut applying = anchor(&vault, "owner", "op").unwrap();
            applying.state = "applying".into();
            applying.previous = Some("op".into());
            applying.lock_keys = vec!["parent".into(), "other-instance".into()];
            vault
                .set(
                    &anchor_key("owner", "other"),
                    &serde_json::to_string(&applying).unwrap(),
                )
                .unwrap();
            vault.set(&head_key("owner"), "other").unwrap();
            *http.event.lock().unwrap() = Some(
                json!({"id":"instance","etag":"i1","recurringEventId":"parent","originalStartTime":{"dateTime":"2026-09-09T09:00:00Z"},"organizer":{"self":true}}),
            );
            assert_eq!(
                execute(&pool, &vault, &http, "owner", "op", "grant", false)
                    .await
                    .unwrap_err(),
                "WRITE_BUSY"
            );

            let mut marker_event = json!({"id":"instance","etag":"v2","recurringEventId":"parent","originalStartTime":{"dateTime":"2026-09-10T09:00:00Z"},"status":"cancelled","extendedProperties":{"private":{"meowOperationId":"op","meowOperationHash":record.preview["hash"]}}});
            assert!(!proof(&record.preview, &marker_event).unwrap());
            marker_event["originalStartTime"] = json!({"dateTime":"2026-09-09T09:00:00+00:00"});
            assert!(proof(&record.preview, &marker_event).unwrap());
        });
    }
}
#[allow(dead_code)] // Unwired parser prerequisite; not local attachment evidence.
#[path = "calendar_workspace_parse.rs"]
mod workspace_parse;

#[path = "calendar_write_future_local.rs"]
mod future_local;
#[cfg(test)]
#[path = "calendar_write_future_step.rs"]
mod future_step;
