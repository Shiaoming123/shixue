//! Prepare/confirm only. The caller holds WRITE_GATE.
use super::*;

pub(super) fn operation_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "RANDOM_UNAVAILABLE")?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex = format!("{:032x}", u128::from_be_bytes(bytes));
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    ))
}

pub(super) async fn prepare<V: Vault, H: Http>(
    pool: &SqlitePool,
    vault: &V,
    http: &H,
    owner: &str,
    epoch: &str,
    base: &Value,
    check: impl Fn() -> Result<(), String>,
) -> Result<Value, String> {
    check()?;
    let calendar = field(base, "calendarId")?;
    let intent = &base["intent"];
    // The pure constructor rejects caller-supplied plan/hash/locks before persistence.
    let local = future_local::read(
        pool,
        field(base, "connectionId")?,
        calendar,
        field(&intent["parent"], "eventId")?,
    )
    .await?;
    let remote = future_read::read(
        http,
        calendar,
        &intent["parent"],
        field(intent, "originalStart")?,
    )
    .await?;
    let frozen = future_plan::prepare(base, &remote, &local)?;
    let preview = &frozen["preview"];
    confirmation(preview)?;
    let entries = indexed(vault, owner)?;
    if entries.len() >= 512 {
        return Err("WRITE_OUTBOX_FULL".into());
    }
    let keys = lock_keys(&preview["intent"])?;
    if entries.iter().any(|(_, a)| {
        a.calendar_id == calendar
            && holds_lock(a)
            && a.lock_keys.iter().any(|key| keys.contains(key))
    }) {
        return Err("WRITE_BUSY".into());
    }
    let latest = future_read::read(
        http,
        calendar,
        &intent["parent"],
        field(intent, "originalStart")?,
    )
    .await?;
    if latest.parent != remote.parent || latest.pivot != remote.pivot {
        return Err("WRITE_PREVIEW_CHANGED".into());
    }
    local.revalidate(pool).await?;
    check()?;
    let id = field(preview, "operationId")?;
    let previous = vault.get(&head_key(owner))?;
    let record = Ledger {
        error: None,
        preview: preview.clone(),
        future: Some(frozen["future"].clone()),
        grant_epoch: epoch.into(),
        version: 1,
        state: "prepared".into(),
        outcome_unknown: false,
        result: None,
        local: None,
    };
    let mirror = serde_json::from_value(json!({"preview":preview,"future":record.future,"version":1,"state":"pending","outcomeUnknown":false,"attempts":0,"leaseId":null,"leaseUntil":0,"error":null,"result":null,"localApplied":false})).map_err(|_| "WRITE_INVALID")?;
    write_outbox::dispatch(pool, write_outbox::Request::Insert { operation: mirror }).await?;
    local.revalidate(pool).await?;
    check()?;
    persist(pool, vault, owner, id, &record, previous).await?;
    check()?;
    vault.set(&head_key(owner), id)?;
    check()?;
    Ok(preview.clone())
}

pub(super) async fn confirm<V: Vault>(
    pool: &SqlitePool,
    vault: &V,
    owner: &str,
    expected: &Ledger,
    generation: u64,
    check: impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let id = field(&expected.preview, "operationId")?;
    let hash = field(&expected.preview, "hash")?;
    let mut record = ledger(pool, vault, owner, id, &expected.grant_epoch).await?;
    if serde_json::to_value(&record).map_err(|_| "WRITE_INVALID")?
        != serde_json::to_value(expected).map_err(|_| "WRITE_INVALID")?
    {
        return Err("WRITE_PREVIEW_CHANGED".into());
    }
    if record.state != "prepared" {
        return Err("WRITE_CONFIRM_REQUIRED".into());
    }
    ticket(id, hash, generation, false)?;
    check()?;
    record.state = "confirmed".into();
    record.version += 1;
    let previous = anchor(vault, owner, id)?.previous;
    persist(pool, vault, owner, id, &record, previous).await
}

pub(super) fn confirmation(preview: &Value) -> Result<String, String> {
    let plan = &preview["intent"]["plan"];
    let pending = json!({"parent":{"state":"pending"},"successor":{"state":"pending"},"compensation":{"state":"pending"}});
    write_outbox::future::validate(preview, &pending)?;
    let policy = field(preview, "sendUpdates")?;
    let notification = match policy {
        "all" => "所有参与者",
        "externalOnly" => "非 Google 日历参与者",
        "none" => "不发送更新通知（提供方仍可能发送其他邮件）",
        _ => return Err("WRITE_INVALID".into()),
    };
    let message = format!("范围：本次及以后\n日历：{}\n原系列（parent）ID：{}\n起点实例（pivot）ID：{}\n原始开始：{}\n后续系列（successor）ID：{}\n后续标题：{}\n两步远端操作，非原子：\n1. 截断原系列至本次之前。\n2. 创建固定 ID 的后续系列。\n通知范围（sendUpdates={}）：{}；适用于两步及补偿。\n风险：第二步失败时可能补偿恢复原系列；第三方修改或丢失响应可能导致补偿失败、冲突或结果未知，不能保证原子回滚。",
        field(preview,"calendarId")?, field(&plan["parent"],"eventId")?, field(&plan["pivot"],"eventId")?, field(plan,"originalStart")?, field(&plan["successor"],"eventId")?, field(&preview["intent"]["fields"],"title")?, policy, notification);
    if message.chars().count() > 1500 {
        return Err("WRITE_PREVIEW_TOO_LARGE".into());
    }
    Ok(message)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    #[derive(Default)]
    struct Memory {
        data: RefCell<HashMap<String, String>>,
        fail: Cell<u8>,
    }
    impl Vault for Memory {
        fn get(&self, key: &str) -> Result<Option<String>, String> {
            Ok(self.data.borrow().get(key).cloned())
        }
        fn set(&self, key: &str, value: &str) -> Result<(), String> {
            if self.fail.get() == 1 || (self.fail.get() == 2 && key.ends_with(":head")) {
                return Err("KEYRING_FAILED".into());
            }
            self.data.borrow_mut().insert(key.into(), value.into());
            Ok(())
        }
    }
    struct Reader {
        pool: SqlitePool,
        parent: Value,
        pivot: Value,
        calls: Cell<usize>,
        fault: &'static str,
    }
    impl Http for Reader {
        fn check_future_session(&self) -> Result<(), String> {
            if self.fault == "session" && self.calls.get() >= 6 {
                return Err("DISCONNECTED".into());
            }
            Ok(())
        }
        async fn call(
            &self,
            method: &str,
            path: &str,
            etag: Option<&str>,
            send: Option<&str>,
            body: Option<Value>,
        ) -> Result<HttpReply, String> {
            assert_eq!(method, "GET");
            assert!(etag.is_none() && send.is_none() && body.is_none());
            let n = self.calls.get();
            self.calls.set(n + 1);
            if n == 6 && self.fault == "local" {
                sqlx::query("UPDATE study_state SET payload=payload || ' '")
                    .execute(&self.pool)
                    .await
                    .unwrap();
            }
            let reply = if path.starts_with("users/me/") {
                json!({"id":"cal","accessRole":"writer"})
            } else if path.contains("/instances?") {
                let mut pivot = self.pivot.clone();
                if n >= 6 && self.fault == "remote" {
                    pivot["etag"] = json!("changed");
                }
                json!({"items":[pivot]})
            } else if path.contains("/events?") {
                json!({"items":[self.parent]})
            } else {
                self.parent.clone()
            };
            Ok(HttpReply {
                status: 200,
                body: reply,
            })
        }
    }
    async fn setup(fault: &'static str) -> (SqlitePool, Memory, Reader, Value) {
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
        let mut base = plans[0]["base"].clone();
        base["operationId"] = json!(operation_id().unwrap());
        let reader = Reader {
            pool: pool.clone(),
            parent: plans[0]["snapshot"]["parent"].clone(),
            pivot: plans[0]["snapshot"]["pivot"].clone(),
            calls: Cell::new(0),
            fault,
        };
        (pool, Memory::default(), reader, base)
    }
    #[test]
    fn native_future_prepare_confirm_anchors_exact_plan_and_never_mutates() {
        tauri::async_runtime::block_on(async {
            let _guard = WRITE_GATE.lock().await;
            let (pool, vault, http, base) = setup("").await;
            let preview = prepare(&pool, &vault, &http, "owner", "grant", &base, || Ok(()))
                .await
                .unwrap();
            assert_eq!(http.calls.get(), 12);
            let id = field(&preview, "operationId").unwrap();
            assert_eq!(&id[14..15], "4");
            assert!(matches!(&id[19..20], "8" | "9" | "a" | "b"));
            assert_eq!(vault.get(&head_key("owner")).unwrap().as_deref(), Some(id));
            let record = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
            assert_eq!(record.state, "prepared");
            assert_eq!(record.preview, preview);
            assert_eq!(
                json!(anchor(&vault, "owner", id).unwrap().lock_keys),
                preview["lockKeys"]
            );
            let mirror =
                write_outbox::dispatch(&pool, write_outbox::Request::Get { id: id.into() })
                    .await
                    .unwrap();
            assert_eq!(mirror["future"], json!(record.future));
            let message = confirmation(&preview).unwrap();
            for text in [
                "本次及以后",
                "parent",
                "pivot",
                "successor",
                "非原子",
                "补偿",
                "sendUpdates=all",
            ] {
                assert!(message.contains(text), "{text}");
            }
            prepared_ticket(&preview, 7).unwrap();
            assert!(confirm(&pool, &vault, "owner", &record, 8, || Ok(()))
                .await
                .is_err());
            assert!(confirm(&pool, &vault, "owner", &record, 7, || Err(
                "WRITE_GRANT_CHANGED".into()
            ))
            .await
            .is_err());
            let mut changed = record.clone();
            changed.preview["hash"] = json!("changed");
            assert!(confirm(&pool, &vault, "owner", &changed, 7, || Ok(()))
                .await
                .is_err());
            vault.fail.set(1);
            assert!(confirm(&pool, &vault, "owner", &record, 7, || Ok(()))
                .await
                .is_err());
            vault.fail.set(0);
            assert_eq!(
                ledger(&pool, &vault, "owner", id, "grant")
                    .await
                    .unwrap()
                    .state,
                "prepared"
            );
            confirm(&pool, &vault, "owner", &record, 7, || Ok(()))
                .await
                .unwrap();
            let confirmed = ledger(&pool, &vault, "owner", id, "grant").await.unwrap();
            assert_eq!(confirmed.state, "confirmed");
            assert_eq!(confirmed.future, record.future);
            assert!(!confirmed.outcome_unknown);
            assert!(confirm(&pool, &vault, "owner", &record, 7, || Ok(()))
                .await
                .is_err());
            for reconcile in [false, true] {
                assert_eq!(
                    execute(
                        &pool,
                        &vault,
                        &http,
                        "owner",
                        id,
                        "grant",
                        reconcile,
                        || Err("WRITE_UNAVAILABLE".into()),
                        std::time::Duration::from_secs(30),
                        || std::time::Duration::ZERO
                    )
                    .await
                    .unwrap_err(),
                    "WRITE_UNAVAILABLE"
                );
            }
            assert_eq!(http.calls.get(), 12);
        });
    }
    #[test]
    fn native_future_prepare_stale_evidence_and_storage_fail_closed() {
        tauri::async_runtime::block_on(async {
            let _guard = WRITE_GATE.lock().await;
            for fault in [
                "local", "remote", "session", "grant", "keyring", "head", "store", "busy",
            ] {
                let (pool, vault, http, base) = setup(fault).await;
                if fault == "keyring" {
                    vault.fail.set(1);
                }
                if fault == "head" {
                    vault.fail.set(2);
                }
                if fault == "store" {
                    sqlx::query("CREATE TRIGGER fail_native BEFORE UPDATE OF native_payload ON calendar_write_outbox BEGIN SELECT RAISE(FAIL, 'fail'); END").execute(&pool).await.unwrap();
                }
                if fault == "busy" {
                    let blocker = Anchor {
                        future_unknown: None,
                        digest: "unused".into(),
                        version: 1,
                        state: "applying".into(),
                        result: None,
                        grant_epoch: "grant".into(),
                        event_id: "parent".into(),
                        calendar_id: "cal".into(),
                        previous: None,
                        lock_keys: vec!["parent".into()],
                    };
                    vault
                        .set(
                            &anchor_key("owner", "blocking"),
                            &serde_json::to_string(&blocker).unwrap(),
                        )
                        .unwrap();
                    vault.set(&head_key("owner"), "blocking").unwrap();
                }
                let checks = Cell::new(0);
                let result = prepare(&pool, &vault, &http, "owner", "grant", &base, || {
                    checks.set(checks.get() + 1);
                    if fault == "grant" && checks.get() == 2 {
                        return Err("WRITE_GRANT_CHANGED".into());
                    }
                    Ok(())
                })
                .await;
                assert!(result.is_err(), "{fault}");
                let id = field(&base, "operationId").unwrap();
                assert!(ticket(id, "anything", 0, false).is_err());
                if fault != "head" {
                    assert!(
                        ledger(&pool, &vault, "owner", id, "grant").await.is_err(),
                        "{fault}"
                    );
                } else {
                    assert_eq!(
                        ledger(&pool, &vault, "owner", id, "grant")
                            .await
                            .unwrap()
                            .state,
                        "prepared"
                    );
                }
                if ["local", "remote", "session", "grant", "busy"].contains(&fault) {
                    let count: i64 =
                        sqlx::query_scalar("SELECT count(*) FROM calendar_write_outbox")
                            .fetch_one(&pool)
                            .await
                            .unwrap();
                    assert_eq!(count, 0, "{fault}");
                }
            }
        });
    }
}
