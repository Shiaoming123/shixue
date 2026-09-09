//! Trusted full-workspace evidence; no caller-provided hash or clearance.
use super::*;
#[derive(Debug)]
pub(super) struct LocalEvidence {
    pub(super) event_id: String,
    pub(super) source_id: String,
    pub(super) attached_facts: Vec<String>,
    pub(super) workspace_hash: String,
    pub(super) normalized_workspace: Vec<u8>,
    raw_workspace: Vec<u8>,
}
impl LocalEvidence {
    pub(super) async fn revalidate(&self, pool: &SqlitePool) -> Result<(), String> {
        sync_store::workspace_payload_v4_bytes(pool, Some(&self.raw_workspace)).await?;
        Ok(())
    }
}
pub(super) async fn read(
    pool: &SqlitePool,
    connection: &str,
    calendar: &str,
    parent: &str,
) -> Result<LocalEvidence, String> {
    if [connection, calendar, parent]
        .iter()
        .any(|id| id.is_empty() || id.encode_utf16().count() > 100_000)
    {
        return Err("WRITE_IDENTITY_INVALID".into());
    }
    let raw_workspace = sync_store::workspace_payload_v4_bytes(pool, None).await?;
    let normalized_workspace = workspace_parse::normalize_workspace_root(&raw_workspace)?;
    let workspace_hash = format!("sha256:{:x}", Sha256::digest(&normalized_workspace));
    // Reparse only after full ordered normalization; never reserialize for the hash.
    let workspace: Value =
        serde_json::from_slice(&normalized_workspace).map_err(|_| "WORKSPACE_INVALID")?;
    let source_id = write_local::projection::stable_id(connection, calendar, None);
    let event_id = write_local::projection::stable_id(connection, calendar, Some(parent));
    let items = |key: &str| workspace[key].as_array().ok_or("WORKSPACE_INVALID");
    if items("calendarSources")?
        .iter()
        .any(|s| s["id"] == source_id && s["provider"] != "google")
        || items("calendarEvents")?
            .iter()
            .any(|e| e["id"] == event_id && e["sourceId"] != source_id)
    {
        return Err("WRITE_IDENTITY_INVALID".into());
    }
    let mut attached_facts = Vec::new();
    for key in ["calendarEventLinks", "eventOutcomes"] {
        for item in items(key)?
            .iter()
            .filter(|item| item["eventId"] == event_id)
        {
            attached_facts.push(item["id"].as_str().ok_or("WORKSPACE_INVALID")?.to_string());
        }
    }
    let mut rule_ids = std::collections::HashSet::new();
    for rule in items("reminderRules")?
        .iter()
        .filter(|rule| rule["target"]["kind"] == "event" && rule["target"]["eventId"] == event_id)
    {
        let id = rule["id"].as_str().ok_or("WORKSPACE_INVALID")?;
        rule_ids.insert(id);
        attached_facts.push(id.to_string());
    }
    for delivery in items("reminderDeliveries")? {
        if rule_ids.contains(
            delivery["reminderRuleId"]
                .as_str()
                .ok_or("WORKSPACE_INVALID")?,
        ) {
            attached_facts.push(
                delivery["id"]
                    .as_str()
                    .ok_or("WORKSPACE_INVALID")?
                    .to_string(),
            );
        }
    }
    Ok(LocalEvidence {
        event_id,
        source_id,
        attached_facts,
        workspace_hash,
        normalized_workspace,
        raw_workspace,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_ts_reader_evidence_and_raw_precondition() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
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
            let cases: Value = serde_json::from_str(include_str!(
                "../../tests/fixtures/calendar-future-local-evidence.json"
            ))
            .unwrap();
            let mut clean_hash = None;
            for case in cases.as_array().unwrap() {
                let raw = case["rawJson"].as_str().unwrap();
                sqlx::query("INSERT OR REPLACE INTO study_state VALUES(1,4,?)")
                    .bind(raw)
                    .execute(&pool)
                    .await
                    .unwrap();
                let evidence = read(
                    &pool,
                    case["connection"].as_str().unwrap(),
                    case["calendar"].as_str().unwrap(),
                    case["parent"].as_str().unwrap(),
                )
                .await
                .unwrap();
                assert_eq!(evidence.event_id, case["eventId"]);
                assert_eq!(evidence.source_id, case["sourceId"]);
                assert_eq!(
                    json!(evidence.attached_facts),
                    case["attachedFacts"],
                    "{}",
                    case["name"]
                );
                assert_eq!(evidence.workspace_hash, case["hash"]);
                assert_eq!(
                    evidence.normalized_workspace,
                    case["parsedJson"].as_str().unwrap().as_bytes()
                );
                if case["name"] == "clean" {
                    clean_hash = Some(evidence.workspace_hash.clone());
                }
                if case["name"] == "unrelated-change" {
                    assert_ne!(Some(&evidence.workspace_hash), clean_hash.as_ref());
                }
                evidence.revalidate(&pool).await.unwrap();
                sqlx::query("UPDATE study_state SET payload=?")
                    .bind(format!(" {raw}"))
                    .execute(&pool)
                    .await
                    .unwrap();
                assert_eq!(
                    evidence.revalidate(&pool).await.unwrap_err(),
                    "WORKSPACE_STALE"
                );
            }
            let case = &cases[5];
            let raw = case["rawJson"].as_str().unwrap();
            let identity = (
                case["connection"].as_str().unwrap(),
                case["calendar"].as_str().unwrap(),
                case["parent"].as_str().unwrap(),
            );
            for collection in [
                "calendarEventLinks",
                "eventOutcomes",
                "reminderRules",
                "reminderDeliveries",
            ] {
                let mut invalid: Value = serde_json::from_str(raw).unwrap();
                invalid[collection]
                    .as_array_mut()
                    .unwrap()
                    .last_mut()
                    .unwrap()["unknown"] = json!(true);
                sqlx::query("UPDATE study_state SET payload=?")
                    .bind(invalid.to_string())
                    .execute(&pool)
                    .await
                    .unwrap();
                assert!(
                    read(&pool, identity.0, identity.1, identity.2)
                        .await
                        .is_err(),
                    "{collection}"
                );
            }
            for invalid in [raw.replacen("{", "{\"version\":4,", 1), "{invalid".into()] {
                sqlx::query("UPDATE study_state SET payload=?")
                    .bind(invalid)
                    .execute(&pool)
                    .await
                    .unwrap();
                assert!(read(&pool, identity.0, identity.1, identity.2)
                    .await
                    .is_err());
            }
            let mut wrong_source: Value = serde_json::from_str(raw).unwrap();
            wrong_source["calendarEvents"]
                .as_array_mut()
                .unwrap()
                .last_mut()
                .unwrap()["sourceId"] = json!("source");
            sqlx::query("UPDATE study_state SET payload=?")
                .bind(wrong_source.to_string())
                .execute(&pool)
                .await
                .unwrap();
            assert_eq!(
                read(&pool, identity.0, identity.1, identity.2)
                    .await
                    .unwrap_err(),
                "WRITE_IDENTITY_INVALID"
            );
        });
    }
}
