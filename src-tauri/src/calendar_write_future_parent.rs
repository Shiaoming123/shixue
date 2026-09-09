//! Future saga. The command caller owns WRITE_GATE.
use super::*;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum Mode {
    Run,
    Reconcile,
}

// Invocation-local monotonic deadline only; this is not a cross-process lease.
#[allow(clippy::too_many_arguments)] // Keep the phase context and injectable deadline explicit.
pub(super) async fn saga<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    mode: Mode,
    authorization: impl Fn() -> Result<(), String>,
    deadline: std::time::Duration,
    now: impl Fn() -> std::time::Duration,
) -> Result<Ledger, String> {
    let check = || {
        authorization()?;
        if now() >= deadline {
            return Err("WRITE_LEASE_LOST".into());
        }
        Ok(())
    };
    loop {
        check()?;
        http.check_future_session()?;
        let mut record = ledger(pool, vault, owner, id, epoch).await?;
        let future = record.future.as_ref().ok_or("WRITE_UNSUPPORTED")?;
        if record.state == "applied"
            || record.state == "conflict"
            || record.error.as_deref() == Some("COMPENSATED")
            || (record.state == "failed" && !record.outcome_unknown)
        {
            return Ok(record);
        }
        let parent_state = field(&future["parent"], "state")?;
        if matches!(parent_state, "rejected" | "conflict") {
            if mode == Mode::Reconcile {
                return Err("WRITE_RECONCILE_REQUIRED".into());
            }
            record.state = if parent_state == "conflict" {
                "conflict"
            } else {
                "failed"
            }
            .into();
            record.error = Some("PARENT_REJECTED".into());
            record.outcome_unknown = false;
            record.version += 1;
            let previous = anchor(vault, owner, id)?.previous;
            persist(pool, vault, owner, id, &record, previous).await?;
            return Ok(record);
        }
        let name = if parent_state != "proved" {
            "parent"
        } else if matches!(
            future["successor"]["state"].as_str(),
            Some("rejected" | "conflict")
        ) {
            "compensation"
        } else {
            "successor"
        };
        let phase = field(&future[name], "state")?;
        match (mode, phase) {
            (Mode::Run, "pending") | (Mode::Reconcile, "applying" | "unknown") => (),
            (_, "pending" | "applying" | "unknown") => {
                return Err("WRITE_RECONCILE_REQUIRED".into())
            }
            _ => return Err("WRITE_INVALID".into()),
        }
        let next = match name {
            "parent" => parent(pool, vault, http, owner, id, epoch, &check).await?,
            "successor" => successor(pool, vault, http, owner, id, epoch, &check).await?,
            _ => compensate(pool, vault, http, owner, id, epoch, &check).await?,
        };
        if mode == Mode::Reconcile
            || next.outcome_unknown
            || next.state == "applied"
            || next.error.as_deref() == Some("COMPENSATED")
        {
            return Ok(next);
        }
    }
}

async fn parent<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    authorization: impl Fn() -> Result<(), String>,
) -> Result<Ledger, String> {
    let check = || -> Result<(), String> {
        authorization()?;
        http.check_future_session()?;
        Ok(())
    };
    check()?;
    let mut record = ledger(pool, vault, owner, id, epoch).await?;
    let phase = field(
        record
            .future
            .as_ref()
            .ok_or("WRITE_UNSUPPORTED")?
            .get("parent")
            .ok_or("WRITE_INVALID")?,
        "state",
    )?
    .to_string();
    if matches!(phase.as_str(), "proved" | "rejected" | "conflict") {
        return Ok(record);
    }
    if !matches!(phase.as_str(), "pending" | "applying" | "unknown") {
        return Err("WRITE_INVALID".into());
    }
    let previous = anchor(vault, owner, id)?.previous;
    if phase == "pending" {
        if record.state != "confirmed" || record.outcome_unknown {
            return Err("WRITE_RECONCILE_REQUIRED".into());
        }
        let preview = &record.preview;
        let intent = &preview["intent"];
        let local = future_local::read(
            pool,
            field(preview, "connectionId")?,
            field(preview, "calendarId")?,
            field(&intent["parent"], "eventId")?,
        )
        .await?;
        let remote = future_read::read(
            http,
            field(preview, "calendarId")?,
            &intent["parent"],
            field(intent, "originalStart")?,
        )
        .await?;
        let mut base = preview.clone();
        base.as_object_mut().unwrap().remove("hash");
        base["intent"].as_object_mut().unwrap().remove("plan");
        base["lockKeys"] = json!([]);
        if future_plan::prepare(&base, &remote, &local)?["preview"] != record.preview {
            return Err("WRITE_PREVIEW_CHANGED".into());
        }
        local.revalidate(pool).await?;
        check()?;
        locks(vault, owner, id, &record)?;
        record.state = "applying".into();
        record.outcome_unknown = true;
        record.future.as_mut().unwrap()["parent"] =
            json!({"state":"applying","outcomeUnknown":true});
        record.version += 1;
        persist(pool, vault, owner, id, &record, previous.clone()).await?;
        // Re-read the anchored record after persistence and just before mutation.
        let trusted = ledger(pool, vault, owner, id, epoch).await?;
        if serde_json::to_value(&trusted).unwrap() != serde_json::to_value(&record).unwrap() {
            return Err("WRITE_AUTHORITY_MISMATCH".into());
        }
        locks(vault, owner, id, &record)?;
        local.revalidate(pool).await?;
        check()?;
        let reply = call(http, &record.preview, "parent", true).await;
        check()?;
        if let Ok(reply) = reply {
            if matches!(reply["kind"].as_str(), Some("rejected" | "conflict")) {
                record.future.as_mut().unwrap()["parent"] =
                    json!({"state":reply["kind"],"outcomeUnknown":false});
                record.outcome_unknown = false;
                record.version += 1;
                persist(pool, vault, owner, id, &record, previous).await?;
                return Ok(record);
            }
        }
    } else if record.state != "applying" || !record.outcome_unknown {
        return Err("WRITE_INVALID".into());
    }
    check()?;
    let reply = call(http, &record.preview, "parent", false).await;
    check()?;
    record.future.as_mut().unwrap()["parent"] = match reply {
        Ok(value) if value["kind"] == "proved" => {
            json!({"state":"proved","outcomeUnknown":false,"etag":value["proof"]["etag"],"proof":value["proof"]})
        }
        _ => json!({"state":"unknown","outcomeUnknown":true}),
    };
    record.outcome_unknown = record.future.as_ref().unwrap()["parent"]["state"] != "proved";
    record.version += 1;
    persist(pool, vault, owner, id, &record, previous).await?;
    Ok(record)
}
fn locks<V: Vault>(vault: &V, owner: &str, id: &str, record: &Ledger) -> Result<(), String> {
    let locks = lock_keys(&record.preview["intent"])?;
    for (other_id, other) in indexed(vault, owner)? {
        if other_id != id
            && other.calendar_id == field(&record.preview, "calendarId")?
            && holds_lock(&other)
            && other.lock_keys.iter().any(|key| locks.contains(key))
        {
            return Err("WRITE_BUSY".into());
        }
    }
    Ok(())
}
async fn successor<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    authorization: impl Fn() -> Result<(), String>,
) -> Result<Ledger, String> {
    let check = || -> Result<(), String> {
        authorization()?;
        http.check_future_session()
    };
    check()?;
    let mut record = ledger(pool, vault, owner, id, epoch).await?;
    let future = record.future.as_ref().ok_or("WRITE_UNSUPPORTED")?;
    if record.state == "applied" {
        return Ok(record);
    }
    if record.state != "applying"
        || future["parent"]["state"] != "proved"
        || future["compensation"]["state"] != "pending"
        || future_step::response(
            &record.preview,
            "parent",
            false,
            200,
            &future["parent"]["proof"],
        )["kind"]
            != "proved"
        || future["parent"]["etag"] != future["parent"]["proof"]["etag"]
    {
        return Err("WRITE_INVALID".into());
    }
    let phase = field(&future["successor"], "state")?.to_string();
    if matches!(phase.as_str(), "rejected" | "conflict") {
        return Ok(record);
    }
    let previous = anchor(vault, owner, id)?.previous;
    if phase == "pending" {
        if record.outcome_unknown {
            return Err("WRITE_RECONCILE_REQUIRED".into());
        }
        let preview = &record.preview;
        let local = future_local::read(
            pool,
            field(preview, "connectionId")?,
            field(preview, "calendarId")?,
            field(preview, "eventId")?,
        )
        .await?;
        if local.workspace_hash != field(&preview["intent"]["plan"], "workspaceHash")?
            || !local.attached_facts.is_empty()
        {
            return Err("WRITE_PREVIEW_CHANGED".into());
        }
        check()?;
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
        check()?;
        if directory.status != 200
            || directory.body["id"] != preview["calendarId"]
            || !matches!(
                directory.body["accessRole"].as_str(),
                Some("owner" | "writer")
            )
        {
            return Err("WRITE_PERMISSION".into());
        }
        let current = call(http, preview, "parent", false).await?;
        check()?;
        if current["kind"] != "proved" || current["proof"] != future["parent"]["proof"] {
            return Err("WRITE_PREVIEW_CHANGED".into());
        }
        locks(vault, owner, id, &record)?;
        local.revalidate(pool).await?;
        check()?;
        record.future.as_mut().unwrap()["successor"] =
            json!({"state":"applying","outcomeUnknown":true});
        record.outcome_unknown = true;
        record.version += 1;
        persist(pool, vault, owner, id, &record, previous.clone()).await?;
        let trusted = ledger(pool, vault, owner, id, epoch).await?;
        if serde_json::to_value(&trusted).unwrap() != serde_json::to_value(&record).unwrap() {
            return Err("WRITE_AUTHORITY_MISMATCH".into());
        }
        locks(vault, owner, id, &record)?;
        local.revalidate(pool).await?;
        check()?;
        let reply = call(http, &record.preview, "successor", true).await;
        check()?;
        if let Ok(reply) = reply {
            if matches!(reply["kind"].as_str(), Some("rejected" | "conflict")) {
                record.future.as_mut().unwrap()["successor"] =
                    json!({"state":reply["kind"],"outcomeUnknown":false});
                record.outcome_unknown = false;
                record.version += 1;
                persist(pool, vault, owner, id, &record, previous).await?;
                return Ok(record);
            }
        }
    } else if !matches!(phase.as_str(), "applying" | "unknown") || !record.outcome_unknown {
        return Err("WRITE_INVALID".into());
    }
    check()?;
    let reply = call(http, &record.preview, "successor", false).await;
    check()?;
    match reply {
        Ok(reply) if reply["kind"] == "proved" => {
            let future = record.future.as_mut().unwrap();
            future["successor"] = json!({"state":"proved","outcomeUnknown":false,"etag":reply["proof"]["etag"],"proof":reply["proof"]});
            record.result = Some(
                json!({"operationId":record.preview["operationId"],"connectionId":record.preview["connectionId"],"calendarId":record.preview["calendarId"],"eventId":record.preview["eventId"],"etag":future["parent"]["etag"],"future":{"markerHash":record.preview["intent"]["plan"]["markerHash"],"parent":future["parent"]["proof"],"successor":future["successor"]["proof"]}}),
            );
            record.state = "applied".into();
            record.outcome_unknown = false;
        }
        _ => {
            record.future.as_mut().unwrap()["successor"] =
                json!({"state":"unknown","outcomeUnknown":true});
            record.outcome_unknown = true;
        }
    }
    record.version += 1;
    persist(pool, vault, owner, id, &record, previous).await?;
    Ok(record)
}
async fn compensate<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    authorization: impl Fn() -> Result<(), String>,
) -> Result<Ledger, String> {
    let check = || -> Result<(), String> {
        authorization()?;
        http.check_future_session()
    };
    check()?;
    let mut record = ledger(pool, vault, owner, id, epoch).await?;
    let future = record.future.as_ref().ok_or("WRITE_UNSUPPORTED")?;
    if record.error.as_deref() == Some("COMPENSATED") {
        return Ok(record);
    }
    if future["parent"]["state"] != "proved"
        || !matches!(
            future["successor"]["state"].as_str(),
            Some("rejected" | "conflict")
        )
    {
        return Err("WRITE_INVALID".into());
    }
    let phase = field(&future["compensation"], "state")?.to_string();
    let previous = anchor(vault, owner, id)?.previous;
    let mut conflict = matches!(phase.as_str(), "conflict" | "rejected")
        || future["successor"]["state"] == "conflict";
    if phase == "pending" && !conflict {
        let current = call(http, &record.preview, "parent", false).await;
        check()?;
        match current {
            Ok(reply) if reply["kind"] == "proved" => {
                let etag = field(&reply["proof"], "etag")?.to_string();
                let directory = http
                    .call(
                        "GET",
                        &format!(
                            "users/me/calendarList/{}",
                            segment(field(&record.preview, "calendarId")?)
                        ),
                        None,
                        None,
                        None,
                    )
                    .await?;
                check()?;
                if directory.status != 200
                    || directory.body["id"] != record.preview["calendarId"]
                    || !matches!(
                        directory.body["accessRole"].as_str(),
                        Some("owner" | "writer")
                    )
                {
                    return Err("WRITE_PERMISSION".into());
                }
                locks(vault, owner, id, &record)?;
                record.future.as_mut().unwrap()["compensation"] =
                    json!({"state":"applying","outcomeUnknown":true,"etag":etag});
                record.state = "applying".into();
                record.outcome_unknown = true;
                record.error = None;
                record.version += 1;
                persist(pool, vault, owner, id, &record, previous.clone()).await?;
                let trusted = ledger(pool, vault, owner, id, epoch).await?;
                if serde_json::to_value(&trusted).unwrap() != serde_json::to_value(&record).unwrap()
                {
                    return Err("WRITE_AUTHORITY_MISMATCH".into());
                }
                locks(vault, owner, id, &record)?;
                check()?;
                let req = future_step::restore_request(&record.preview, &etag)?;
                let response = http
                    .call(
                        "PATCH",
                        field(&req, "path")?
                            .strip_prefix("/calendar/v3/")
                            .ok_or("WRITE_INVALID")?,
                        Some(&etag),
                        Some(field(&record.preview, "sendUpdates")?),
                        req.get("body").cloned(),
                    )
                    .await;
                check()?;
                if let Ok(reply) = response {
                    conflict = matches!(
                        future_step::response(
                            &record.preview,
                            "compensation",
                            true,
                            reply.status,
                            &reply.body
                        )["kind"]
                            .as_str(),
                        Some("conflict" | "rejected")
                    );
                }
            }
            Ok(reply) if reply["kind"] == "conflict" || reply["kind"] == "rejected" => {
                conflict = true
            }
            _ => {
                record.state = "failed".into();
                record.outcome_unknown = true;
                record.error = Some("COMPENSATION_REQUIRED".into());
                record.version += 1;
                persist(pool, vault, owner, id, &record, previous).await?;
                return Ok(record);
            }
        }
    } else if !conflict && !matches!(phase.as_str(), "applying" | "unknown" | "proved") {
        return Err("WRITE_INVALID".into());
    }
    if !conflict {
        check()?;
        let reply = call(http, &record.preview, "compensation", false).await;
        check()?;
        match reply {
            Ok(reply) if reply["kind"] == "proved" => {
                let state = &mut record.future.as_mut().unwrap()["compensation"];
                state["state"] = json!("proved");
                state["outcomeUnknown"] = json!(false);
                state["proof"] = reply["proof"].clone();
                record.state = "failed".into();
                record.outcome_unknown = false;
                record.error = Some("COMPENSATED".into());
            }
            Ok(reply) if reply["kind"] == "conflict" || reply["kind"] == "rejected" => {
                conflict = true
            }
            _ => {
                let state = &mut record.future.as_mut().unwrap()["compensation"];
                state["state"] = json!("unknown");
                state["outcomeUnknown"] = json!(true);
                record.state = "failed".into();
                record.outcome_unknown = true;
                record.error = Some("OUTCOME_UNKNOWN".into());
            }
        }
    }
    if conflict {
        record.future.as_mut().unwrap()["compensation"]["state"] = json!("conflict");
        record.state = "conflict".into();
        record.outcome_unknown = true;
        record.error = Some("COMPENSATION_CONFLICT".into());
    }
    record.result = None;
    record.version += 1;
    persist(pool, vault, owner, id, &record, previous).await?;
    Ok(record)
}
pub(super) async fn call<H: Http>(
    http: &H,
    preview: &Value,
    name: &str,
    mutate: bool,
) -> Result<Value, String> {
    let request = future_step::request(
        preview,
        if name == "compensation" {
            "parent"
        } else {
            name
        },
        mutate,
    )?;
    let reply = http
        .call(
            field(&request, "method")?,
            field(&request, "path")?
                .strip_prefix("/calendar/v3/")
                .ok_or("WRITE_INVALID")?,
            request["headers"]["If-Match"].as_str(),
            request["query"]["sendUpdates"].as_str(),
            request.get("body").cloned(),
        )
        .await?;
    Ok(future_step::response(
        preview,
        name,
        mutate,
        reply.status,
        &reply.body,
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    // Exercise orchestration through the production execute entry used by commands.
    #[allow(clippy::too_many_arguments)]
    async fn saga<V: Vault, H: Http>(
        pool: &SqlitePool,
        vault: &V,
        http: &H,
        owner: &str,
        id: &str,
        epoch: &str,
        mode: Mode,
        authorization: impl Fn() -> Result<(), String>,
        deadline: std::time::Duration,
        now: impl Fn() -> std::time::Duration,
    ) -> Result<Ledger, String> {
        execute(
            pool,
            vault,
            http,
            owner,
            id,
            epoch,
            mode == Mode::Reconcile,
            authorization,
            deadline,
            now,
        )
        .await?;
        ledger(pool, vault, owner, id, epoch).await
    }

    #[test]
    fn native_future_execute_refuses_authority_state_anchor_and_lock() {
        tauri::async_runtime::block_on(async {
            let _gate = WRITE_GATE.lock().await;
            for fault in [
                "session",
                "grant",
                "generation",
                "access",
                "deadline",
                "state",
                "digest",
                "lock",
            ] {
                let (pool, vault, preview, snapshot) = setup().await;
                let id = field(&preview, "operationId").unwrap();
                let http = Fake {
                    pool: &pool,
                    vault: &vault,
                    id: id.into(),
                    original: snapshot["parent"].clone(),
                    pivot: snapshot["pivot"].clone(),
                    event: RefCell::new(Value::Null),
                    child: RefCell::new(Value::Null),
                    requests: RefCell::new(vec![]),
                    fault,
                };
                if fault == "state" {
                    let mut record = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
                    record.state = "prepared".into();
                    record.version += 1;
                    persist(&pool, &vault, "owner", id, &record, None)
                        .await
                        .unwrap();
                }
                if fault == "digest" {
                    sqlx::query("UPDATE calendar_write_outbox SET native_payload='{}'")
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                if fault == "lock" {
                    let mut other = anchor(&vault, "owner", id).unwrap();
                    other.state = "applying".into();
                    other.previous = Some(id.into());
                    vault
                        .set(
                            &anchor_key("owner", "other"),
                            &serde_json::to_string(&other).unwrap(),
                        )
                        .unwrap();
                    vault.set(&head_key("owner"), "other").unwrap();
                }
                let deadline = std::time::Duration::from_secs(30);
                let reply = execute(
                    &pool,
                    &vault,
                    &http,
                    "owner",
                    id,
                    "grant",
                    false,
                    || {
                        if ["grant", "generation", "access"].contains(&fault) {
                            Err("WRITE_GRANT_CHANGED".into())
                        } else {
                            Ok(())
                        }
                    },
                    deadline,
                    || {
                        if fault == "deadline" {
                            deadline
                        } else {
                            std::time::Duration::ZERO
                        }
                    },
                )
                .await;
                assert!(reply.is_err(), "{fault}");
                assert!(http.requests.borrow().iter().all(|m| m == "GET"), "{fault}");
            }
        });
    }
    #[test]
    fn native_future_restart_uses_anchored_progress_without_new_ticket() {
        tauri::async_runtime::block_on(async {
            let _gate = WRITE_GATE.lock().await;
            let (pool, vault, preview, snapshot) = setup().await;
            let id = field(&preview, "operationId").unwrap();
            TICKETS
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .remove(id);
            let record = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
            assert_eq!(
                consume_run_ticket(id, &record, 7).unwrap_err(),
                "WRITE_CONFIRM_REQUIRED"
            );
            prepared_ticket(&preview, 7).unwrap();
            assert!(consume_run_ticket(id, &record, 8).is_err());
            consume_run_ticket(id, &record, 7).unwrap();
            assert!(consume_run_ticket(id, &record, 7).is_err());
            let mut http = Fake {
                pool: &pool,
                vault: &vault,
                id: id.into(),
                original: snapshot["parent"].clone(),
                pivot: snapshot["pivot"].clone(),
                event: RefCell::new(Value::Null),
                child: RefCell::new(Value::Null),
                requests: RefCell::new(vec![]),
                fault: "read-loss",
            };
            let deadline = std::time::Duration::from_secs(30);
            saga(
                &pool,
                &vault,
                &http,
                "owner",
                id,
                "grant",
                Mode::Run,
                || Ok(()),
                deadline,
                || std::time::Duration::ZERO,
            )
            .await
            .unwrap();
            // Process restart loses every volatile ticket; durable ledger and provider survive.
            TICKETS
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .remove(id);
            let restarted = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
            consume_run_ticket(id, &restarted, 9).unwrap();
            assert_eq!(
                saga(
                    &pool,
                    &vault,
                    &http,
                    "owner",
                    id,
                    "grant",
                    Mode::Run,
                    || Ok(()),
                    deadline,
                    || std::time::Duration::ZERO
                )
                .await
                .err()
                .unwrap(),
                "WRITE_RECONCILE_REQUIRED"
            );
            http.fault = "child-success";
            http.requests.borrow_mut().clear();
            let recovered = saga(
                &pool,
                &vault,
                &http,
                "owner",
                id,
                "grant",
                Mode::Reconcile,
                || Ok(()),
                deadline,
                || std::time::Duration::ZERO,
            )
            .await
            .unwrap();
            assert_eq!(*http.requests.borrow(), ["GET"]);
            assert_eq!(
                recovered.future.as_ref().unwrap()["successor"]["state"],
                "pending"
            );
            consume_run_ticket(id, &recovered, 9).unwrap();
            let done = saga(
                &pool,
                &vault,
                &http,
                "owner",
                id,
                "grant",
                Mode::Run,
                || Ok(()),
                deadline,
                || std::time::Duration::ZERO,
            )
            .await
            .unwrap();
            assert_eq!(done.state, "applied");
            assert_eq!(
                http.requests
                    .borrow()
                    .iter()
                    .filter(|m| *m != "GET")
                    .cloned()
                    .collect::<Vec<_>>(),
                ["POST"]
            );
            assert!(!ENABLED.load(Ordering::SeqCst));
        });
    }
    #[test]
    fn native_future_execute_routes_success() {
        tauri::async_runtime::block_on(async {
            let _gate = WRITE_GATE.lock().await;
            let (pool, vault, preview, snapshot) = setup().await;
            let id = field(&preview, "operationId").unwrap();
            let http = Fake {
                pool: &pool,
                vault: &vault,
                id: id.into(),
                original: snapshot["parent"].clone(),
                pivot: snapshot["pivot"].clone(),
                event: RefCell::new(Value::Null),
                child: RefCell::new(Value::Null),
                requests: RefCell::new(vec![]),
                fault: "child-success",
            };
            let result = execute(
                &pool,
                &vault,
                &http,
                "owner",
                id,
                "grant",
                false,
                || Ok(()),
                std::time::Duration::from_secs(30),
                || std::time::Duration::ZERO,
            )
            .await
            .unwrap();
            assert_eq!(result["state"], "applied");
            assert_eq!(
                http.requests
                    .borrow()
                    .iter()
                    .filter(|m| *m != "GET")
                    .count(),
                2
            );
        });
    }
    #[test]
    fn native_future_shared_deadline_expires_after_parent_proof() {
        tauri::async_runtime::block_on(async {
            let _gate = WRITE_GATE.lock().await;
            for overdue in [0, 1] {
                let (pool, vault, preview, snapshot) = setup().await;
                let id = field(&preview, "operationId").unwrap();
                let http = Fake {
                    pool: &pool,
                    vault: &vault,
                    id: id.into(),
                    original: snapshot["parent"].clone(),
                    pivot: snapshot["pivot"].clone(),
                    event: RefCell::new(Value::Null),
                    child: RefCell::new(Value::Null),
                    requests: RefCell::new(vec![]),
                    fault: "child-success",
                };
                let deadline = std::time::Duration::from_secs(30);
                let now = Cell::new(deadline - std::time::Duration::from_nanos(1));
                let result = saga(
                    &pool,
                    &vault,
                    &http,
                    "owner",
                    id,
                    "grant",
                    Mode::Run,
                    || Ok(()),
                    deadline,
                    || {
                        let anchored = anchor(&vault, "owner", id).unwrap();
                        // Advance only after the first phase's proof is durably anchored.
                        if anchored.state == "applying" && anchored.future_unknown == Some(false) {
                            now.set(deadline + std::time::Duration::from_nanos(overdue));
                        }
                        now.get()
                    },
                )
                .await;
                assert_eq!(result.err().unwrap(), "WRITE_LEASE_LOST");
                assert!(now.get() >= deadline);
                let record = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
                let future = record.future.unwrap();
                assert_eq!(future["parent"]["state"], "proved");
                assert_eq!(future["successor"]["state"], "pending");
                assert!(!record.outcome_unknown);
                assert_eq!(
                    http.requests
                        .borrow()
                        .iter()
                        .filter(|m| *m != "GET")
                        .cloned()
                        .collect::<Vec<_>>(),
                    ["PATCH"]
                );
                assert!(http.child.borrow().is_null());
            }
        });
    }
    #[test]
    fn native_future_orchestrator_routes_and_deadline() {
        tauri::async_runtime::block_on(async {
            let _gate = WRITE_GATE.lock().await;
            for fault in [
                "child-success",
                "read-loss",
                "child-loss",
                "child-reject",
                "child-reject-restore-412",
                "reject",
            ] {
                let (pool, vault, preview, snapshot) = setup().await;
                let id = field(&preview, "operationId").unwrap();
                let mut http = Fake {
                    pool: &pool,
                    vault: &vault,
                    id: id.into(),
                    original: snapshot["parent"].clone(),
                    pivot: snapshot["pivot"].clone(),
                    event: RefCell::new(Value::Null),
                    child: RefCell::new(Value::Null),
                    requests: RefCell::new(vec![]),
                    fault,
                };
                let now = Cell::new(std::time::Duration::ZERO);
                let deadline = std::time::Duration::from_secs(30);
                let invoke = |mode| {
                    saga(
                        &pool,
                        &vault,
                        &http,
                        "owner",
                        id,
                        "grant",
                        mode,
                        || Ok(()),
                        deadline,
                        || now.get(),
                    )
                };
                assert_eq!(
                    invoke(Mode::Reconcile).await.err().unwrap(),
                    "WRITE_RECONCILE_REQUIRED"
                );
                now.set(deadline);
                assert_eq!(invoke(Mode::Run).await.err().unwrap(), "WRITE_LEASE_LOST");
                assert!(http.requests.borrow().is_empty());
                now.set(deadline - std::time::Duration::from_nanos(1));
                let result = invoke(Mode::Run).await.unwrap();
                assert_eq!(
                    http.requests.borrow().len(),
                    match fault {
                        "read-loss" => 8,
                        "reject" => 7,
                        "child-reject" => 15,
                        "child-reject-restore-412" => 14,
                        _ => 12,
                    },
                    "{fault}"
                );
                let mutations = http
                    .requests
                    .borrow()
                    .iter()
                    .filter(|m| *m != "GET")
                    .count();
                assert_eq!(
                    mutations,
                    if fault == "read-loss" || fault == "reject" {
                        1
                    } else if fault.starts_with("child-reject") {
                        3
                    } else {
                        2
                    }
                );
                if fault == "read-loss" || fault == "child-loss" {
                    assert_eq!(
                        invoke(Mode::Run).await.err().unwrap(),
                        "WRITE_RECONCILE_REQUIRED"
                    );
                    http.fault = "child-success";
                    let recovered = saga(
                        &pool,
                        &vault,
                        &http,
                        "owner",
                        id,
                        "grant",
                        Mode::Reconcile,
                        || Ok(()),
                        deadline,
                        || now.get(),
                    )
                    .await
                    .unwrap();
                    assert_eq!(
                        http.requests
                            .borrow()
                            .iter()
                            .filter(|m| *m != "GET")
                            .count(),
                        mutations
                    );
                    if fault == "read-loss" {
                        assert_eq!(
                            recovered.future.as_ref().unwrap()["successor"]["state"],
                            "pending"
                        );
                    }
                    let done = saga(
                        &pool,
                        &vault,
                        &http,
                        "owner",
                        id,
                        "grant",
                        Mode::Run,
                        || Ok(()),
                        deadline,
                        || now.get(),
                    )
                    .await
                    .unwrap();
                    assert_eq!(done.state, "applied");
                } else if fault == "child-reject-restore-412" {
                    assert_eq!(result.error.as_deref(), Some("COMPENSATION_CONFLICT"));
                    assert!(holds_lock(&anchor(&vault, "owner", id).unwrap()));
                } else if fault == "child-reject" {
                    assert_eq!(result.error.as_deref(), Some("COMPENSATED"));
                } else if fault == "reject" {
                    assert_eq!(result.state, "conflict");
                } else {
                    assert_eq!(result.state, "applied");
                }
                let count = http.requests.borrow().len();
                for mode in [Mode::Run, Mode::Reconcile] {
                    saga(
                        &pool,
                        &vault,
                        &http,
                        "owner",
                        id,
                        "grant",
                        mode,
                        || Ok(()),
                        deadline,
                        || now.get(),
                    )
                    .await
                    .unwrap();
                }
                assert_eq!(http.requests.borrow().len(), count);
            }
        });
    }
    #[derive(Default)]
    struct Memory {
        data: RefCell<HashMap<String, String>>,
        fail: Cell<bool>,
    }
    impl Vault for Memory {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.data.borrow().get(key).cloned())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            if self.fail.get() {
                return Err("KEYRING_FAILED".into());
            }
            self.data.borrow_mut().insert(key.into(), value.into());
            Ok(())
        }
    }
    struct Fake<'a> {
        pool: &'a SqlitePool,
        vault: &'a Memory,
        id: String,
        original: Value,
        pivot: Value,
        event: RefCell<Value>,
        child: RefCell<Value>,
        requests: RefCell<Vec<String>>,
        fault: &'static str,
    }
    impl Http for Fake<'_> {
        fn check_future_session(&self) -> Result<(), String> {
            if self.fault == "session" {
                Err("DISCONNECTED".into())
            } else {
                Ok(())
            }
        }
        async fn call(
            &self,
            method: &str,
            path: &str,
            etag: Option<&str>,
            send: Option<&str>,
            body: Option<Value>,
        ) -> Result<HttpReply, String> {
            self.requests.borrow_mut().push(method.into());
            if method == "POST" {
                let record = ledger(self.pool, self.vault, "owner", &self.id, "grant")
                    .await
                    .unwrap();
                assert_eq!(
                    record.future.as_ref().unwrap()["successor"]["state"],
                    "applying"
                );
                assert!(record.outcome_unknown);
                assert_eq!(record.state, "applying");
                assert!(etag.is_none());
                assert_eq!(send, Some("all"));
                assert_eq!(path, "calendars/cal/events");
                assert_eq!(
                    body.as_ref().unwrap(),
                    &record.preview["intent"]["plan"]["successor"]["body"]
                );
                if self.fault.starts_with("child-reject") {
                    return Ok(HttpReply {
                        status: 403,
                        body: Value::Null,
                    });
                }
                let mut proof = body.unwrap();
                proof["etag"] = json!("s1");
                *self.child.borrow_mut() = proof.clone();
                if self.fault == "child-commit" {
                    self.vault.fail.set(true);
                }
                if self.fault == "child-success" {
                    return Ok(HttpReply {
                        status: 201,
                        body: proof,
                    });
                }
                return Err("WRITE_OUTCOME_UNKNOWN".into());
            }
            if method == "GET" && path.ends_with(&format!("m{}", self.id.replace('-', ""))) {
                assert!(etag.is_none() && send.is_none() && body.is_none());
                if self.fault == "child-loss" {
                    return Err("LOST".into());
                }
                let mut proof = self.child.borrow().clone();
                if self.fault == "child-wrong" {
                    proof["summary"] = json!("third-party");
                }
                return Ok(HttpReply {
                    status: 200,
                    body: proof,
                });
            }
            if method == "PATCH" && !self.event.borrow().is_null() {
                let record = ledger(self.pool, self.vault, "owner", &self.id, "grant")
                    .await
                    .unwrap();
                assert_eq!(
                    record.future.as_ref().unwrap()["compensation"]["state"],
                    "applying"
                );
                assert_eq!(etag, self.event.borrow()["etag"].as_str());
                assert_eq!(send, Some("all"));
                assert_eq!(
                    body.as_ref().unwrap(),
                    &record.preview["intent"]["plan"]["compensation"]["body"]
                );
                if ["restore-reject", "restore-412", "child-reject-restore-412"]
                    .contains(&self.fault)
                {
                    return Ok(HttpReply {
                        status: if self.fault.ends_with("restore-412") {
                            412
                        } else {
                            403
                        },
                        body: Value::Null,
                    });
                }
                let mut restored = self.original.clone();
                restored
                    .as_object_mut()
                    .unwrap()
                    .extend(body.unwrap().as_object().unwrap().clone());
                restored["etag"] = json!("restored");
                *self.event.borrow_mut() = restored;
                if self.fault == "restore-commit" {
                    self.vault.fail.set(true);
                }
                return Err("WRITE_OUTCOME_UNKNOWN".into());
            }
            if method == "PATCH" {
                let record = ledger(self.pool, self.vault, "owner", &self.id, "grant")
                    .await
                    .unwrap();
                assert_eq!(record.state, "applying");
                assert!(record.outcome_unknown);
                assert_eq!(
                    record.future.as_ref().unwrap()["parent"]["state"],
                    "applying"
                );
                assert_eq!(etag, Some("p1"));
                assert_eq!(send, Some("all"));
                assert_eq!(
                    body.as_ref().unwrap(),
                    &record.preview["intent"]["plan"]["parent"]["body"]
                );
                assert_eq!(path, "calendars/cal/events/parent");
                if self.fault == "reject" {
                    return Ok(HttpReply {
                        status: 412,
                        body: Value::Null,
                    });
                }
                let mut proof = self.original.clone();
                proof
                    .as_object_mut()
                    .unwrap()
                    .extend(body.unwrap().as_object().unwrap().clone());
                proof["etag"] = json!("p2");
                *self.event.borrow_mut() = proof;
                if self.fault == "proof-commit" {
                    self.vault.fail.set(true);
                }
                return Err("WRITE_OUTCOME_UNKNOWN".into());
            }
            assert_eq!(method, "GET");
            assert!(etag.is_none() && send.is_none() && body.is_none());
            let body = if path.starts_with("users/me/") {
                json!({"id":"cal","accessRole":"writer"})
            } else if path.contains("/instances?") {
                json!({"items":[self.pivot]})
            } else if path.contains("/events?") {
                json!({"items":[self.original]})
            } else if self.event.borrow().is_null() {
                self.original.clone()
            } else {
                if self.fault == "read-loss"
                    || (self.fault == "restore-loss" && self.event.borrow()["etag"] == "restored")
                {
                    return Err("LOST".into());
                }
                let mut proof = self.event.borrow().clone();
                if self.fault == "wrong-proof" {
                    proof["summary"] = json!("third-party")
                }
                proof
            };
            Ok(HttpReply { status: 200, body })
        }
    }
    async fn setup() -> (SqlitePool, Memory, Value, Value) {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        schema(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE study_state(id INTEGER PRIMARY KEY, version INTEGER, payload TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let locals: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-local-evidence.json"
        ))
        .unwrap();
        sqlx::query("INSERT INTO study_state VALUES(1,4,?)")
            .bind(locals[0]["rawJson"].as_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();
        let plans: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-plan.json"
        ))
        .unwrap();
        let row = &plans[0];
        let local = future_local::read(&pool, "c", "cal", "parent")
            .await
            .unwrap();
        let remote = future_read::RemoteEvidence {
            parent: row["snapshot"]["parent"].clone(),
            pivot: row["snapshot"]["pivot"].clone(),
        };
        let frozen = future_plan::prepare(&row["base"], &remote, &local).unwrap();
        let preview = &frozen["preview"];
        let id = field(preview, "operationId").unwrap();
        let record = Ledger {
            recurring_recurrence: None,
            error: None,
            preview: preview.clone(),
            future: Some(frozen["future"].clone()),
            grant_epoch: "grant".into(),
            version: 1,
            state: "confirmed".into(),
            outcome_unknown: false,
            result: None,
            local: None,
        };
        let mirror=serde_json::from_value(json!({"preview":preview,"future":record.future,"version":1,"state":"pending","outcomeUnknown":false,"attempts":0,"leaseId":null,"leaseUntil":0,"error":null,"result":null,"localApplied":false})).unwrap();
        write_outbox::dispatch(&pool, write_outbox::Request::Insert { operation: mirror })
            .await
            .unwrap();
        let vault = Memory::default();
        persist(&pool, &vault, "owner", id, &record, None)
            .await
            .unwrap();
        vault.set(&head_key("owner"), id).unwrap();
        (pool, vault, preview.clone(), row["snapshot"].clone())
    }
    #[test]
    fn native_future_local_stage_requires_two_current_proofs() {
        tauri::async_runtime::block_on(async {
            let (pool, vault, preview, _) = setup().await;
            let expected_workspace_hash =
                workspace_hash::fingerprint(&sync_store::workspace_payload(&pool).await.unwrap())
                    .unwrap();
            let id = field(&preview, "operationId").unwrap();
            let mut record = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
            let mut proofs = Vec::new();
            for name in ["parent", "successor"] {
                let mut proof = if name == "parent" {
                    preview["intent"]["plan"]["originalParent"].clone()
                } else {
                    json!({})
                };
                proof.as_object_mut().unwrap().extend(
                    preview["intent"]["plan"][name]["body"]
                        .as_object()
                        .unwrap()
                        .clone(),
                );
                proof["etag"] = json!(format!("{name}-proved"));
                record.future.as_mut().unwrap()[name] = json!({"state":"proved","outcomeUnknown":false,"etag":proof["etag"],"proof":proof});
                proofs.push(proof);
            }
            record.state = "applied".into();
            record.result = Some(
                json!({"future":{"markerHash":preview["intent"]["plan"]["markerHash"],"parent":proofs[0],"successor":proofs[1]}}),
            );
            record.version += 1;
            persist(&pool, &vault, "owner", id, &record, None)
                .await
                .unwrap();
            for fault in ["partial", "unknown", "restored", "result", "proof"] {
                let mut invalid = record.clone();
                match fault {
                    "partial" => {
                        invalid.future.as_mut().unwrap()["successor"] = json!({"state":"pending"})
                    }
                    "unknown" => invalid.outcome_unknown = true,
                    "restored" => {
                        invalid.future.as_mut().unwrap()["compensation"]["state"] = json!("proved")
                    }
                    "result" => {
                        invalid.result.as_mut().unwrap()["future"]["markerHash"] = json!("forged")
                    }
                    _ => {
                        invalid.future.as_mut().unwrap()["parent"]["proof"]["summary"] =
                            json!("forged")
                    }
                }
                assert!(write_local::future_plan(&invalid).is_err(), "{fault}");
            }
            struct Reads {
                proofs: Vec<Value>,
                role: &'static str,
            }
            impl Http for Reads {
                async fn call(
                    &self,
                    method: &str,
                    path: &str,
                    _: Option<&str>,
                    _: Option<&str>,
                    _: Option<Value>,
                ) -> Result<HttpReply, String> {
                    assert_eq!(method, "GET");
                    Ok(HttpReply {
                        status: 200,
                        body: if path.starts_with("users/me/") {
                            json!({"id":"cal","accessRole":self.role})
                        } else {
                            self.proofs
                                .iter()
                                .find(|p| path.ends_with(p["id"].as_str().unwrap()))
                                .unwrap()
                                .clone()
                        },
                    })
                }
            }
            let http = Reads {
                proofs: proofs.clone(),
                role: "writer",
            };
            let scopes = vec![WRITE_SCOPE.into()];
            let rejected = Reads {
                proofs: vec![
                    proofs[0].clone(),
                    json!({"id":proofs[1]["id"],"etag":"incomplete"}),
                ],
                role: "writer",
            };
            assert!(
                write_local::stage(&pool, &vault, &rejected, "owner", id, "grant", &scopes)
                    .await
                    .is_err()
            );
            assert!(ledger(&pool, &vault, "owner", id, "grant")
                .await
                .unwrap()
                .local
                .is_none());
            vault.fail.set(true);
            assert_eq!(
                write_local::stage(&pool, &vault, &http, "owner", id, "grant", &scopes)
                    .await
                    .unwrap_err(),
                "KEYRING_FAILED"
            );
            vault.fail.set(false);
            assert!(ledger(&pool, &vault, "owner", id, "grant")
                .await
                .unwrap()
                .local
                .is_none());
            let batch = write_local::stage(&pool, &vault, &http, "owner", id, "grant", &scopes)
                .await
                .unwrap();
            assert_eq!(batch["items"], json!(proofs));
            assert_eq!(batch["plan"]["kind"], "recurring.future");
            let fixture: Value = serde_json::from_str(include_str!(
                "../../tests/fixtures/calendar-future-projection.json"
            ))
            .unwrap();
            assert_eq!(
                batch["plan"]
                    .as_object()
                    .unwrap()
                    .keys()
                    .collect::<Vec<_>>(),
                fixture["cases"][0]["batch"]["plan"]
                    .as_object()
                    .unwrap()
                    .keys()
                    .collect::<Vec<_>>()
            );
            // The TS fixture fixes the shape; this independent expectation binds every value to setup evidence.
            assert_eq!(
                batch["plan"],
                json!({
                    "kind": fixture["cases"][0]["batch"]["plan"]["kind"],
                    "hash": preview["hash"],
                    "parentEventId": preview["intent"]["parent"]["eventId"],
                    "pivotEventId": preview["intent"]["plan"]["pivot"]["eventId"],
                    "successorEventId": preview["intent"]["plan"]["successor"]["eventId"],
                    "originalStart": preview["intent"]["originalStart"],
                    "markerHash": preview["intent"]["plan"]["markerHash"],
                    "steps": {
                        "parent": {"state":"proved","proof":proofs[0]},
                        "successor": {"state":"proved","proof":proofs[1]}
                    }
                })
            );
            assert_eq!(batch["operationId"], preview["operationId"]);
            assert_eq!(
                batch["sourceId"],
                "calendar-provider:%5B%22google%22%2C%22c%22%2C%22cal%22%5D"
            );
            assert_eq!(batch["expectedWorkspaceHash"], expected_workspace_hash);
            assert_eq!(
                batch["plan"]["steps"]["parent"],
                json!({"state":"proved","proof":proofs[0]})
            );
            assert_eq!(
                batch["plan"]["steps"]["successor"],
                json!({"state":"proved","proof":proofs[1]})
            );
            assert_eq!(
                write_local::stage(&pool, &vault, &http, "owner", id, "grant", &scopes)
                    .await
                    .unwrap(),
                batch
            );
            let denied = Reads {
                proofs: proofs.clone(),
                role: "freeBusyReader",
            };
            assert!(
                write_local::stage(&pool, &vault, &denied, "owner", id, "grant", &scopes)
                    .await
                    .is_err()
            );
            let mut changed = Reads {
                proofs,
                role: "writer",
            };
            changed.proofs[1]["etag"] = json!("changed");
            assert!(
                write_local::stage(&pool, &vault, &changed, "owner", id, "grant", &scopes)
                    .await
                    .is_err()
            );
            assert_eq!(
                ledger(&pool, &vault, "owner", id, "grant")
                    .await
                    .unwrap()
                    .local
                    .unwrap()
                    .batch,
                batch
            );
            let original = sync_store::workspace_payload(&pool).await.unwrap();
            let mut stale = original.clone();
            stale["revision"] = json!(999);
            sqlx::query("UPDATE study_state SET payload=? WHERE id=1")
                .bind(stale.to_string())
                .execute(&pool)
                .await
                .unwrap();
            assert_eq!(
                write_local::stage(&pool, &vault, &http, "owner", id, "grant", &scopes)
                    .await
                    .unwrap_err(),
                "WRITE_LOCAL_BASELINE_STALE"
            );
            sqlx::query("UPDATE study_state SET payload=? WHERE id=1")
                .bind(original.to_string())
                .execute(&pool)
                .await
                .unwrap();
            assert_eq!(
                write_local::ack(
                    &pool,
                    &vault,
                    "owner",
                    id,
                    "grant",
                    batch["batchId"].as_str().unwrap(),
                    "fake"
                )
                .await
                .unwrap_err(),
                "WRITE_LOCAL_BASELINE_STALE"
            );
        });
    }
    #[test]
    fn native_future_parent_durable_unknown_and_read_only_restart() {
        tauri::async_runtime::block_on(async {
            for fault in [
                "",
                "read-loss",
                "wrong-proof",
                "reject",
                "session",
                "keyring",
                "grant",
                "lease",
                "digest",
                "lock",
                "proof-commit",
            ] {
                let (pool, vault, preview, snapshot) = setup().await;
                let id = field(&preview, "operationId").unwrap();
                let mut http = Fake {
                    pool: &pool,
                    vault: &vault,
                    id: id.into(),
                    original: snapshot["parent"].clone(),
                    pivot: snapshot["pivot"].clone(),
                    event: RefCell::new(Value::Null),
                    child: RefCell::new(Value::Null),
                    requests: RefCell::new(vec![]),
                    fault,
                };
                if fault == "keyring" {
                    vault.fail.set(true)
                }
                if fault == "digest" {
                    sqlx::query("UPDATE calendar_write_outbox SET native_payload='{}'")
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                if fault == "lock" {
                    let mut other = anchor(&vault, "owner", id).unwrap();
                    other.state = "applying".into();
                    other.previous = Some(id.into());
                    vault
                        .set(
                            &anchor_key("owner", "other"),
                            &serde_json::to_string(&other).unwrap(),
                        )
                        .unwrap();
                    vault.set(&head_key("owner"), "other").unwrap();
                }
                let result = parent(&pool, &vault, &http, "owner", id, "grant", || match fault {
                    "grant" => Err("WRITE_GRANT_CHANGED".into()),
                    "lease" => Err("WRITE_LEASE_LOST".into()),
                    _ => Ok(()),
                })
                .await;
                if fault == "proof-commit" {
                    assert!(result.is_err());
                    vault.fail.set(false);
                    let old = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
                    assert_eq!(old.future.as_ref().unwrap()["parent"]["state"], "applying");
                    http.fault = "";
                    http.requests.borrow_mut().clear();
                    let recovered = parent(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                        .await
                        .unwrap();
                    assert_eq!(
                        recovered.future.as_ref().unwrap()["parent"]["state"],
                        "proved"
                    );
                    assert_eq!(*http.requests.borrow(), vec!["GET"]);
                    continue;
                }
                let writes = http
                    .requests
                    .borrow()
                    .iter()
                    .filter(|s| s.as_str() == "PATCH")
                    .count();
                if ["session", "keyring", "grant", "lease", "digest", "lock"].contains(&fault) {
                    assert!(result.is_err(), "{fault}");
                    assert_eq!(writes, 0, "{fault}");
                    continue;
                }
                assert_eq!(writes, 1);
                let record = result.unwrap();
                assert_eq!(record.state, "applying");
                assert!(record.result.is_none());
                assert_eq!(
                    record.future.as_ref().unwrap()["successor"]["state"],
                    "pending"
                );
                let expected = match fault {
                    "" => "proved",
                    "reject" => "conflict",
                    _ => "unknown",
                };
                assert_eq!(record.future.as_ref().unwrap()["parent"]["state"], expected);
                http.fault = "";
                http.requests.borrow_mut().clear();
                let recovered = parent(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                    .await
                    .unwrap();
                assert!(http.requests.borrow().iter().all(|s| s == "GET"));
                assert_eq!(
                    recovered.future.as_ref().unwrap()["parent"]["state"],
                    if fault == "reject" {
                        "conflict"
                    } else {
                        "proved"
                    }
                );
            }
        });
    }
    #[test]
    fn native_future_successor_success_rejection_and_read_only_recovery() {
        tauri::async_runtime::block_on(async {
            for fault in [
                "child-success",
                "",
                "child-loss",
                "child-wrong",
                "child-reject",
                "child-commit",
                "keyring",
                "session",
                "grant",
                "wrong-proof",
                "child-lock",
            ] {
                let (pool, vault, preview, snapshot) = setup().await;
                let id = field(&preview, "operationId").unwrap();
                let mut http = Fake {
                    pool: &pool,
                    vault: &vault,
                    id: id.into(),
                    original: snapshot["parent"].clone(),
                    pivot: snapshot["pivot"].clone(),
                    event: RefCell::new(Value::Null),
                    child: RefCell::new(Value::Null),
                    requests: RefCell::new(vec![]),
                    fault: "",
                };
                let parent_result = parent(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                    .await
                    .unwrap();
                http.fault = fault;
                if fault == "keyring" {
                    vault.fail.set(true);
                }
                if fault == "child-lock" {
                    let mut other = anchor(&vault, "owner", id).unwrap();
                    other.previous = Some(id.into());
                    vault
                        .set(
                            &anchor_key("owner", "other"),
                            &serde_json::to_string(&other).unwrap(),
                        )
                        .unwrap();
                    vault.set(&head_key("owner"), "other").unwrap();
                }
                let outcome = successor(&pool, &vault, &http, "owner", id, "grant", || {
                    if fault == "grant" {
                        Err("WRITE_GRANT_CHANGED".into())
                    } else {
                        Ok(())
                    }
                })
                .await;
                let mutations: Vec<_> = http
                    .requests
                    .borrow()
                    .iter()
                    .filter(|s| s.as_str() != "GET")
                    .cloned()
                    .collect();
                if ["keyring", "session", "grant", "wrong-proof", "child-lock"].contains(&fault) {
                    assert!(outcome.is_err());
                    assert_eq!(mutations, vec!["PATCH"]);
                    continue;
                }
                assert_eq!(mutations, vec!["PATCH", "POST"]);
                if fault == "child-commit" {
                    assert!(outcome.is_err());
                    vault.fail.set(false);
                    let durable = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
                    assert_eq!(durable.state, "applying");
                    assert_eq!(
                        durable.future.as_ref().unwrap()["successor"]["state"],
                        "applying"
                    );
                } else {
                    let record = outcome.unwrap();
                    if ["child-loss", "child-wrong", "child-reject"].contains(&fault) {
                        assert_eq!(record.state, "applying");
                        assert!(record.result.is_none());
                    }
                    if fault == "child-reject" {
                        assert_eq!(
                            record.future.as_ref().unwrap()["successor"]["state"],
                            "rejected"
                        );
                    }
                }
                http.fault = "";
                http.requests.borrow_mut().clear();
                let recovered = successor(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                    .await
                    .unwrap();
                assert!(http.requests.borrow().iter().all(|s| s == "GET"));
                if fault == "child-reject" {
                    assert_eq!(recovered.state, "applying");
                    assert!(recovered.result.is_none());
                    assert_eq!(anchor(&vault, "owner", id).unwrap().state, "applying");
                    continue;
                }
                assert_eq!(recovered.state, "applied");
                assert!(!recovered.outcome_unknown);
                assert!(recovered.local.is_none());
                let expected = json!({"operationId":preview["operationId"],"connectionId":preview["connectionId"],"calendarId":preview["calendarId"],"eventId":preview["intent"]["plan"]["parent"]["eventId"],"etag":parent_result.future.as_ref().unwrap()["parent"]["etag"],"future":{"markerHash":preview["intent"]["plan"]["markerHash"],"parent":parent_result.future.as_ref().unwrap()["parent"]["proof"],"successor":http.child.borrow().clone()}});
                assert_eq!(recovered.result, Some(expected));
            }
        });
    }
    #[test]
    fn native_future_compensation_restores_once_or_retains_lock() {
        tauri::async_runtime::block_on(async {
            for fault in [
                "",
                "restore-loss",
                "restore-reject",
                "restore-412",
                "restore-commit",
                "wrong-proof",
                "keyring",
                "child-conflict",
            ] {
                let (pool, vault, preview, snapshot) = setup().await;
                let id = field(&preview, "operationId").unwrap();
                let mut http = Fake {
                    pool: &pool,
                    vault: &vault,
                    id: id.into(),
                    original: snapshot["parent"].clone(),
                    pivot: snapshot["pivot"].clone(),
                    event: RefCell::new(Value::Null),
                    child: RefCell::new(Value::Null),
                    requests: RefCell::new(vec![]),
                    fault: "",
                };
                parent(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                    .await
                    .unwrap();
                http.fault = "child-reject";
                let mut record = successor(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                    .await
                    .unwrap();
                if fault == "child-conflict" {
                    record.future.as_mut().unwrap()["successor"]["state"] = json!("conflict");
                    record.version += 1;
                    persist(&pool, &vault, "owner", id, &record, None)
                        .await
                        .unwrap();
                }
                http.event.borrow_mut()["etag"] = json!("latest");
                http.fault = fault;
                http.requests.borrow_mut().clear();
                if fault == "keyring" {
                    vault.fail.set(true);
                }
                let result =
                    compensate(&pool, &vault, &http, "owner", id, "grant", || Ok(())).await;
                let writes = http
                    .requests
                    .borrow()
                    .iter()
                    .filter(|s| s.as_str() == "PATCH")
                    .count();
                assert_eq!(
                    writes,
                    if ["wrong-proof", "keyring", "child-conflict"].contains(&fault) {
                        0
                    } else {
                        1
                    },
                    "{fault}"
                );
                if fault == "keyring" {
                    assert!(result.is_err());
                    continue;
                }
                if fault == "restore-commit" {
                    assert!(result.is_err());
                    vault.fail.set(false);
                } else {
                    let record = result.unwrap();
                    assert!(record.result.is_none());
                    assert!(record.local.is_none());
                    if [
                        "wrong-proof",
                        "restore-reject",
                        "restore-412",
                        "child-conflict",
                    ]
                    .contains(&fault)
                    {
                        assert_eq!(record.state, "conflict");
                        assert!(record.outcome_unknown);
                        assert_eq!(record.error.as_deref(), Some("COMPENSATION_CONFLICT"));
                        assert!(holds_lock(&anchor(&vault, "owner", id).unwrap()));
                        continue;
                    }
                }
                http.fault = "";
                http.requests.borrow_mut().clear();
                let record = compensate(&pool, &vault, &http, "owner", id, "grant", || Ok(()))
                    .await
                    .unwrap();
                assert!(http.requests.borrow().iter().all(|s| s == "GET"));
                assert_eq!(record.state, "failed");
                assert!(!record.outcome_unknown);
                assert_eq!(record.error.as_deref(), Some("COMPENSATED"));
                assert!(!holds_lock(&anchor(&vault, "owner", id).unwrap()));
            }
        });
    }
}
