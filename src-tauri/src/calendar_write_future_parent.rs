//! Parent/successor phases. Test-only until the complete future sender is reviewed.
use super::*;

async fn parent<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    id: &str,
    epoch: &str,
    authorization: impl Fn() -> Result<(), String>,
) -> Result<Ledger, String> {
    let _gate = WRITE_GATE.lock().await;
    let lease = std::time::Instant::now();
    let check = || -> Result<(), String> {
        authorization()?;
        http.check_future_session()?;
        if lease.elapsed() >= std::time::Duration::from_secs(30) {
            return Err("WRITE_LEASE_LOST".into());
        }
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
            && other.state == "applying"
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
    let _gate = WRITE_GATE.lock().await;
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
async fn call<H: Http>(
    http: &H,
    preview: &Value,
    name: &str,
    mutate: bool,
) -> Result<Value, String> {
    let request = future_step::request(preview, name, mutate)?;
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
                if self.fault == "child-reject" {
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
                if self.fault == "read-loss" {
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
}
