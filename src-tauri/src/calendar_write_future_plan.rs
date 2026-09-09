//! Pure plan construction. No persistence, confirmation, or mutation authorization.
use super::*;

pub(super) fn prepare(
    base: &Value,
    remote: &future_read::RemoteEvidence,
    local: &future_local::LocalEvidence,
) -> Result<Value, String> {
    build(base, remote, local).map_err(|_| "WRITE_UNSUPPORTED".into())
}

fn build(
    base: &Value,
    remote: &future_read::RemoteEvidence,
    local: &future_local::LocalEvidence,
) -> Result<Value, String> {
    exact(
        base,
        &[
            "operationId",
            "connectionId",
            "calendarId",
            "eventId",
            "lockKeys",
            "sendUpdates",
            "intent",
        ],
    )?;
    for key in [
        "operationId",
        "connectionId",
        "calendarId",
        "eventId",
        "sendUpdates",
    ] {
        field(base, key)?;
    }
    let id = field(base, "operationId")?;
    let valid_id = id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        });
    if !valid_id
        || base["lockKeys"] != json!([])
        || !["all", "externalOnly", "none"].contains(&field(base, "sendUpdates")?)
    {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let intent = &base["intent"];
    exact(intent, &["kind", "parent", "originalStart", "fields"])?;
    exact(&intent["fields"], &["title"])?;
    exact(&intent["parent"], &["eventId", "etag"])?;
    let title = field(&intent["fields"], "title")?;
    let original = field(intent, "originalStart")?;
    let parent = &remote.parent;
    let pivot = &remote.pivot;
    exact(
        parent,
        &[
            "id",
            "etag",
            "summary",
            "start",
            "end",
            "recurrence",
            "extendedProperties",
            "eventType",
            "status",
            "created",
            "updated",
            "kind",
            "htmlLink",
            "iCalUID",
            "sequence",
        ],
    )?;
    exact(
        pivot,
        &[
            "id",
            "etag",
            "summary",
            "start",
            "end",
            "recurringEventId",
            "originalStartTime",
            "status",
            "created",
            "updated",
            "kind",
            "htmlLink",
            "iCalUID",
            "sequence",
        ],
    )?;
    for key in ["id", "etag"] {
        field(parent, key)?;
        field(pivot, key)?;
    }
    for value in [
        &parent["start"],
        &parent["end"],
        &pivot["start"],
        &pivot["end"],
        &pivot["originalStartTime"],
    ] {
        exact(value, &["date", "dateTime", "timeZone"])?;
    }
    if intent["kind"] != "recurring.future"
        || !local.attached_facts.is_empty()
        || local.workspace_hash.is_empty()
        || parent["id"] != intent["parent"]["eventId"]
        || parent["etag"] != intent["parent"]["etag"]
        || base["eventId"] != parent["id"]
        || pivot["recurringEventId"] != parent["id"]
        || pivot["id"] == parent["id"]
        || pivot["status"] == "cancelled"
        || parent["status"] == "cancelled"
        || parent.get("eventType").is_some_and(|v| v != "default")
        || pivot
            .get("summary")
            .is_some_and(|v| Some(v) != parent.get("summary"))
        || pivot["originalStartTime"]
            .get("date")
            .or_else(|| pivot["originalStartTime"].get("dateTime"))
            != Some(&json!(original))
        || local.event_id
            != write_local::projection::stable_id(
                field(base, "connectionId")?,
                field(base, "calendarId")?,
                Some(field(parent, "id")?),
            )
        || local.source_id
            != write_local::projection::stable_id(
                field(base, "connectionId")?,
                field(base, "calendarId")?,
                None,
            )
    {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let (index, times) = write_local::projection::future_occurrence(parent, pivot, original)
        .ok_or("WRITE_UNSUPPORTED")?;
    let rules = &parent["recurrence"];
    let parts: Vec<_> = rules[0]
        .as_str()
        .ok_or("WRITE_UNSUPPORTED")?
        .strip_prefix("RRULE:")
        .ok_or("WRITE_UNSUPPORTED")?
        .split(';')
        .collect();
    let cadence: Vec<_> = parts
        .iter()
        .copied()
        .filter(|part| !part.starts_with("COUNT=") && !part.starts_with("UNTIL="))
        .collect();
    let with_count = |count| json!([format!("RRULE:{};COUNT={count}", cadence.join(";"))]);
    let successor_rules = if let Some(count) = parts.iter().find_map(|p| p.strip_prefix("COUNT=")) {
        with_count(
            count
                .parse::<u64>()
                .map_err(|_| "WRITE_UNSUPPORTED")?
                .checked_sub(index)
                .filter(|n| *n > 0)
                .ok_or("WRITE_UNSUPPORTED")?,
        )
    } else {
        rules.clone()
    };
    let marker_hash = workspace_hash::fingerprint(base)?;
    let empty = json!({});
    let properties = parent.get("extendedProperties").unwrap_or(&empty);
    properties.as_object().ok_or("WRITE_UNSUPPORTED")?;
    if parent.get("extendedProperties").is_some() {
        exact(properties, &["private"])?;
        let prior = &properties["private"];
        exact(prior, &["meowOperationId", "meowOperationHash"])?;
        prior["meowOperationId"]
            .as_str()
            .ok_or("WRITE_UNSUPPORTED")?;
        let hash = prior["meowOperationHash"]
            .as_str()
            .ok_or("WRITE_UNSUPPORTED")?;
        if !hash.strip_prefix("sha256:").is_some_and(|v| {
            v.len() == 64
                && v.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) {
            return Err("WRITE_UNSUPPORTED".into());
        }
    }
    let mut private = properties
        .get("private")
        .unwrap_or(&empty)
        .as_object()
        .ok_or("WRITE_UNSUPPORTED")?
        .clone();
    private.insert("meowOperationId".into(), json!(id));
    private.insert("meowOperationHash".into(), json!(marker_hash));
    let marker = json!({"private":private});
    let child = format!("m{}", id.replace('-', ""));
    if [parent["id"].as_str(), pivot["id"].as_str()].contains(&Some(child.as_str())) {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let mut successor = json!({"id":child,"summary":title,"start":times["start"],"end":times["end"],"recurrence":successor_rules,"extendedProperties":marker});
    if let Some(status) = parent.get("status") {
        successor["status"] = status.clone();
    }
    let plan = json!({"version":1,"workspaceHash":local.workspace_hash,"originalParent":parent,"pivot":{"eventId":pivot["id"],"etag":pivot["etag"]},"originalStart":original,"exceptions":[],"markerHash":marker_hash,
        "parent":{"eventId":parent["id"],"etag":parent["etag"],"body":{"recurrence":with_count(index),"extendedProperties":marker}},
        "successor":{"eventId":child,"etag":null,"body":successor},
        "compensation":{"eventId":parent["id"],"etag":null,"body":{"recurrence":rules,"extendedProperties":marker}}});
    let mut preview = base.clone();
    preview["intent"]["plan"] = plan;
    let mut locks = vec![field(parent, "id")?, field(pivot, "id")?, &child];
    locks.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    preview["lockKeys"] = json!(locks);
    preview["hash"] = json!(workspace_hash::fingerprint(&preview)?);
    let state = json!({"parent":{"state":"pending"},"successor":{"state":"pending"},"compensation":{"state":"pending"}});
    write_outbox::future::validate(&preview, &state)?;
    Ok(json!({"preview":preview,"future":state}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_ts_future_plan_parity() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-plan.json"
        ))
        .unwrap();
        for case in cases.as_array().unwrap() {
            let snapshot = &case["snapshot"];
            let remote = future_read::RemoteEvidence {
                parent: snapshot["parent"].clone(),
                pivot: snapshot["pivot"].clone(),
            };
            let local = future_local::fixture_evidence(snapshot);
            let result = prepare(&case["base"], &remote, &local);
            if case["expected"].is_null() {
                assert_eq!(result.unwrap_err(), "WRITE_UNSUPPORTED", "{}", case["name"]);
            } else {
                assert_eq!(result.unwrap(), case["expected"], "{}", case["name"]);
            }
        }
    }
    #[test]
    fn future_plan_rejects_mismatched_local_identity_and_untrusted_base() {
        let cases: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-plan.json"
        ))
        .unwrap();
        let snapshot = &cases[0]["snapshot"];
        let remote = future_read::RemoteEvidence {
            parent: snapshot["parent"].clone(),
            pivot: snapshot["pivot"].clone(),
        };
        for key in ["event", "source"] {
            let mut local = future_local::fixture_evidence(snapshot);
            if key == "event" {
                local.event_id = "foreign".into();
            } else {
                local.source_id = "foreign".into();
            }
            assert_eq!(
                prepare(&cases[0]["base"], &remote, &local).unwrap_err(),
                "WRITE_UNSUPPORTED"
            );
        }
        let local = future_local::fixture_evidence(snapshot);
        for (key, value) in [
            ("operationId", json!("not-a-uuid")),
            ("hash", json!("caller-hash")),
            ("lockKeys", json!(["caller-lock"])),
            ("sendUpdates", json!("later")),
        ] {
            let mut base = cases[0]["base"].clone();
            base[key] = value;
            assert_eq!(
                prepare(&base, &remote, &local).unwrap_err(),
                "WRITE_UNSUPPORTED"
            );
        }
    }
}
