use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use serde_json::{json, Value};

/// Verify actual source/event facts, independently of the receipt's claimed success.
pub(super) fn verify(base: &Value, current: &Value, batch: &Value) -> bool {
    checked(base, current, batch).unwrap_or(false)
}

fn checked(base: &Value, current: &Value, batch: &Value) -> Option<bool> {
    if batch["plan"].is_object() {
        return recurring_checked(base, current, batch);
    }
    if base["version"] != 4
        || current["version"] != 4
        || batch["provider"] != "google"
        || batch["mode"] != "incremental"
    {
        return None;
    }
    let base_map = base.as_object()?;
    let current_map = current.as_object()?;
    let mutable = [
        "calendarSources",
        "calendarEvents",
        "commandReceipts",
        "updatedAt",
        "revision",
        "reminderDeliveries",
    ];
    if base_map
        .keys()
        .any(|key| !mutable.contains(&key.as_str()) && current.get(key) != base.get(key))
        || current_map.keys().any(|key| !base_map.contains_key(key))
    {
        return None;
    }
    if current["revision"].as_u64()? != base["revision"].as_u64()?.checked_add(1)? {
        return None;
    }
    let receipt = current["commandReceipts"].as_array()?.iter().find(|r| {
        r["commandType"] == "calendar_external.apply"
            && r["idempotencyKey"] == batch["batchId"]
            && r["result"]["data"]["operationId"] == batch["operationId"]
    })?;
    let context = receipt["createdAt"].as_str()?;
    let now = timestamp(context)?;
    let previous = timestamp(base["updatedAt"].as_str()?)?;
    let updated = if now > previous {
        context.to_owned()
    } else {
        iso_millis(previous.checked_add(1)?)?
    };
    if current["updatedAt"] != updated {
        return None;
    }
    let observed = iso(batch["observedAt"].as_str()?)?;
    let connection = batch["connectionId"].as_str()?;
    let calendar = batch["calendarId"].as_str()?;
    let source_id = stable_id(connection, calendar, None);
    if batch["sourceId"] != source_id {
        return None;
    }
    let access = batch["access"].as_str()?;
    if !["details", "freebusy", "none"].contains(&access) {
        return None;
    }
    let mut sources = base["calendarSources"].as_array()?.clone();
    let index = sources.iter().position(|s| s["id"] == source_id);
    let mut source = if let Some(index) = index {
        let mut source = sources[index].clone();
        if source["provider"] != "google" {
            return None;
        }
        source["revision"] = json!(source["revision"].as_u64()?.checked_add(1)?);
        source
    } else {
        json!({"id":source_id,"revision":1,"provider":"google","color":"#668575","group":null,"permission":"read","selected":true,"hidden":false,"createdAt":context})
    };
    source["title"] = json!(batch["title"].as_str()?);
    source["timezone"] = json!(batch["timezone"].as_str()?);
    source["updatedAt"] = json!(context);
    source["permission"] = json!("read");
    source["archivedAt"] = if access == "none" {
        json!(context)
    } else {
        Value::Null
    };
    if let Some(index) = index {
        sources[index] = source;
    } else {
        sources.push(source);
    }
    if current["calendarSources"] != Value::Array(sources) {
        return None;
    }
    let items = batch["items"].as_array()?;
    if items.len() > 1 || (access != "details" && !items.is_empty()) {
        return None;
    }
    let mut events = base["calendarEvents"].as_array()?.clone();
    if events.iter().any(|event| !event.is_object()) || !deliveries_valid(base, current) {
        return None;
    }
    let deleted_id = if let Some(raw) = items.first() {
        let id = stable_id(connection, calendar, Some(raw["id"].as_str()?));
        if raw["status"] == "cancelled" {
            Some(id)
        } else {
            let index = events.iter().position(|e| e["id"] == id);
            let old = index.map(|i| &events[i]);
            if old.is_some_and(|e| e["sourceId"] != source_id) {
                return None;
            }
            let mut event =
                normalize(raw, &id, &source_id, batch["timezone"].as_str()?, &observed)?;
            if let Some(old) = old {
                event["createdAt"] = old["createdAt"].clone();
                event["revision"] = json!(old["revision"].as_u64()?.checked_add(1)?);
            }
            // localeCompare determines TS array order; compare participant facts as a multiset.
            let actual = current["calendarEvents"]
                .as_array()?
                .iter()
                .find(|e| e["id"] == id)?;
            if !same_people(&event["attendees"], &actual["attendees"]) {
                return None;
            }
            event["attendees"] = actual["attendees"].clone();
            if let Some(index) = index {
                events[index] = event;
            } else {
                events.push(event);
            }
            None
        }
    } else {
        None
    };
    for event in &mut events {
        if event["sourceId"] != source_id
            || (access == "details" && deleted_id.as_ref().is_none_or(|id| event["id"] != *id))
        {
            continue;
        }
        if event["deletedAt"].is_null() {
            event["deletedAt"] = json!(context);
            event["updatedAt"] = json!(context);
            event["revision"] = json!(event["revision"].as_u64()?.checked_add(1)?);
        }
        if access != "details" {
            for key in ["notes", "location"] {
                event[key] = json!("");
            }
            event["title"] = json!("忙碌");
            for key in ["meetingUrl", "sourceUrl", "organizer"] {
                event[key] = Value::Null;
            }
            event["attendees"] = json!([]);
        }
    }
    Some(current["calendarEvents"] == Value::Array(events))
}

fn recurring_checked(base: &Value, current: &Value, batch: &Value) -> Option<bool> {
    if base["version"] != 4
        || current["version"] != 4
        || batch["provider"] != "google"
        || batch["mode"] != "incremental"
    {
        return None;
    }
    let plan = &batch["plan"];
    let kind = plan["kind"].as_str()?;
    if !["recurring.single", "recurring.series"].contains(&kind)
        || !plan["hash"].as_str()?.starts_with("sha256:")
    {
        return None;
    }
    let parent = plan["parentEventId"].as_str()?;
    if kind == "recurring.single"
        && (plan["instanceEventId"].as_str().is_none() || plan["originalStart"].as_str().is_none())
    {
        return None;
    }
    let receipt = current["commandReceipts"].as_array()?.iter().find(|r| {
        r["commandType"] == "calendar_external.apply"
            && r["idempotencyKey"] == batch["batchId"]
            && r["result"]["data"]["operationId"] == batch["operationId"]
    })?;
    if receipt["id"] != receipt["result"]["receiptId"]
        || receipt["result"]["data"]["applied"] != true
        || receipt["result"]["data"]["writeProjection"]
            != json!({"plan":plan,"expectedWorkspaceHash":batch["expectedWorkspaceHash"],"observedAt":batch["observedAt"]})
    {
        return None;
    }
    let base_map = base.as_object()?;
    let current_map = current.as_object()?;
    let mutable = [
        "calendarSources",
        "calendarEvents",
        "commandReceipts",
        "updatedAt",
        "revision",
        "reminderDeliveries",
    ];
    if base_map
        .keys()
        .any(|key| !mutable.contains(&key.as_str()) && current.get(key) != base.get(key))
        || current_map.keys().any(|key| !base_map.contains_key(key))
        || current["revision"].as_u64()? != base["revision"].as_u64()?.checked_add(1)?
        || !deliveries_valid(base, current)
    {
        return None;
    }
    let context = receipt["createdAt"].as_str()?;
    let previous = timestamp(base["updatedAt"].as_str()?)?;
    let now = timestamp(context)?;
    if current["updatedAt"]
        != if now > previous {
            Value::String(context.into())
        } else {
            Value::String(iso_millis(previous.checked_add(1)?)?)
        }
    {
        return None;
    }
    let connection = batch["connectionId"].as_str()?;
    let calendar = batch["calendarId"].as_str()?;
    let source_id = stable_id(connection, calendar, None);
    if batch["sourceId"] != source_id {
        return None;
    }
    let access = batch["access"].as_str()?;
    if !["details", "freebusy", "none"].contains(&access) {
        return None;
    }
    let mut sources = base["calendarSources"].as_array()?.clone();
    let source_index = sources.iter().position(|s| s["id"] == source_id);
    let mut source = source_index.map(|i| sources[i].clone()).unwrap_or_else(|| json!({"id":source_id,"revision":1,"provider":"google","color":"#668575","group":null,"permission":"read","selected":true,"hidden":false,"createdAt":context}));
    if source["provider"] != "google" {
        return None;
    }
    if source_index.is_some() {
        source["revision"] = json!(source["revision"].as_u64()?.checked_add(1)?);
    }
    source["title"] = json!(batch["title"].as_str()?);
    source["timezone"] = json!(batch["timezone"].as_str()?);
    source["updatedAt"] = json!(context);
    source["permission"] = json!("read");
    source["archivedAt"] = if access == "none" {
        json!(context)
    } else {
        Value::Null
    };
    if let Some(i) = source_index {
        sources[i] = source;
    } else {
        sources.push(source);
    }
    if current["calendarSources"] != Value::Array(sources) {
        return None;
    }
    let mut events = base["calendarEvents"].as_array()?.clone();
    let parent_id = stable_id(connection, calendar, Some(parent));
    if access == "details" {
        let items = batch["items"].as_array()?;
        let parent_raw = items.iter().find(|item| item["id"] == parent)?;
        if parent_raw["recurrence"]
            .as_array()
            .is_none_or(|rules| rules.len() != 1)
        {
            return None;
        }
        let mut plain = parent_raw.clone();
        plain.as_object_mut()?.remove("recurrence");
        let mut projected = normalize(
            &plain,
            &parent_id,
            &source_id,
            batch["timezone"].as_str()?,
            batch["observedAt"].as_str()?,
        )?;
        projected["recurrence"] =
            recurrence(parent_raw["recurrence"].as_array()?.first()?.as_str()?)?;
        let index = events.iter().position(|event| event["id"] == parent_id);
        if let Some(i) = index {
            projected["createdAt"] = events[i]["createdAt"].clone();
            projected["revision"] = json!(events[i]["revision"].as_u64()?.checked_add(1)?);
            projected["recurrence"]["exceptions"] = events[i]["recurrence"]["exceptions"].clone();
        }
        if kind == "recurring.single" {
            if items.len() != 2 {
                return None;
            }
            let instance = items
                .iter()
                .find(|item| item["id"] == plan["instanceEventId"])?;
            if instance["recurringEventId"] != parent
                || instance["originalStartTime"]["date"]
                    .as_str()
                    .or_else(|| instance["originalStartTime"]["dateTime"].as_str())
                    != plan["originalStart"].as_str()
            {
                return None;
            }
            let exception = if instance["status"] == "cancelled" {
                Value::Null
            } else {
                let mut plain_instance = instance.clone();
                plain_instance.as_object_mut()?.remove("recurringEventId");
                normalize(
                    &plain_instance,
                    "ignored",
                    &source_id,
                    batch["timezone"].as_str()?,
                    batch["observedAt"].as_str()?,
                )?["time"]
                    .clone()
            };
            let mut exceptions = projected["recurrence"]["exceptions"].as_array()?.clone();
            exceptions.retain(|e| e["originalStart"] != plan["originalStart"]);
            exceptions.push(json!({"originalStart":plan["originalStart"],"time":exception}));
            projected["recurrence"]["exceptions"] = json!(exceptions);
        } else if items.len() != 1 {
            return None;
        }
        if let Some(i) = index {
            events[i] = projected;
        } else {
            events.push(projected);
        }
    } else if !batch["items"].as_array()?.is_empty() {
        return None;
    }
    for event in &mut events {
        if event["sourceId"] == source_id && (access != "details" || event["id"] != parent_id) {
            if event["deletedAt"].is_null() {
                event["deletedAt"] = json!(context);
                event["updatedAt"] = json!(context);
                event["revision"] = json!(event["revision"].as_u64()?.checked_add(1)?);
            }
            if access != "details" {
                event["title"] = json!("忙碌");
                event["notes"] = json!("");
                event["location"] = json!("");
                event["meetingUrl"] = Value::Null;
                event["sourceUrl"] = Value::Null;
                event["organizer"] = Value::Null;
                event["attendees"] = json!([]);
            }
        }
    }
    Some(current["calendarEvents"] == Value::Array(events))
}
fn recurrence(rule: &str) -> Option<Value> {
    let fields = rule
        .strip_prefix("RRULE:")?
        .split(';')
        .map(|part| part.split_once('='))
        .collect::<Option<std::collections::HashMap<_, _>>>()?;
    let kind = *fields.get("FREQ")?;
    let cadence = match kind {
        "DAILY" => {
            json!({"kind":"daily","interval":fields.get("INTERVAL").and_then(|v| v.parse::<u64>().ok()).unwrap_or(1)})
        }
        _ => return None,
    };
    let end = if let Some(count) = fields.get("COUNT") {
        json!({"kind":"after","count":count.parse::<u64>().ok()?})
    } else {
        json!({"kind":"never"})
    };
    Some(json!({"cadence":cadence,"end":end,"exceptions":[]}))
}

fn stable_id(connection: &str, calendar: &str, remote: Option<&str>) -> String {
    let tuple = if let Some(id) = remote {
        json!(["google", connection, calendar, id])
    } else {
        json!(["google", connection, calendar])
    };
    let encoded: String = tuple
        .to_string()
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("calendar-provider:{encoded}")
}
fn timestamp(value: &str) -> Option<i64> {
    Some(DateTime::parse_from_rfc3339(value).ok()?.timestamp_millis())
}
fn iso_millis(value: i64) -> Option<String> {
    Some(
        DateTime::<Utc>::from_timestamp_millis(value)?.to_rfc3339_opts(SecondsFormat::Millis, true),
    )
}
fn iso(value: &str) -> Option<String> {
    iso_millis(timestamp(value)?)
}
fn person(raw: &Value) -> Option<Value> {
    let email = raw["email"].as_str()?;
    let mut parts = email.split('@');
    if parts.next()?.is_empty()
        || parts.next()?.is_empty()
        || parts.next().is_some()
        || email.chars().any(|c| c.is_whitespace() || c == '\u{feff}')
        || email.encode_utf16().count() > 100_000
    {
        return None;
    }
    Some(json!({"name":raw["displayName"].as_str().unwrap_or(""),"email":email}))
}
fn same_people(a: &Value, b: &Value) -> bool {
    let Some(a) = a.as_array() else {
        return false;
    };
    let Some(b) = b.as_array() else {
        return false;
    };
    let mut a: Vec<_> = a.iter().map(Value::to_string).collect();
    let mut b: Vec<_> = b.iter().map(Value::to_string).collect();
    a.sort();
    b.sort();
    a == b
}
fn normalize(raw: &Value, id: &str, source: &str, timezone: &str, observed: &str) -> Option<Value> {
    if raw["start"]
        .get("date")
        .is_some_and(|value| !value.is_string())
        || raw["start"]
            .get("timeZone")
            .is_some_and(|value| !value.is_null() && !value.is_string())
    {
        return None;
    }
    if raw.get("recurrence").is_some()
        || raw.get("recurringEventId").is_some()
        || raw["attendeesOmitted"] == true
    {
        return None;
    }
    if raw
        .get("attendeesOmitted")
        .is_some_and(|value| !value.is_boolean())
        || raw["summary"]
            .as_str()
            .is_some_and(|value| !value.is_empty() && value.trim().is_empty())
    {
        return None;
    }
    let time = if let Some(start) = raw["start"]["date"].as_str() {
        let end = raw["end"]["date"].as_str()?;
        if NaiveDate::parse_from_str(start, "%Y-%m-%d").ok()?
            >= NaiveDate::parse_from_str(end, "%Y-%m-%d").ok()?
        {
            return None;
        }
        json!({"kind":"all-day","startOn":start,"endOnExclusive":end})
    } else {
        let start = iso(raw["start"]["dateTime"].as_str()?)?;
        let end = iso(raw["end"]["dateTime"].as_str()?)?;
        if start >= end {
            return None;
        }
        json!({"kind":"fixed","startAt":start,"endAt":end,"timezone":raw["start"]["timeZone"].as_str().unwrap_or(timezone)})
    };
    let organizer = if raw.get("organizer").is_some() {
        person(&raw["organizer"])?
    } else {
        Value::Null
    };
    let mut attendees = Vec::new();
    let mut emails = std::collections::HashSet::new();
    if let Some(entries) = raw.get("attendees") {
        for raw in entries.as_array()? {
            if raw["resource"] == true || raw.get("additionalGuests").is_some_and(|v| v != 0) {
                return None;
            }
            if ["resource", "optional"]
                .iter()
                .any(|key| raw.get(key).is_some_and(|value| !value.is_boolean()))
                || raw
                    .get("responseStatus")
                    .is_some_and(|value| !value.is_string())
            {
                return None;
            }
            let mut attendee = person(raw)?;
            if !emails.insert(attendee["email"].as_str()?.to_lowercase()) {
                return None;
            }
            attendee["role"] = json!(if raw["optional"] == true {
                "optional"
            } else {
                "required"
            });
            let response = raw["responseStatus"].as_str().unwrap_or("needsAction");
            if !["needsAction", "accepted", "declined", "tentative"].contains(&response) {
                return None;
            }
            attendee["response"] = json!(if response == "needsAction" {
                "unknown"
            } else {
                response
            });
            attendees.push(attendee);
        }
    }
    let link = raw["htmlLink"]
        .as_str()
        .and_then(|s| reqwest::Url::parse(s).ok())
        .filter(|u| {
            u.scheme() == "https"
                && u.username().is_empty()
                && u.password().is_none()
                && (u.host_str() == Some("calendar.google.com")
                    || u.host_str() == Some("www.google.com")
                        && (u.path() == "/calendar" || u.path().starts_with("/calendar/")))
        })
        .map(|u| u.to_string());
    Some(
        json!({"id":id,"sourceId":source,"revision":1,"title":raw["summary"].as_str().filter(|s| !s.is_empty()).unwrap_or("日程"),"notes":raw["description"].as_str().unwrap_or(""),"location":raw["location"].as_str().unwrap_or(""),"meetingUrl":null,"sourceUrl":link,"organizer":organizer,"attendees":attendees,"availability":if raw["transparency"] == "transparent" {"free"} else {"busy"},"status":if raw["status"] == "tentative" {"tentative"} else {"confirmed"},"time":time,"recurrence":null,"createdAt":if let Some(value)=raw.get("created") {iso(value.as_str()?)?} else {observed.into()},"updatedAt":if let Some(value)=raw.get("updated") {iso(value.as_str()?)?} else {observed.into()},"deletedAt":null}),
    )
}

// External apply reconciles existing pending deliveries without creating deliveries.
// Protect the audit payload; only the resolver's status/revision transitions may differ.
fn deliveries_valid(base: &Value, current: &Value) -> bool {
    let (Some(before), Some(after)) = (
        base["reminderDeliveries"].as_array(),
        current["reminderDeliveries"].as_array(),
    ) else {
        return false;
    };
    before.len() == after.len()
        && before.iter().zip(after).all(|(old, new)| {
            if old == new {
                return true;
            }
            if !old.is_object() || !new.is_object() {
                return false;
            }
            let status = old["status"].as_str().unwrap_or("");
            let allowed = match status {
                "pending" | "snoozed" => new["status"] == "cancelled",
                "cancelled" => {
                    new["status"]
                        == if old["snoozedUntil"].is_null() {
                            "pending"
                        } else {
                            "snoozed"
                        }
                }
                _ => false,
            };
            let mut expected = old.clone();
            let Some(revision) = old["revision"].as_u64().unwrap_or(1).checked_add(1) else {
                return false;
            };
            expected["revision"] = json!(revision);
            expected["status"] = new["status"].clone();
            allowed && expected == *new
        })
}

#[cfg(test)]
pub(super) fn fixtures() -> Vec<Value> {
    serde_json::from_str::<Value>(include_str!(
        "../../tests/fixtures/calendar-write-projection.json"
    ))
    .unwrap()["cases"]
        .as_array()
        .unwrap()
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ts_generated_recurrence_projection_matches_and_rejects_tampering() {
        let cases: Vec<Value> = serde_json::from_str::<Value>(include_str!(
            "../../tests/fixtures/calendar-recurrence-projection.json"
        ))
        .unwrap()["cases"]
            .as_array()
            .unwrap()
            .clone();
        for case in &cases {
            assert!(
                verify(&case["base"], &case["current"], &case["batch"]),
                "{}",
                case["name"]
            );
        }
        let case = &cases[1];
        for (path, value) in [
            ("plan.hash", json!("sha256:forged")),
            ("plan.originalStart", json!("2026-09-11")),
            ("items.1.originalStartTime.date", json!("2026-09-11")),
        ] {
            let mut batch = case["batch"].clone();
            let parts: Vec<_> = path.split('.').collect();
            if parts[0] == "items" {
                batch[parts[0]][parts[1].parse::<usize>().unwrap()][parts[2]][parts[3]] = value;
            } else {
                batch[parts[0]][parts[1]] = value;
            }
            assert!(!verify(&case["base"], &case["current"], &batch), "{path}");
        }
    }
    #[test]
    fn malformed_provider_participants_do_not_become_acknowledgeable_facts() {
        let case = &fixtures()[0];
        for (field, value) in [
            ("resource", json!("false")),
            ("optional", json!(1)),
            ("responseStatus", json!(null)),
            ("email", json!("a@@example.invalid")),
        ] {
            let mut raw = case["batch"]["items"][0].clone();
            raw["attendees"][0][field] = value;
            assert!(
                normalize(&raw, "event", "source", "UTC", "2026-09-09T00:00:00.000Z").is_none(),
                "{field}"
            );
        }
        let mut raw = case["batch"]["items"][0].clone();
        raw["attendeesOmitted"] = json!("false");
        assert!(normalize(&raw, "event", "source", "UTC", "2026-09-09T00:00:00.000Z").is_none());
    }
    #[test]
    fn actual_ts_service_projection_matches_create_update_delete_and_permission_downgrade() {
        for case in fixtures() {
            assert!(
                verify(&case["base"], &case["current"], &case["batch"]),
                "{}",
                case["name"]
            );
        }
    }
    #[test]
    fn receipt_cannot_authorize_changed_remote_facts_or_unrelated_workspace_data() {
        let case = &fixtures()[1];
        let event_index = case["current"]["calendarEvents"]
            .as_array()
            .unwrap()
            .iter()
            .position(|e| e["sourceId"] == case["batch"]["sourceId"])
            .unwrap();
        for (field, value) in [
            ("title", json!("forged")),
            ("sourceUrl", json!("https://attacker.invalid")),
            ("organizer", Value::Null),
            ("attendees", json!([])),
            ("createdAt", json!("2020-01-01T00:00:00.000Z")),
            (
                "time",
                json!({"kind":"all-day","startOn":"2026-09-09","endOnExclusive":"2026-09-10"}),
            ),
        ] {
            let mut current = case["current"].clone();
            current["calendarEvents"][event_index][field] = value;
            assert!(!verify(&case["base"], &current, &case["batch"]), "{field}");
        }
        for key in ["tasks", "calendarEventLinks", "eventOutcomes"] {
            let mut current = case["current"].clone();
            current[key] = json!([{"forged":true}]);
            assert!(!verify(&case["base"], &current, &case["batch"]), "{key}");
        }
        let mut current = case["current"].clone();
        current["calendarSources"]
            .as_array_mut()
            .unwrap()
            .last_mut()
            .unwrap()["hidden"] = json!(false);
        assert!(!verify(&case["base"], &current, &case["batch"]));
        let downgrade = &fixtures()[4];
        let mut current = downgrade["current"].clone();
        current["calendarEvents"][event_index]["notes"] = json!("retained private data");
        assert!(!verify(&downgrade["base"], &current, &downgrade["batch"]));
    }
    #[test]
    fn reminder_reconciliation_preserves_delivery_audit_and_other_fields() {
        let old = json!({"reminderDeliveries":[{"id":"delivery","revision":1,"status":"pending","snoozedUntil":null,"scheduledFor":"2026-09-09T00:00:00Z"}]});
        let mut new = old.clone();
        new["reminderDeliveries"][0]["status"] = json!("cancelled");
        new["reminderDeliveries"][0]["revision"] = json!(2);
        assert!(deliveries_valid(&old, &new));
        new["reminderDeliveries"][0]["scheduledFor"] = json!("2020-01-01T00:00:00Z");
        assert!(!deliveries_valid(&old, &new));
        let mut sent = old.clone();
        sent["reminderDeliveries"][0]["status"] = json!("delivered");
        assert!(!deliveries_valid(&sent, &new));
    }
}
