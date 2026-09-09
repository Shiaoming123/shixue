//! Google read-only transport. Credentials and pagination never cross IPC.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use keyring::Entry;
use reqwest::{redirect::Policy, Client, Response, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    net::TcpListener,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
#[path = "calendar_connections_store.rs"]
mod sync_store;
#[cfg(feature = "calendar-writes")]
#[path = "calendar_write_native.rs"]
mod write_native;
#[path = "calendar_write_outbox.rs"]
mod write_outbox;

const SERVICE: &str = "meow-study:calendar-google";
const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const API: &str = "https://www.googleapis.com/calendar/v3/";
const LIST_SCOPE: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const EVENT_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events.readonly";
const BUSY_SCOPE: &str = "https://www.googleapis.com/auth/calendar.events.freebusy";
const MAX_BODY: usize = 5 * 1024 * 1024;
static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static GENERATIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    client_id: Option<String>,
    connection_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Details,
    Freebusy,
    #[cfg(feature = "calendar-writes")]
    Write,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    state: &'static str,
    granted_scopes: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct Session {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    scopes: Vec<String>,
    #[serde(default)]
    grant_epoch: Option<String>,
}
#[derive(Deserialize)]
struct TokenReply {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    scope: Option<String>,
    token_type: String,
}

#[cfg(not(feature = "calendar-writes"))]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("calendar-connections")
        .invoke_handler(tauri::generate_handler![
            status,
            connect,
            disconnect,
            list_calendars,
            free_busy,
            sync_store::stage_events,
            sync_store::read_staged,
            sync_store::ack_events,
            sync_store::reset_sync,
            write_outbox::outbox_store
        ])
        .build()
}
#[cfg(feature = "calendar-writes")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("calendar-connections")
        .invoke_handler(tauri::generate_handler![
            status,
            connect,
            disconnect,
            list_calendars,
            free_busy,
            sync_store::stage_events,
            sync_store::read_staged,
            sync_store::ack_events,
            sync_store::reset_sync,
            write_outbox::outbox_store,
            write_native::write_prepare,
            write_native::write_confirm,
            write_native::write_run,
            write_native::write_reconcile,
            write_native::write_lookup,
            write_native::write_disable,
            write_native::write_local::write_stage_local,
            write_native::write_local::write_read_local,
            write_native::write_local::write_ack_local
        ])
        .build()
}
fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_secs())
        .map_err(|_| "CLOCK_INVALID".into())
}
fn client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "HTTP_UNAVAILABLE".into())
}
fn account(config: &Config) -> Result<String, String> {
    if config.connection_id.is_empty()
        || config.connection_id.len() > 128
        || !config
            .connection_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_:".contains(&c))
    {
        return Err("CONFIG_INVALID".into());
    }
    let id = config
        .client_id
        .as_deref()
        .filter(|v| !v.is_empty())
        .ok_or("UNAVAILABLE_CLIENT_ID")?;
    if id.len() > 256
        || !id.ends_with(".apps.googleusercontent.com")
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-._".contains(&c))
    {
        return Err("CONFIG_INVALID".into());
    }
    Ok(format!("{}:{}", id, config.connection_id))
}
fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|_| "CREDENTIAL_STORE_UNAVAILABLE".into())
}
fn load(key: &str) -> Result<Option<Session>, String> {
    match entry(key)?.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| "CREDENTIAL_INVALID".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("CREDENTIAL_READ_FAILED".into()),
    }
}
fn store(key: &str, session: &Session) -> Result<(), String> {
    entry(key)?
        .set_password(&serde_json::to_string(session).map_err(|_| "CREDENTIAL_INVALID")?)
        .map_err(|_| "CREDENTIAL_WRITE_FAILED".into())
}
fn remove(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("CREDENTIAL_DELETE_FAILED".into()),
    }
}
fn generation(key: &str, advance: bool) -> Result<u64, String> {
    let mut map = GENERATIONS
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "CONNECTION_LOCK_FAILED")?;
    let value = map.entry(key.to_owned()).or_default();
    if advance {
        *value += 1;
    }
    Ok(*value)
}
fn summary(session: Option<Session>) -> Status {
    match session {
        Some(s) => Status {
            state: if s.refresh_token.is_some() {
                "ready"
            } else {
                "session-only"
            },
            granted_scopes: s.scopes,
        },
        None => Status {
            state: "disconnected",
            granted_scopes: vec![],
        },
    }
}
fn random() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn form(values: &[(&str, &str)]) -> String {
    let mut out = reqwest::Url::parse("https://unused.invalid/").unwrap();
    out.query_pairs_mut().extend_pairs(values.iter().copied());
    out.query().unwrap_or("").to_owned()
}
async fn read_body(mut response: Response) -> Result<Value, String> {
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "HTTP_READ_FAILED")? {
        if bytes.len() + chunk.len() > MAX_BODY {
            return Err("RESPONSE_TOO_LARGE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| format!("HTTP_INVALID_JSON:{status}"))?;
    Ok(value)
}
async fn read_json(response: Response) -> Result<Value, String> {
    let status = response.status().as_u16();
    let value = read_body(response).await?;
    if !(200..300).contains(&status) {
        if value.get("error").and_then(Value::as_str) == Some("invalid_grant") {
            return Err("REAUTHORIZE".into());
        }
        return Err(format!("HTTP_ERROR:{status}"));
    }
    Ok(value)
}
fn token_session(reply: TokenReply, previous: Option<&Session>) -> Result<Session, String> {
    if reply.token_type != "Bearer"
        || reply.access_token.is_empty()
        || reply.access_token.len() > 16_384
        || reply.expires_in == 0
        || reply
            .refresh_token
            .as_ref()
            .is_some_and(|s| s.is_empty() || s.len() > 16_384)
    {
        return Err("TOKEN_RESPONSE_INVALID".into());
    }
    let scopes = reply
        .scope
        .map(|s| s.split_whitespace().map(str::to_owned).collect())
        .or_else(|| previous.map(|p| p.scopes.clone()))
        .ok_or("TOKEN_SCOPE_MISSING")?;
    Ok(Session {
        access_token: reply.access_token,
        refresh_token: reply
            .refresh_token
            .or_else(|| previous.and_then(|p| p.refresh_token.clone())),
        expires_at: now()?.saturating_add(reply.expires_in),
        scopes,
        grant_epoch: previous.and_then(|p| p.grant_epoch.clone()),
    })
}
async fn authorized(
    key: &str,
    config: &Config,
    stale_token: Option<&str>,
) -> Result<Session, String> {
    let _guard = GATE.lock().await;
    let previous = load(key)?.ok_or("DISCONNECTED")?;
    if previous.expires_at > now()?.saturating_add(60)
        && stale_token != Some(previous.access_token.as_str())
    {
        return Ok(previous);
    }
    let refresh = previous.refresh_token.as_deref().ok_or("REAUTHORIZE")?;
    let response = client()?
        .post(TOKEN)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form(&[
            ("client_id", config.client_id.as_deref().unwrap()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh),
        ]))
        .send()
        .await
        .map_err(|_| "HTTP_REQUEST_FAILED")?;
    let value = match read_json(response).await {
        Err(e) if e == "REAUTHORIZE" => {
            remove(key)?;
            return Err(e);
        }
        value => value?,
    };
    let next = token_session(
        serde_json::from_value(value).map_err(|_| "TOKEN_RESPONSE_INVALID")?,
        Some(&previous),
    )?;
    store(key, &next)?;
    Ok(next)
}

#[tauri::command]
pub fn status(config: Config) -> Result<Status, String> {
    if config.client_id.as_deref().is_none_or(str::is_empty) {
        return Ok(Status {
            state: "unavailable",
            granted_scopes: vec![],
        });
    }
    Ok(summary(load(&account(&config)?)?))
}
fn callback(request: &str, state: &str) -> Option<Result<String, String>> {
    let mut line = request.lines().next()?.split_whitespace();
    if line.next()? != "GET" {
        return None;
    }
    let path = line.next()?;
    if !path.starts_with("/oauth/callback?") {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1{path}")).ok()?;
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.iter().filter(|(k, _)| k == "state").count() != 1
        || pairs.iter().find(|(k, _)| k == "state")?.1 != state
    {
        return None;
    }
    if pairs.iter().any(|(k, _)| k == "error") {
        return Some(Err("AUTHORIZATION_DENIED".into()));
    }
    if pairs.iter().filter(|(k, _)| k == "code").count() != 1 {
        return Some(Err("CALLBACK_INVALID".into()));
    }
    let code = pairs.iter().find(|(k, _)| k == "code")?.1.to_string();
    Some(if code.is_empty() || code.len() > 8192 {
        Err("CALLBACK_INVALID".into())
    } else {
        Ok(code)
    })
}
fn wait_callback(
    listener: TcpListener,
    state: String,
    key: String,
    epoch: u64,
    timeout: Duration,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "CALLBACK_UNAVAILABLE")?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if generation(&key, false)? != epoch {
            return Err("AUTHORIZATION_CANCELLED".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_millis(200)))
                    .map_err(|_| "CALLBACK_UNAVAILABLE")?;
                let mut buffer = [0u8; 12_288];
                let mut size = 0;
                let request_deadline = Instant::now() + Duration::from_secs(1);
                while size < buffer.len() && Instant::now() < request_deadline {
                    match stream.read(&mut buffer[size..]) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            size += count;
                            if buffer[..size].windows(4).any(|v| v == b"\r\n\r\n") {
                                break;
                            }
                        }
                    }
                }
                if let Some(result) = callback(&String::from_utf8_lossy(&buffer[..size]), &state) {
                    let body = "Return to Shixue. This window can be closed.";
                    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
                    return result;
                }
                let _ = stream.write_all(
                    b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
                );
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(_) => return Err("CALLBACK_UNAVAILABLE".into()),
        }
    }
    Err("AUTHORIZATION_TIMEOUT".into())
}
#[tauri::command]
pub async fn connect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    mode: Mode,
) -> Result<Status, String> {
    let key = account(&config)?;
    let epoch = generation(&key, true)?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "CALLBACK_UNAVAILABLE")?;
    let redirect = format!(
        "http://127.0.0.1:{}/oauth/callback",
        listener
            .local_addr()
            .map_err(|_| "CALLBACK_UNAVAILABLE")?
            .port()
    );
    let state = random()?;
    let verifier = random()?;
    let scopes = match mode {
        Mode::Details => format!("{LIST_SCOPE} {EVENT_SCOPE} {BUSY_SCOPE}"),
        Mode::Freebusy => format!("{LIST_SCOPE} {BUSY_SCOPE}"),
        #[cfg(feature = "calendar-writes")]
        Mode::Write => format!("{LIST_SCOPE} {EVENT_SCOPE} {BUSY_SCOPE} https://www.googleapis.com/auth/calendar.events"),
    };
    let mut url = Url::parse(AUTH).unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", config.client_id.as_deref().unwrap()),
        ("redirect_uri", &redirect),
        ("response_type", "code"),
        ("access_type", "offline"),
        ("scope", &scopes),
        ("state", &state),
        ("code_challenge", &challenge(&verifier)),
        ("code_challenge_method", "S256"),
    ]);
    app.opener()
        .open_url(url.to_string(), None::<&str>)
        .map_err(|_| "BROWSER_UNAVAILABLE")?;
    let callback_key = key.clone();
    let code = tauri::async_runtime::spawn_blocking(move || {
        wait_callback(
            listener,
            state,
            callback_key,
            epoch,
            Duration::from_secs(300),
        )
    })
    .await
    .map_err(|_| "CALLBACK_UNAVAILABLE")??;
    let response = client()?
        .post(TOKEN)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form(&[
            ("client_id", config.client_id.as_deref().unwrap()),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("code_verifier", &verifier),
        ]))
        .send()
        .await
        .map_err(|_| "HTTP_REQUEST_FAILED")?;
    let mut session = token_session(
        serde_json::from_value(read_json(response).await?).map_err(|_| "TOKEN_RESPONSE_INVALID")?,
        None,
    )?;
    session.grant_epoch = Some(random()?);
    let _guard = GATE.lock().await;
    if generation(&key, false)? != epoch {
        return Err("AUTHORIZATION_CANCELLED".into());
    }
    sync_store::invalidate(&app, &key).await?;
    store(&key, &session)?;
    Ok(summary(Some(session)))
}
#[tauri::command]
pub async fn disconnect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    revoke: bool,
) -> Result<Status, String> {
    let key = account(&config)?;
    generation(&key, true)?;
    let _guard = GATE.lock().await;
    let session = load(&key)?;
    remove(&key)?;
    sync_store::invalidate(&app, &key).await?;
    if revoke {
        if let Some(session) = session {
            let token = session
                .refresh_token
                .as_deref()
                .unwrap_or(&session.access_token);
            let response = client()?
                .post("https://oauth2.googleapis.com/revoke")
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(form(&[("token", token)]))
                .send()
                .await
                .map_err(|_| "DISCONNECTED_REVOCATION_UNCONFIRMED")?;
            if !response.status().is_success() {
                return Err("DISCONNECTED_REVOCATION_UNCONFIRMED".into());
            }
        }
    }
    Ok(summary(None))
}
#[derive(Debug, PartialEq, Eq)]
enum ReadOutcome {
    Success,
    Refresh,
    Retry,
    Fail,
}
fn classify_read(status: u16, body: Option<&Value>) -> ReadOutcome {
    if (200..300).contains(&status) {
        return ReadOutcome::Success;
    }
    if status == 401 {
        return ReadOutcome::Refresh;
    }
    let quota = status == 403
        && body
            .and_then(|v| v["error"]["errors"].as_array())
            .is_some_and(|errors| {
                !errors.is_empty()
                    && errors.iter().all(|error| {
                        matches!(
                            error["reason"].as_str(),
                            Some("rateLimitExceeded" | "userRateLimitExceeded")
                        )
                    })
            });
    if status == 429 || (500..600).contains(&status) || quota {
        ReadOutcome::Retry
    } else {
        ReadOutcome::Fail
    }
}
fn retry_delay(attempt: u32, retry_after: Option<&str>, now_seconds: u64, jitter: u8) -> Duration {
    let server_ms = retry_after
        .and_then(|value| {
            value.trim().parse::<u64>().ok().or_else(|| {
                chrono::DateTime::parse_from_rfc2822(value)
                    .ok()
                    .map(|date| date.timestamp().max(0) as u64)
                    .map(|date| date.saturating_sub(now_seconds))
            })
        })
        .map(|seconds| seconds.saturating_mul(1000))
        .unwrap_or(0);
    Duration::from_millis(
        server_ms
            .max(250 * (1u64 << attempt.min(2)) + u64::from(jitter % 151))
            .min(10_000),
    )
}
async fn retry_wait(key: &str, epoch: u64, delay: Duration) -> Result<(), String> {
    let deadline = Instant::now() + delay;
    loop {
        if generation(key, false)? != epoch {
            return Err("DISCONNECTED".into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(());
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(50))).await;
    }
}
async fn read_api(
    config: &Config,
    path: &str,
    query: &[(&str, &str)],
    body: Option<&Value>,
    required: &str,
) -> Result<Value, String> {
    let key = account(config)?;
    let epoch = generation(&key, false)?;
    let mut stale_token = None;
    let mut refreshed = false;
    let client = client()?;
    // The three-attempt budget includes the one optional 401 refresh retry.
    for attempt in 0..3 {
        if generation(&key, false)? != epoch {
            return Err("DISCONNECTED".into());
        }
        let session = authorized(&key, config, stale_token.as_deref()).await?;
        if generation(&key, false)? != epoch {
            return Err("DISCONNECTED".into());
        }
        if !session.scopes.iter().any(|s| s == required) {
            return Err("SCOPE_REQUIRED".into());
        }
        let request = if let Some(body) = body {
            client.post(format!("{API}{path}")).json(body)
        } else {
            client.get(format!("{API}{path}")).query(query)
        };
        let response = request.bearer_auth(&session.access_token).send().await;
        if generation(&key, false)? != epoch {
            return Err("DISCONNECTED".into());
        }
        let response = response.map_err(|_| "HTTP_REQUEST_FAILED")?;
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("Retry-After")
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        let parsed = read_body(response).await;
        if generation(&key, false)? != epoch {
            return Err("DISCONNECTED".into());
        }
        match classify_read(status, parsed.as_ref().ok()) {
            ReadOutcome::Success => return parsed,
            ReadOutcome::Refresh if !refreshed && attempt < 2 => {
                refreshed = true;
                stale_token = Some(session.access_token);
            }
            ReadOutcome::Refresh => return Err("REAUTHORIZE".into()),
            ReadOutcome::Retry if attempt < 2 => {
                let mut jitter = [0u8; 1];
                getrandom::fill(&mut jitter).map_err(|_| "RANDOM_UNAVAILABLE")?;
                retry_wait(
                    &key,
                    epoch,
                    retry_delay(attempt, retry_after.as_deref(), now()?, jitter[0]),
                )
                .await?;
            }
            ReadOutcome::Retry => return Err("HTTP_RETRY_EXHAUSTED".into()),
            ReadOutcome::Fail => return Err(format!("HTTP_ERROR:{status}")),
        }
    }
    Err("HTTP_RETRY_EXHAUSTED".into())
}

fn select(value: &Value, fields: &[&str]) -> Value {
    let mut result = serde_json::Map::new();
    for field in fields {
        if let Some(v) = value
            .get(*field)
            .filter(|v| v.is_string() || v.is_boolean())
        {
            result.insert((*field).into(), v.clone());
        }
    }
    Value::Object(result)
}
#[tauri::command]
pub async fn list_calendars(config: Config) -> Result<Value, String> {
    let key = account(&config)?;
    let epoch = generation(&key, false)?;
    let mut token = String::new();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for _ in 0..100 {
        let mut query = vec![
            ("maxResults", "250"),
            ("showHidden", "true"),
            ("showDeleted", "true"),
        ];
        if !token.is_empty() {
            query.push(("pageToken", &token));
        }
        let page = read_api(&config, "users/me/calendarList", &query, None, LIST_SCOPE).await?;
        for item in page
            .get("items")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            items.push(select(
                item,
                &[
                    "id",
                    "summary",
                    "timeZone",
                    "backgroundColor",
                    "accessRole",
                    "hidden",
                    "selected",
                    "deleted",
                ],
            ));
        }
        if items.len() > 25_000 {
            return Err("BATCH_TOO_LARGE".into());
        }
        match page
            .get("nextPageToken")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        {
            None => {
                let session = load(&key)?.ok_or("DISCONNECTED")?;
                if generation(&key, false)? != epoch {
                    return Err("DISCONNECTED".into());
                }
                for item in &mut items {
                    item["accessRole"] = effective_role(
                        item["accessRole"].as_str().unwrap_or("none"),
                        &session.scopes,
                    )
                    .into();
                }
                return Ok(json!({ "items": items }));
            }
            Some(next) if next.len() <= 16_384 && seen.insert(next.to_owned()) => {
                token = next.to_owned()
            }
            _ => return Err("PAGINATION_INVALID".into()),
        }
    }
    Err("BATCH_TOO_LARGE".into())
}
fn effective_role<'a>(role: &'a str, scopes: &[String]) -> &'a str {
    let details = matches!(role, "reader" | "writer" | "owner");
    if details
        && scopes.iter().any(|scope| {
            scope == EVENT_SCOPE || scope == "https://www.googleapis.com/auth/calendar.events"
        })
    {
        role
    } else if (details || role == "freeBusyReader")
        && scopes.iter().any(|scope| scope == BUSY_SCOPE)
    {
        "freeBusyReader"
    } else {
        "none"
    }
}
fn busy_request(ids: Vec<String>, start: &str, end: &str) -> Result<Value, String> {
    let first = chrono::DateTime::parse_from_rfc3339(start).map_err(|_| "RANGE_INVALID")?;
    let last = chrono::DateTime::parse_from_rfc3339(end).map_err(|_| "RANGE_INVALID")?;
    if last <= first
        || last.signed_duration_since(first).num_days() > 366
        || ids.is_empty()
        || ids.len() > 50
        || ids
            .iter()
            .any(|id| id.is_empty() || id.len() > 1024 || id.chars().any(char::is_control))
    {
        return Err("RANGE_INVALID".into());
    }
    Ok(
        json!({ "timeMin": start, "timeMax": end, "calendarExpansionMax": 50, "items": ids.into_iter().map(|id| json!({"id":id})).collect::<Vec<_>>() }),
    )
}
#[tauri::command]
pub async fn free_busy(
    config: Config,
    calendar_ids: Vec<String>,
    start_at: String,
    end_at: String,
) -> Result<Value, String> {
    let body = busy_request(calendar_ids, &start_at, &end_at)?;
    let value = read_api(&config, "freeBusy", &[], Some(&body), BUSY_SCOPE).await?;
    let calendars = value
        .get("calendars")
        .and_then(Value::as_object)
        .ok_or("RESPONSE_INVALID")?;
    let mut safe = serde_json::Map::new();
    for (id, calendar) in calendars {
        let busy = calendar
            .get("busy")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .map(|r| select(r, &["start", "end"]))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let errors = calendar
            .get("errors")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .map(|r| select(r, &["domain", "reason"]))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        safe.insert(id.clone(), json!({"busy":busy,"errors":errors}));
    }
    Ok(json!({"timeMin":start_at,"timeMax":end_at,"calendars":safe}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_event_write_scope_also_grants_directory_details() {
        let scopes = vec![
            LIST_SCOPE.into(),
            "https://www.googleapis.com/auth/calendar.events".into(),
        ];
        assert_eq!(effective_role("owner", &scopes), "owner");
        assert_eq!(effective_role("reader", &scopes), "reader");
    }
    #[test]
    fn directory_role_requires_the_corresponding_granted_scope() {
        for role in ["owner", "writer", "reader"] {
            assert_eq!(
                effective_role(role, &[LIST_SCOPE.into(), BUSY_SCOPE.into()]),
                "freeBusyReader"
            );
            assert_eq!(effective_role(role, &[EVENT_SCOPE.into()]), role);
            assert_eq!(effective_role(role, &[LIST_SCOPE.into()]), "none");
        }
        assert_eq!(
            effective_role("freeBusyReader", &[EVENT_SCOPE.into()]),
            "none"
        );
        assert_eq!(
            effective_role("freeBusyReader", &[BUSY_SCOPE.into()]),
            "freeBusyReader"
        );
        assert_eq!(
            effective_role("none", &[EVENT_SCOPE.into(), BUSY_SCOPE.into()]),
            "none"
        );
    }
    #[test]
    fn retries_only_quota_403_429_and_server_errors() {
        for status in [429, 500, 503, 599] {
            assert_eq!(classify_read(status, None), ReadOutcome::Retry);
        }
        for reason in ["rateLimitExceeded", "userRateLimitExceeded"] {
            assert_eq!(
                classify_read(403, Some(&json!({"error":{"errors":[{"reason":reason}]}}))),
                ReadOutcome::Retry
            );
        }
        for reason in ["forbidden", "insufficientPermissions", "notFound"] {
            assert_eq!(
                classify_read(403, Some(&json!({"error":{"errors":[{"reason":reason}]}}))),
                ReadOutcome::Fail
            );
        }
        assert_eq!(classify_read(403, None), ReadOutcome::Fail);
        assert_eq!(
            classify_read(403, Some(&json!({"error":{"errors":[]}}))),
            ReadOutcome::Fail
        );
        assert_eq!(
            classify_read(
                403,
                Some(
                    &json!({"error":{"errors":[{"reason":"rateLimitExceeded"},{"reason":"forbidden"}]}})
                )
            ),
            ReadOutcome::Fail
        );
        assert_eq!(classify_read(410, None), ReadOutcome::Fail);
        assert_eq!(classify_read(401, None), ReadOutcome::Refresh);
        assert_eq!(classify_read(200, None), ReadOutcome::Success);
    }
    #[test]
    fn retry_after_seconds_and_dates_are_bounded_and_backoff_has_short_jitter() {
        assert_eq!(retry_delay(0, None, 0, 0), Duration::from_millis(250));
        assert_eq!(retry_delay(1, None, 0, 150), Duration::from_millis(650));
        assert_eq!(retry_delay(0, Some("2"), 0, 0), Duration::from_secs(2));
        assert_eq!(
            retry_delay(0, Some("18446744073709551615"), 0, 0),
            Duration::from_secs(10)
        );
        assert_eq!(
            retry_delay(0, Some("Thu, 01 Jan 1970 00:00:03 GMT"), 1, 0),
            Duration::from_secs(2)
        );
        assert_eq!(
            retry_delay(0, Some("invalid"), 1, 0),
            Duration::from_millis(250)
        );
    }
    #[test]
    fn disconnect_interrupts_backoff_without_another_request() {
        tauri::async_runtime::block_on(async {
            let epoch = generation("retry-test", true).unwrap();
            generation("retry-test", true).unwrap();
            assert_eq!(
                retry_wait("retry-test", epoch, Duration::from_secs(10)).await,
                Err("DISCONNECTED".into())
            );
        });
    }
    #[test]
    fn pkce_matches_rfc_vector() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(random().unwrap().len(), 43);
    }
    #[test]
    fn callback_rejects_wrong_state_path_method_and_duplicates() {
        for value in [
            "GET /oauth/callback?code=x&state=bad HTTP/1.1",
            "GET /other?code=x&state=ok HTTP/1.1",
            "POST /oauth/callback?code=x&state=ok HTTP/1.1",
            "GET /oauth/callback?code=x&state=ok&state=ok HTTP/1.1",
        ] {
            assert!(callback(value, "ok").is_none());
        }
        assert_eq!(
            callback("GET /oauth/callback?code=x&state=ok HTTP/1.1", "ok"),
            Some(Ok("x".into()))
        );
        assert!(callback(
            "GET /oauth/callback?error=access_denied&state=ok HTTP/1.1",
            "ok"
        )
        .unwrap()
        .is_err());
    }
    #[test]
    fn callback_timeout_closes_listener() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        assert!(wait_callback(
            listener,
            "s".into(),
            "timeout-test".into(),
            0,
            Duration::from_millis(5)
        )
        .is_err());
        assert!(std::net::TcpStream::connect(address).is_err());
    }
    #[test]
    fn refresh_preserves_previous_refresh_and_status_has_no_credentials() {
        let previous = Session {
            access_token: "test-access".into(),
            refresh_token: Some("test-refresh".into()),
            scopes: vec![LIST_SCOPE.into()],
            expires_at: 0,
            grant_epoch: Some("grant-test".into()),
        };
        let next = token_session(
            TokenReply {
                access_token: "new-test-access".into(),
                refresh_token: None,
                expires_in: 60,
                scope: None,
                token_type: "Bearer".into(),
            },
            Some(&previous),
        )
        .unwrap();
        assert_eq!(next.refresh_token, previous.refresh_token);
        let encoded = serde_json::to_string(&summary(Some(next))).unwrap();
        assert!(!encoded.contains("test-access"));
        assert!(!encoded.contains("test-refresh"));
    }
    #[test]
    fn busy_has_bounded_range_and_no_details() {
        assert!(busy_request(
            vec!["c".into(); 51],
            "2026-09-09T00:00:00Z",
            "2026-09-10T00:00:00Z"
        )
        .is_err());
        assert!(busy_request(
            vec!["c".into()],
            "2026-09-10T00:00:00Z",
            "2026-09-09T00:00:00Z"
        )
        .is_err());
        assert_eq!(
            select(
                &json!({"id":"c","summary":"ok","nextSyncToken":"private"}),
                &["id", "summary"]
            ),
            json!({"id":"c","summary":"ok"})
        );
    }
}
