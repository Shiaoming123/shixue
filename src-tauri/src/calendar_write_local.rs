//! Post-write reads use a separate keyring-anchored batch; ordinary sync cursors are untouched.
use super::*;
#[path = "calendar_write_projection.rs"]
mod projection;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct LocalBinding {
    pub(super) base: Value,
    pub(super) batch: Value,
    pub(super) receipt_id: Option<String>,
}
async fn workspace(pool: &SqlitePool) -> Result<Value, String> {
    let value = sync_store::workspace_payload(pool).await?;
    if value["version"] != 4 {
        return Err("WORKSPACE_INVALID".into());
    }
    Ok(value)
}
fn unexpired(receipt: &Value) -> bool {
    receipt["expiresAt"]
        .as_str()
        .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
        .is_some_and(|expiry| expiry.timestamp_millis() > chrono::Utc::now().timestamp_millis())
}
fn receipt_id(current: &Value, local: &LocalBinding) -> Option<String> {
    let batch = &local.batch;
    current["commandReceipts"].as_array()?.iter().find_map(|r| {
        let data = &r["result"]["data"];
        (plan_matches(&local.batch, &local.base)
            && unexpired(r)
            && r["commandType"] == "calendar_external.apply"
            && r["idempotencyKey"] == batch["batchId"]
            && r["id"] == r["result"]["receiptId"]
            && data["applied"] == true
            && [
                "operationId",
                "batchId",
                "provider",
                "connectionId",
                "calendarId",
                "sourceId",
                "mode",
            ]
            .iter()
            .all(|k| data[*k] == batch[*k])
            && projection::verify(&local.base, current, batch))
        .then(|| r["id"].as_str().map(str::to_owned))
        .flatten()
    })
}
// The ledger is keyring-anchored; bind a recurrence projection to its immutable preview before ack.
fn plan_matches(batch: &Value, _base: &Value) -> bool {
    match batch["plan"]["kind"].as_str() {
        Some("recurring.single") => {
            batch["plan"]["hash"]
                .as_str()
                .is_some_and(|v| v.starts_with("sha256:"))
                && batch["plan"]["parentEventId"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty())
                && batch["plan"]["instanceEventId"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty())
                && batch["plan"]["originalStart"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty())
        }
        Some("recurring.series") => {
            batch["plan"]["hash"]
                .as_str()
                .is_some_and(|v| v.starts_with("sha256:"))
                && batch["plan"]["parentEventId"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty())
        }
        None => batch["plan"].is_null(),
        _ => false,
    }
}
fn plan_matches_preview(batch: &Value, preview: &Value) -> bool {
    let expected = match preview["intent"]["kind"].as_str() {
        Some("recurring.single") => json!({
            "hash": preview["hash"],
            "kind": "recurring.single",
            "parentEventId": preview["intent"]["parent"]["eventId"],
            "instanceEventId": preview["intent"]["instance"]["eventId"],
            "originalStart": preview["intent"]["originalStart"],
        }),
        Some("recurring.series") => json!({
            "hash": preview["hash"],
            "kind": "recurring.series",
            "parentEventId": preview["intent"]["parent"]["eventId"],
        }),
        _ => Value::Null,
    };
    batch["operationId"] == preview["operationId"] && batch["plan"] == expected
}
fn reusable(current: &Value, local: &LocalBinding) -> Result<bool, String> {
    if let Some(id) = receipt_id(current, local) {
        return Ok(local
            .receipt_id
            .as_ref()
            .is_none_or(|expected| *expected == id));
    }
    // A previously acknowledged batch cannot be replayed after an import/restore, even to the exact old baseline.
    Ok(local.receipt_id.is_none()
        && workspace_hash::fingerprint(current)? == local.batch["expectedWorkspaceHash"])
}
pub(super) async fn stage<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    scopes: &[String],
) -> Result<Value, String> {
    let mut record = ledger(pool, vault, owner, id, epoch).await?;
    if record.future.is_some() {
        return Err("WRITE_UNSUPPORTED".into());
    }
    if record.state != "applied" || record.outcome_unknown {
        return Err("WRITE_LOCAL_NOT_APPLIED".into());
    }
    let base = workspace(pool).await?;
    let calendar = field(&record.preview, "calendarId")?;
    let directory = http
        .call(
            "GET",
            &format!("users/me/calendarList/{}", segment(calendar)),
            None,
            None,
            None,
        )
        .await?;
    if directory.status != 200 || directory.body["id"] != calendar {
        return Err("WRITE_LOCAL_PERMISSION_UNVERIFIED".into());
    }
    let role = effective_role(
        directory.body["accessRole"].as_str().unwrap_or("none"),
        scopes,
    );
    let access = match role {
        "owner" | "writer" | "reader" => "details",
        "freeBusyReader" => "freebusy",
        _ => "none",
    };
    if let Some(local) = &record.local {
        if local.batch["access"] == access
            && plan_matches_preview(&local.batch, &record.preview)
            && reusable(&base, local)?
        {
            return Ok(local.batch.clone());
        }
    }
    let intent = &record.preview["intent"];
    let plan = match intent["kind"].as_str() {
        Some("recurring.single") => {
            json!({"hash":record.preview["hash"],"kind":"recurring.single","parentEventId":intent["parent"]["eventId"],"instanceEventId":intent["instance"]["eventId"],"originalStart":intent["originalStart"]})
        }
        Some("recurring.series") => {
            json!({"hash":record.preview["hash"],"kind":"recurring.series","parentEventId":intent["parent"]["eventId"]})
        }
        _ => Value::Null,
    };
    let mut items = vec![];
    if access == "details" {
        let reply = http
            .call("GET", &event_path(&record.preview)?, None, None, None)
            .await?;
        if reply.status == 404
            && record.preview["intent"]["kind"] == "delete"
            && record.result.as_ref().is_some_and(|r| r["etag"].is_null())
        {
            // Only a durably anchored successful DELETE 204 permits this tombstone. Unknown deletes never enter stage.
            items.push(json!({"id":record.preview["eventId"],"status":"cancelled"}));
        } else if reply.status == 200 && reply.body["id"] == record.preview["eventId"] {
            if intent["kind"] == "recurring.single" {
                let parent = http
                    .call(
                        "GET",
                        &format!(
                            "calendars/{}/events/{}",
                            segment(calendar),
                            segment(field(&intent["parent"], "eventId")?)
                        ),
                        None,
                        None,
                        None,
                    )
                    .await?;
                if parent.status != 200 || parent.body["id"] != intent["parent"]["eventId"] {
                    return Err("WRITE_LOCAL_REMOTE_UNVERIFIED".into());
                }
                items.push(sync_store::safe_event(&parent.body)?);
            }
            items.push(sync_store::safe_event(&reply.body)?);
        } else {
            return Err("WRITE_LOCAL_REMOTE_UNVERIFIED".into());
        }
    }
    let base_hash = workspace_hash::fingerprint(&base)?;
    if workspace_hash::fingerprint(&workspace(pool).await?)? != base_hash {
        return Err("WRITE_LOCAL_BASELINE_STALE".into());
    }
    let connection = field(&record.preview, "connectionId")?;
    let batch = json!({"batchId":random()?,"provider":"google","connectionId":connection,"calendarId":calendar,
        "sourceId":sync_store::source_id(connection,calendar),"mode":"incremental","access":access,
        "title":directory.body["summary"].as_str().unwrap_or("Google Calendar"),"timezone":directory.body["timeZone"].as_str().unwrap_or("UTC"),
        "items":items,"operationId":id,"expectedWorkspaceHash":base_hash,"observedAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"plan":plan});
    record.local = Some(LocalBinding {
        base,
        batch: batch.clone(),
        receipt_id: None,
    });
    record.version += 1;
    persist(
        pool,
        vault,
        owner,
        id,
        &record,
        anchor(vault, owner, id)?.previous,
    )
    .await?;
    Ok(batch)
}
#[tauri::command]
pub async fn write_stage_local<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, generation) = grant(&config)?;
    let session = authorized(&owner, &config, None).await?;
    let pool = sync_store::database(&app).await?;
    schema(&pool).await?;
    let http = GoogleHttp {
        config: &config,
        owner: &owner,
        epoch: generation,
    };
    let batch = stage(
        &pool,
        &Keyring,
        &http,
        &owner,
        &operation_id,
        &epoch,
        &session.scopes,
    )
    .await?;
    if super::generation(&owner, false)? != generation {
        return Err("DISCONNECTED".into());
    }
    Ok(batch)
}
#[tauri::command]
pub async fn write_read_local<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
    batch_id: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, generation) = grant(&config)?;
    let session = authorized(&owner, &config, None).await?;
    let pool = sync_store::database(&app).await?;
    schema(&pool).await?;
    let http = GoogleHttp {
        config: &config,
        owner: &owner,
        epoch: generation,
    };
    // Revalidate permissions and the baseline before exposing an existing batch.
    let batch = stage(
        &pool,
        &Keyring,
        &http,
        &owner,
        &operation_id,
        &epoch,
        &session.scopes,
    )
    .await?;
    if batch["batchId"] != batch_id {
        return Err("WRITE_LOCAL_BASELINE_STALE".into());
    }
    Ok(batch)
}
pub(super) async fn ack<V: Vault>(
    pool: &SqlitePool,
    vault: &V,
    owner: &str,
    id: &str,
    epoch: &str,
    batch_id: &str,
    receipt: &str,
) -> Result<Value, String> {
    let mut record = ledger(pool, vault, owner, id, epoch).await?;
    if record.future.is_some() {
        return Err("WRITE_UNSUPPORTED".into());
    }
    if record.state != "applied" || record.outcome_unknown {
        return Err("WRITE_LOCAL_NOT_APPLIED".into());
    }
    let local = record.local.as_mut().ok_or("WRITE_LOCAL_BASELINE_STALE")?;
    if local.batch["batchId"] != batch_id
        || !plan_matches_preview(&local.batch, &record.preview)
        || receipt_id(&workspace(pool).await?, local).as_deref() != Some(receipt)
    {
        return Err("WRITE_LOCAL_BASELINE_STALE".into());
    }
    local.receipt_id = Some(receipt.into());
    record.version += 1;
    persist(
        pool,
        vault,
        owner,
        id,
        &record,
        anchor(vault, owner, id)?.previous,
    )
    .await?;
    Ok(json!({"applied":true,"operationId":id,"batchId":batch_id}))
}
#[tauri::command]
pub async fn write_ack_local<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    config: Config,
    operation_id: String,
    batch_id: String,
    workspace_receipt_id: String,
) -> Result<Value, String> {
    let _guard = WRITE_GATE.lock().await;
    let (owner, epoch, _) = grant(&config)?;
    let pool = sync_store::database(&app).await?;
    schema(&pool).await?;
    ack(
        &pool,
        &Keyring,
        &owner,
        &operation_id,
        &epoch,
        &batch_id,
        &workspace_receipt_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expired_receipt_still_present_is_not_reusable_proof() {
        assert!(!unexpired(&json!({"expiresAt":"2000-01-01T00:00:00.000Z"})));
        assert!(unexpired(&json!({"expiresAt":"2999-01-01T00:00:00.000Z"})));
        let base = json!({"version":4,"commandReceipts":[]});
        let restored =
            json!({"version":4,"commandReceipts":[{"expiresAt":"2000-01-01T00:00:00.000Z"}]});
        let local = LocalBinding {
            base: base.clone(),
            batch: json!({"expectedWorkspaceHash":workspace_hash::fingerprint(&base).unwrap()}),
            receipt_id: Some("expired".into()),
        };
        assert!(!reusable(&restored, &local).unwrap());
    }
    #[test]
    fn previously_acknowledged_binding_cannot_replay_after_exact_baseline_restore() {
        let base = json!({"version":4,"commandReceipts":[]});
        let mut local = LocalBinding {
            base: base.clone(),
            batch: json!({"expectedWorkspaceHash":workspace_hash::fingerprint(&base).unwrap()}),
            receipt_id: None,
        };
        assert!(reusable(&base, &local).unwrap());
        local.receipt_id = Some("old-receipt".into());
        assert!(!reusable(&base, &local).unwrap());
    }
    #[test]
    fn recurrence_plan_must_match_the_keyring_anchored_preview() {
        let batch = json!({"operationId":"op","plan":{"hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","kind":"recurring.single","parentEventId":"parent","instanceEventId":"instance","originalStart":"2026-09-10"}});
        let preview = json!({"operationId":"op","hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","intent":{"kind":"recurring.single","parent":{"eventId":"parent"},"instance":{"eventId":"instance"},"originalStart":"2026-09-10"}});
        assert!(plan_matches_preview(&batch, &preview));
        let mut tampered = batch.clone();
        tampered["plan"]["originalStart"] = json!("2026-09-11");
        assert!(!plan_matches_preview(&tampered, &preview));
    }
    #[test]
    fn recurrence_receipts_expire_and_cannot_replay_a_restored_workspace() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-recurrence-projection.json"
        ))
        .unwrap();
        let case = &fixture["cases"].as_array().unwrap()[1];
        let local = LocalBinding {
            base: case["base"].clone(),
            batch: case["batch"].clone(),
            receipt_id: None,
        };
        let mut expired = case["current"].clone();
        let receipt = expired["commandReceipts"]
            .as_array()
            .unwrap()
            .iter()
            .position(|r| r["idempotencyKey"] == local.batch["batchId"])
            .unwrap();
        expired["commandReceipts"][receipt]["expiresAt"] = json!("2000-01-01T00:00:00.000Z");
        assert!(receipt_id(&expired, &local).is_none());
        let restored = LocalBinding {
            receipt_id: Some("old-receipt".into()),
            ..local
        };
        assert!(!reusable(&case["base"], &restored).unwrap());
    }
}
