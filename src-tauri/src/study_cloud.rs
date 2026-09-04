use std::time::{Duration, SystemTime, UNIX_EPOCH};

use keyring::Entry;
use reqwest::{redirect::Policy, Client, Response, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

const KEYRING_SERVICE: &str = "meow-study:study-cloud-supabase";
const MAX_CONFIG_BYTES: usize = 16 * 1024;
const MAX_PASSWORD_BYTES: usize = 4 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyCloudConfig {
    provider: String,
    project_url: String,
    publishable_key: String,
}

struct ValidatedConfig {
    base_url: Url,
    publishable_key: String,
    keyring_account: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum SessionStatus {
    SignedOut,
    SignedIn {
        #[serde(rename = "userId")]
        user_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        email: Option<String>,
    },
}

#[derive(Deserialize, Serialize)]
struct StoredSession {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
    user_id: String,
    email: Option<String>,
}

#[derive(Deserialize)]
struct AuthUser {
    id: String,
    email: Option<String>,
}

#[derive(Deserialize)]
struct AuthResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    user: Option<AuthUser>,
}

#[derive(Deserialize)]
struct SnapshotRow {
    mutation: Value,
}

#[derive(Serialize)]
pub struct AppliedResult {
    applied: bool,
}

#[tauri::command]
pub async fn study_cloud_sign_in(
    config: StudyCloudConfig,
    email: String,
    password: String,
) -> Result<SessionStatus, String> {
    let config = validate_config(config)?;
    let email = email.trim();
    if email.len() < 3 || email.len() > 320 || !email.contains('@') {
        return Err("Supabase 登录凭据无效".to_string());
    }
    if password.is_empty() || password.len() > MAX_PASSWORD_BYTES {
        return Err("Supabase 登录凭据无效".to_string());
    }

    let client = build_client()?;
    let response = client
        .post(endpoint(&config.base_url, "auth/v1/token")?)
        .query(&[("grant_type", "password")])
        .header("apikey", &config.publishable_key)
        .json(&json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|_| "Supabase 登录请求失败".to_string())?;
    let auth: AuthResponse = read_success_json(response, "Supabase 登录失败").await?;
    let user = auth
        .user
        .ok_or_else(|| "Supabase 登录响应无效".to_string())?;
    let session = StoredSession {
        access_token: validate_token(auth.access_token)?,
        refresh_token: validate_token(auth.refresh_token)?,
        expires_at: unix_timestamp()?.saturating_add(auth.expires_in.max(0)),
        user_id: validate_identity(user.id, 256)?,
        email: user
            .email
            .map(|value| validate_identity(value, 320))
            .transpose()?,
    };
    write_session(&config, &session)?;
    Ok(status_from_session(&session))
}

#[tauri::command]
pub fn study_cloud_session_status(config: StudyCloudConfig) -> Result<SessionStatus, String> {
    let config = validate_config(config)?;
    match read_session(&config)? {
        Some(session) => Ok(status_from_session(&session)),
        None => Ok(SessionStatus::SignedOut),
    }
}

#[tauri::command]
pub fn study_cloud_sign_out(config: StudyCloudConfig) -> Result<SessionStatus, String> {
    let config = validate_config(config)?;
    delete_session(&config)?;
    Ok(SessionStatus::SignedOut)
}

#[tauri::command]
pub async fn study_cloud_pull(config: StudyCloudConfig) -> Result<Option<Value>, String> {
    let config = validate_config(config)?;
    let (client, session) = authenticated_client(&config).await?;
    let response = client
        .get(endpoint(&config.base_url, "rest/v1/study_cloud_snapshots")?)
        .query(&[
            ("select", "mutation"),
            ("record_id", "eq.current"),
            ("limit", "1"),
        ])
        .header("apikey", &config.publishable_key)
        .bearer_auth(&session.access_token)
        .send()
        .await
        .map_err(|_| "Supabase 拉取失败".to_string())?;
    let rows: Vec<SnapshotRow> = read_success_json(response, "Supabase 拉取失败").await?;
    let mutation = rows.into_iter().next().map(|row| row.mutation);
    if let Some(value) = mutation.as_ref() {
        validate_snapshot(value)?;
    }
    Ok(mutation)
}

#[tauri::command]
pub async fn study_cloud_push(
    config: StudyCloudConfig,
    snapshot: Value,
    expected_revision: Option<String>,
) -> Result<AppliedResult, String> {
    let config = validate_config(config)?;
    validate_snapshot(&snapshot)?;
    if expected_revision
        .as_ref()
        .is_some_and(|value| value.is_empty() || value.len() > 512)
    {
        return Err("Supabase CAS revision 无效".to_string());
    }

    let (client, session) = authenticated_client(&config).await?;
    let response = client
        .post(endpoint(
            &config.base_url,
            "rest/v1/rpc/study_cloud_cas_snapshot",
        )?)
        .header("apikey", &config.publishable_key)
        .bearer_auth(&session.access_token)
        .json(&json!({
            "p_snapshot": snapshot,
            "p_expected_revision": expected_revision,
        }))
        .send()
        .await
        .map_err(|_| "Supabase CAS 写入失败".to_string())?;
    let applied: bool = read_success_json(response, "Supabase CAS 写入失败").await?;
    Ok(AppliedResult { applied })
}

fn validate_config(config: StudyCloudConfig) -> Result<ValidatedConfig, String> {
    if config.provider != "supabase"
        || config.publishable_key.is_empty()
        || config.publishable_key.len() > MAX_CONFIG_BYTES
        || config.publishable_key.chars().any(char::is_whitespace)
    {
        return Err("Supabase 项目配置无效".to_string());
    }
    let mut url =
        Url::parse(&config.project_url).map_err(|_| "Supabase 项目配置无效".to_string())?;
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Supabase 项目配置无效".to_string())?;
    let loopback = matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "[::1]");
    let hosted = host.ends_with(".supabase.co") && host != ".supabase.co";
    let scheme_allowed =
        (hosted && url.scheme() == "https" && url.port_or_known_default() == Some(443))
            || (loopback && matches!(url.scheme(), "http" | "https"));
    if !scheme_allowed
        || (!hosted && !loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.path(), "" | "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Supabase 项目配置无效".to_string());
    }
    url.set_path("/");
    let keyring_account = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    };
    Ok(ValidatedConfig {
        base_url: url,
        publishable_key: config.publishable_key,
        keyring_account,
    })
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "无法创建 Supabase 客户端".to_string())
}

fn endpoint(base_url: &Url, path: &str) -> Result<Url, String> {
    base_url
        .join(path)
        .map_err(|_| "Supabase 项目配置无效".to_string())
}

fn keyring_entry(config: &ValidatedConfig) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &config.keyring_account)
        .map_err(|_| "无法访问系统凭据存储".to_string())
}

fn read_session(config: &ValidatedConfig) -> Result<Option<StoredSession>, String> {
    match keyring_entry(config)?.get_password() {
        Ok(value) => serde_json::from_str(&value)
            .map(Some)
            .map_err(|_| "系统凭据中的 Supabase 会话无效".to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("无法读取系统凭据".to_string()),
    }
}

fn write_session(config: &ValidatedConfig, session: &StoredSession) -> Result<(), String> {
    let value = serde_json::to_string(session).map_err(|_| "无法编码 Supabase 会话".to_string())?;
    keyring_entry(config)?
        .set_password(&value)
        .map_err(|_| "无法写入系统凭据".to_string())
}

fn delete_session(config: &ValidatedConfig) -> Result<(), String> {
    match keyring_entry(config)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("无法删除系统凭据".to_string()),
    }
}

async fn authenticated_client(config: &ValidatedConfig) -> Result<(Client, StoredSession), String> {
    let client = build_client()?;
    let session = read_session(config)?.ok_or_else(|| "Supabase 会话未登录".to_string())?;
    if session.expires_at > unix_timestamp()?.saturating_add(60) {
        return Ok((client, session));
    }
    let refreshed = refresh_session(&client, config, session).await?;
    write_session(config, &refreshed)?;
    Ok((client, refreshed))
}

async fn refresh_session(
    client: &Client,
    config: &ValidatedConfig,
    previous: StoredSession,
) -> Result<StoredSession, String> {
    let response = client
        .post(endpoint(&config.base_url, "auth/v1/token")?)
        .query(&[("grant_type", "refresh_token")])
        .header("apikey", &config.publishable_key)
        .json(&json!({ "refresh_token": previous.refresh_token }))
        .send()
        .await
        .map_err(|_| "Supabase 会话刷新失败".to_string())?;
    let auth: AuthResponse = read_success_json(response, "Supabase 会话刷新失败").await?;
    let (user_id, email) = match auth.user {
        Some(user) => (
            validate_identity(user.id, 256)?,
            user.email
                .map(|value| validate_identity(value, 320))
                .transpose()?,
        ),
        None => (previous.user_id, previous.email),
    };
    Ok(StoredSession {
        access_token: validate_token(auth.access_token)?,
        refresh_token: validate_token(auth.refresh_token)?,
        expires_at: unix_timestamp()?.saturating_add(auth.expires_in.max(0)),
        user_id,
        email,
    })
}

async fn read_success_json<T: DeserializeOwned>(
    response: Response,
    error_message: &str,
) -> Result<T, String> {
    if !response.status().is_success() {
        return Err(format!(
            "{error_message}（HTTP {}）",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(format!("{error_message}（响应过大）"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| error_message.to_string())?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!("{error_message}（响应过大）"));
    }
    serde_json::from_slice(&bytes).map_err(|_| format!("{error_message}（响应无效）"))
}

fn validate_snapshot(snapshot: &Value) -> Result<(), String> {
    let encoded = serde_json::to_vec(snapshot).map_err(|_| "Supabase 快照无效".to_string())?;
    let object = snapshot
        .as_object()
        .ok_or_else(|| "Supabase 快照无效".to_string())?;
    let valid = encoded.len() <= MAX_SNAPSHOT_BYTES
        && object.get("collection").and_then(Value::as_str) == Some("study_state")
        && object.get("recordId").and_then(Value::as_str) == Some("current")
        && object.get("kind").and_then(Value::as_str) == Some("upsert")
        && object.get("payload").is_some_and(Value::is_object)
        && bounded_field(object.get("operationId"), 1024)
        && bounded_field(object.get("revision"), 512)
        && bounded_field(object.get("deviceId"), 512)
        && bounded_field(object.get("occurredAt"), 64);
    if !valid {
        return Err("Supabase 快照无效".to_string());
    }
    Ok(())
}

fn bounded_field(value: Option<&Value>, max: usize) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty() && value.len() <= max)
}

fn validate_token(value: String) -> Result<String, String> {
    if value.is_empty() || value.len() > MAX_CONFIG_BYTES {
        return Err("Supabase 会话响应无效".to_string());
    }
    Ok(value)
}

fn validate_identity(value: String, max: usize) -> Result<String, String> {
    if value.is_empty() || value.len() > max {
        return Err("Supabase 身份响应无效".to_string());
    }
    Ok(value)
}

fn status_from_session(session: &StoredSession) -> SessionStatus {
    SessionStatus::SignedIn {
        user_id: session.user_id.clone(),
        email: session.email.clone(),
    }
}

fn unix_timestamp() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|_| "系统时间无效".to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        status_from_session, validate_config, validate_snapshot, SessionStatus, StoredSession,
        StudyCloudConfig,
    };
    use serde_json::json;

    fn config(project_url: &str) -> StudyCloudConfig {
        StudyCloudConfig {
            provider: "supabase".to_string(),
            project_url: project_url.to_string(),
            publishable_key: "sb_publishable_test".to_string(),
        }
    }

    #[test]
    fn accepts_only_hosted_https_or_explicit_loopback_origins() {
        assert!(validate_config(config("https://project.supabase.co")).is_ok());
        assert!(validate_config(config("http://127.0.0.1:54321")).is_ok());
        assert!(validate_config(config("http://localhost:54321")).is_ok());
        for url in [
            "http://project.supabase.co",
            "https://supabase.co",
            "https://project.supabase.co.evil.test",
            "https://project.supabase.co:444",
            "https://user:pass@project.supabase.co",
            "https://project.supabase.co/rest/v1",
        ] {
            assert!(validate_config(config(url)).is_err(), "{url}");
        }
    }

    #[test]
    fn session_status_serializes_identity_without_tokens() {
        let status = status_from_session(&StoredSession {
            access_token: "access-secret".to_string(),
            refresh_token: "refresh-secret".to_string(),
            expires_at: 1,
            user_id: "user-1".to_string(),
            email: Some("learner@example.com".to_string()),
        });
        assert_eq!(
            status,
            SessionStatus::SignedIn {
                user_id: "user-1".to_string(),
                email: Some("learner@example.com".to_string()),
            }
        );
        let encoded = serde_json::to_string(&status).unwrap();
        assert!(!encoded.contains("access-secret"));
        assert!(!encoded.contains("refresh-secret"));
    }

    #[test]
    fn snapshot_validation_is_closed_to_the_study_state_record() {
        let valid = json!({
            "operationId": "study_state:r1",
            "collection": "study_state",
            "recordId": "current",
            "kind": "upsert",
            "payload": {},
            "revision": "r1",
            "deviceId": "device-a",
            "occurredAt": "2026-09-04T10:00:00.000Z"
        });
        assert!(validate_snapshot(&valid).is_ok());
        assert!(validate_snapshot(&json!({ "collection": "private_notes" })).is_err());
    }
}
