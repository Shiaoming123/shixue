use chrono::{DateTime, Datelike, Duration, FixedOffset, NaiveDate, SecondsFormat, Utc};
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

pub(in super::super) fn future_batch(batch: &Value, base: &Value) -> bool {
    (|| -> Option<()> {
        let plan = &batch["plan"];
        let hash = |v: &Value| {
            v.as_str().is_some_and(|s| {
                s.len() == 71
                    && s.starts_with("sha256:")
                    && s[7..]
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            })
        };
        let operation = batch["operationId"].as_str()?.trim();
        let parent = plan["parentEventId"].as_str()?;
        let pivot = plan["pivotEventId"].as_str()?;
        let child = plan["successorEventId"].as_str()?;
        if operation.is_empty()
            || parent.is_empty()
            || pivot.is_empty()
            || parent == pivot
            || parent == child
            || pivot == child
            || child != format!("m{}", operation.replace('-', ""))
            || batch["access"] != "details"
            || plan["kind"] != "recurring.future"
            || !hash(&plan["hash"])
            || !hash(&plan["markerHash"])
            || batch["expectedWorkspaceHash"] != super::workspace_hash::fingerprint(base).ok()?
            || plan.as_object()?.len() != 8
            || plan["steps"].as_object()?.len() != 2
            || batch["items"].as_array()?.len() != 2
        {
            return None;
        }
        for (i, name, id) in [(0, "parent", parent), (1, "successor", child)] {
            let step = &plan["steps"][name];
            let proof = &step["proof"];
            if step.as_object()?.len() != 2
                || step["state"] != "proved"
                || batch["items"][i] != *proof
                || proof["id"] != id
                || proof["etag"].as_str()?.trim().is_empty()
                || proof["etag"].as_str()?.contains(['\r', '\n'])
                || proof.get("recurringEventId").is_some()
                || proof["status"] == "cancelled"
                || proof["extendedProperties"]["private"]["meowOperationId"] != batch["operationId"]
                || proof["extendedProperties"]["private"]["meowOperationHash"] != plan["markerHash"]
            {
                return None;
            }
        }
        let start = &plan["steps"]["successor"]["proof"]["start"];
        let original = start["date"]
            .as_str()
            .map(str::to_owned)
            .or_else(|| iso(start["dateTime"].as_str()?))?;
        if plan["originalStart"] != original {
            return None;
        }
        Some(())
    })()
    .is_some()
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
    if !["recurring.single", "recurring.series", "recurring.future"].contains(&kind)
        || !plan["hash"].as_str()?.starts_with("sha256:")
    {
        return None;
    }
    if kind == "recurring.future" && !future_batch(batch, base) {
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
    if kind == "recurring.future" {
        let receipts = current["commandReceipts"].as_array()?;
        if receipt["id"].as_str()?.trim().is_empty()
            || receipt["workspaceRevision"] != current["revision"]
            || receipt["result"]["workspaceRevision"] != current["revision"]
            || base["reminderDeliveries"] != current["reminderDeliveries"]
            || !super::unexpired(receipt)
            || receipts
                .iter()
                .filter(|r| r["idempotencyKey"] == batch["batchId"] || r["id"] == receipt["id"])
                .count()
                != 1
            || [
                "operationId",
                "batchId",
                "provider",
                "connectionId",
                "calendarId",
                "sourceId",
                "mode",
            ]
            .iter()
            .any(|key| receipt["result"]["data"][*key] != batch[*key])
            || receipts
                .iter()
                .filter(|r| *r != receipt)
                .cloned()
                .collect::<Vec<_>>()
                != *base["commandReceipts"].as_array()?
        {
            return None;
        }
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
    if access == "details" {
        let items = batch["items"].as_array()?;
        let ids = if kind == "recurring.future" {
            vec![parent, plan["successorEventId"].as_str()?]
        } else {
            vec![parent]
        };
        for remote in ids {
            let parent_id = stable_id(connection, calendar, Some(remote));
            let parent_raw = items.iter().find(|item| item["id"] == remote)?;
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
            projected["recurrence"] = recurrence(
                parent_raw["recurrence"].as_array()?.first()?.as_str()?,
                &projected["time"],
            )?;
            let index = events.iter().position(|event| event["id"] == parent_id);
            if let Some(i) = index {
                projected["createdAt"] = events[i]["createdAt"].clone();
                projected["revision"] = json!(events[i]["revision"].as_u64()?.checked_add(1)?);
                if kind != "recurring.future" {
                    projected["recurrence"]["exceptions"] =
                        events[i]["recurrence"]["exceptions"].clone();
                }
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
                if !occurs(
                    &projected["recurrence"],
                    &projected["time"],
                    plan["originalStart"].as_str()?,
                ) {
                    return None;
                }
                let exception = if instance["status"] == "cancelled" {
                    Value::Null
                } else {
                    let mut plain_instance = instance.clone();
                    plain_instance.as_object_mut()?.remove("recurringEventId");
                    let normalized = normalize(
                        &plain_instance,
                        "ignored",
                        &source_id,
                        batch["timezone"].as_str()?,
                        batch["observedAt"].as_str()?,
                    )?;
                    for key in [
                        "title",
                        "notes",
                        "location",
                        "status",
                        "availability",
                        "organizer",
                        "attendees",
                    ] {
                        if normalized[key] != projected[key] {
                            return None;
                        }
                    }
                    normalized["time"].clone()
                };
                let mut exceptions = projected["recurrence"]["exceptions"].as_array()?.clone();
                exceptions.retain(|e| e["originalStart"] != plan["originalStart"]);
                exceptions.push(json!({"originalStart":plan["originalStart"],"time":exception}));
                projected["recurrence"]["exceptions"] = json!(exceptions);
            } else if kind != "recurring.future" && items.len() != 1 {
                return None;
            }
            if let Some(i) = index {
                events[i] = projected;
            } else {
                events.push(projected);
            }
        }
    } else if !batch["items"].as_array()?.is_empty() {
        return None;
    }
    for event in &mut events {
        if event["sourceId"] == source_id && access != "details" {
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
fn recurrence(rule: &str, time: &Value) -> Option<Value> {
    let fields = rule
        .strip_prefix("RRULE:")?
        .split(';')
        .map(|part| part.split_once('='))
        .try_fold(std::collections::HashMap::new(), |mut map, part| {
            let (key, value) = part?;
            if map.insert(key, value).is_some() {
                None
            } else {
                Some(map)
            }
        })?;
    if fields.keys().any(|key| {
        ![
            "FREQ",
            "INTERVAL",
            "COUNT",
            "UNTIL",
            "BYDAY",
            "BYMONTHDAY",
            "BYMONTH",
            "WKST",
        ]
        .contains(key)
    }) || fields.contains_key("COUNT") && fields.contains_key("UNTIL")
    {
        return None;
    }
    let number = |value: &str| {
        value
            .parse::<u64>()
            .ok()
            .filter(|n| *n > 0 && *n <= 10_000)
            .filter(|_| value.bytes().all(|c| c.is_ascii_digit()))
    };
    let interval = match fields.get("INTERVAL") {
        Some(value) => number(value)?,
        None => 1,
    };
    let anchor = wall(
        time,
        time["startOn"]
            .as_str()
            .or_else(|| time["startAt"].as_str())?,
    )?
    .0;
    let date = anchor;
    let weekday = date.weekday().num_days_from_sunday();
    let kind = *fields.get("FREQ")?;
    let cadence = match kind {
        "DAILY"
            if !fields.contains_key("BYDAY")
                && !fields.contains_key("BYMONTH")
                && !fields.contains_key("BYMONTHDAY")
                && !fields.contains_key("WKST") =>
        {
            json!({"kind":"daily","interval":interval})
        }
        "WEEKLY" if !fields.contains_key("BYMONTH") && !fields.contains_key("BYMONTHDAY") => {
            let names = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
            let mut days: Vec<u32> = fields
                .get("BYDAY")
                .map(|v| {
                    v.split(',')
                        .map(|name| names.iter().position(|n| n == &name).map(|n| n as u32))
                        .collect::<Option<Vec<_>>>()
                })
                .unwrap_or_else(|| Some(vec![weekday]))?;
            days.sort();
            if days.windows(2).any(|w| w[0] == w[1])
                || !days.contains(&weekday)
                || fields.get("WKST").is_some_and(|v| !names.contains(v))
                || (interval != 1 && (days.len() != 1 || days[0] != weekday))
            {
                return None;
            }
            json!({"kind":"weekly","interval":interval,"weekdays":days})
        }
        "MONTHLY"
            if !fields.contains_key("BYDAY")
                && !fields.contains_key("BYMONTH")
                && !fields.contains_key("WKST")
                && date.day() <= 28
                && fields
                    .get("BYMONTHDAY")
                    .is_none_or(|v| number(v) == Some(date.day() as u64)) =>
        {
            json!({"kind":"monthly","interval":interval,"dayOfMonth":date.day()})
        }
        "YEARLY"
            if !fields.contains_key("BYDAY")
                && !fields.contains_key("WKST")
                && !(date.month() == 2 && date.day() == 29)
                && fields
                    .get("BYMONTHDAY")
                    .is_none_or(|v| number(v) == Some(date.day() as u64))
                && fields
                    .get("BYMONTH")
                    .is_none_or(|v| number(v) == Some(date.month() as u64)) =>
        {
            json!({"kind":"yearly","interval":interval,"month":date.month(),"dayOfMonth":date.day()})
        }
        _ => return None,
    };
    let end = if let Some(count) = fields.get("COUNT") {
        json!({"kind":"after","count":number(count)?})
    } else if let Some(until) = fields.get("UNTIL") {
        let (mut date, until_time) = if time["kind"] == "all-day" {
            (NaiveDate::parse_from_str(until, "%Y%m%d").ok()?, None)
        } else {
            if until.len() != 16
                || !until.is_ascii()
                || until.as_bytes()[8] != b'T'
                || until.as_bytes()[15] != b'Z'
                || [0..8, 9..15]
                    .into_iter()
                    .flatten()
                    .any(|i| !until.as_bytes()[i].is_ascii_digit())
            {
                return None;
            }
            let instant = DateTime::parse_from_rfc3339(&format!(
                "{}-{}-{}T{}:{}:{}Z",
                &until[0..4],
                &until[4..6],
                &until[6..8],
                &until[9..11],
                &until[11..13],
                &until[13..15]
            ))
            .ok()?;
            let (date, clock) = wall(time, &instant.to_rfc3339())?;
            (date, clock)
        };
        let anchor_clock = if time["kind"] == "all-day" {
            None
        } else {
            wall(time, time["startAt"].as_str()?)?.1
        };
        if until_time
            .zip(anchor_clock)
            .is_some_and(|(clock, anchor_clock)| clock < anchor_clock)
        {
            date -= Duration::days(1);
        }
        if date < anchor {
            return None;
        }
        json!({"kind":"on","date":date.format("%Y-%m-%d").to_string()})
    } else {
        json!({"kind":"never"})
    };
    Some(json!({"cadence":cadence,"end":end,"exceptions":[]}))
}
/// Reuse the projection's bounded rule/time semantics for the pure future plan.
pub(in super::super) fn future_occurrence(
    parent: &Value,
    pivot: &Value,
    original: &str,
) -> Option<(u64, Value)> {
    let mut plain = parent.clone();
    plain.as_object_mut()?.remove("recurrence");
    let event = normalize(
        &plain,
        "parent",
        "source",
        "UTC",
        "2026-01-01T00:00:00.000Z",
    )?;
    let mut plain = pivot.clone();
    plain.as_object_mut()?.remove("recurringEventId");
    plain.as_object_mut()?.remove("originalStartTime");
    let instance = normalize(&plain, "pivot", "source", "UTC", "2026-01-01T00:00:00.000Z")?;
    if instance["status"] != event["status"] {
        return None;
    }
    let time = &event["time"];
    if time["kind"] == "fixed"
        && (!super::super::workspace_parse::supported_timezone(time["timezone"].as_str()?)
            || iso(original)? != original)
    {
        return None;
    }
    let rules = parent["recurrence"].as_array()?;
    if rules.len() != 1 {
        return None;
    }
    let recurrence = recurrence(rules[0].as_str()?, time)?;
    for part in rules[0].as_str()?.strip_prefix("RRULE:")?.split(';') {
        let (key, value) = part.split_once('=')?;
        if ["INTERVAL", "COUNT", "BYMONTH", "BYMONTHDAY"].contains(&key) && value.starts_with('0') {
            return None;
        }
        if key == "UNTIL"
            && time["kind"] == "all-day"
            && (value.len() != 8 || !value.bytes().all(|b| b.is_ascii_digit()))
        {
            return None;
        }
    }
    let anchor = time["startOn"]
        .as_str()
        .or_else(|| time["startAt"].as_str())?;
    let start = wall(time, anchor)?.0;
    let target = wall(time, original)?.0;
    if time["timezone"] == "Asia/Shanghai" && start < NaiveDate::from_ymd_opt(1992, 1, 1)? {
        return None;
    }
    if time["kind"] == "all-day" {
        for value in [anchor, original, time["endOnExclusive"].as_str()?] {
            let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
            if !(100..=9999).contains(&date.year()) || date.format("%Y-%m-%d").to_string() != value
            {
                return None;
            }
        }
    }
    let days = (target - start).num_days();
    // ponytail: bounded day scan; larger spans need an independently proved ordinal algorithm.
    if !(1..=9996).contains(&days)
        || start.year() < 100
        || target.year() > 9999
        || !occurs(&recurrence, time, original)
    {
        return None;
    }
    let index = (0..days)
        .filter(|d| cadence_occurrence(&recurrence["cadence"], start, start + Duration::days(*d)))
        .count() as u64;
    if index == 0 {
        return None;
    }
    let times = if time["kind"] == "all-day" {
        let end = NaiveDate::parse_from_str(time["endOnExclusive"].as_str()?, "%Y-%m-%d").ok()?;
        if target.checked_add_signed(end - start)?.year() > 9999 {
            return None;
        }
        json!({"start":{"date":target.format("%Y-%m-%d").to_string()},"end":{"date":target.checked_add_signed(end-start)?.format("%Y-%m-%d").to_string()}})
    } else {
        let end = timestamp(time["endAt"].as_str()?)?;
        let original_ms = timestamp(original)?;
        let target_end =
            iso_millis(original_ms.checked_add(end.checked_sub(timestamp(anchor)?)?)?)?;
        if DateTime::parse_from_rfc3339(&target_end).ok()?.year() > 9999 {
            return None;
        }
        json!({"start":{"dateTime":iso(original)?,"timeZone":time["timezone"]},"end":{"dateTime":target_end,"timeZone":time["timezone"]}})
    };
    if pivot["start"] != times["start"] || pivot["end"] != times["end"] {
        return None;
    }
    Some((index, times))
}
fn occurs(recurrence: &Value, time: &Value, original: &str) -> bool {
    let Some((start, clock)) = (if time["kind"] == "all-day" {
        time["startOn"]
            .as_str()
            .and_then(|v| NaiveDate::parse_from_str(v, "%Y-%m-%d").ok())
            .map(|v| (v, None))
    } else {
        time["startAt"].as_str().and_then(|v| wall(time, v))
    }) else {
        return false;
    };
    let Some((target, target_clock)) = (if time["kind"] == "all-day" {
        NaiveDate::parse_from_str(original, "%Y-%m-%d")
            .ok()
            .map(|v| (v, None))
    } else {
        wall(time, original)
    }) else {
        return false;
    };
    if clock != target_clock {
        return false;
    }
    if target < start
        || recurrence["end"]["kind"] == "on"
            && recurrence["end"]["date"]
                .as_str()
                .is_none_or(|date| target.format("%Y-%m-%d").to_string().as_str() > date)
    {
        return false;
    }
    let days = (target - start).num_days();
    let valid = match recurrence["cadence"]["kind"].as_str() {
        Some("daily") => days % recurrence["cadence"]["interval"].as_i64().unwrap_or(0) == 0,
        Some("weekly") => {
            days / 7 % recurrence["cadence"]["interval"].as_i64().unwrap_or(0) == 0
                && recurrence["cadence"]["weekdays"]
                    .as_array()
                    .is_some_and(|days| {
                        days.iter().any(|day| {
                            day.as_u64() == Some(target.weekday().num_days_from_sunday() as u64)
                        })
                    })
        }
        Some("monthly") => {
            target.day() == start.day()
                && ((target.year() - start.year()) * 12 + target.month() as i32
                    - start.month() as i32) as i64
                    % recurrence["cadence"]["interval"].as_i64().unwrap_or(0)
                    == 0
        }
        Some("yearly") => {
            target.month() == start.month()
                && target.day() == start.day()
                && (target.year() - start.year()) as i64
                    % recurrence["cadence"]["interval"].as_i64().unwrap_or(0)
                    == 0
        }
        _ => false,
    };
    if !valid {
        return false;
    }
    let ordinal = (0..=days)
        .filter(|offset| {
            cadence_occurrence(
                &recurrence["cadence"],
                start,
                start + Duration::days(*offset),
            )
        })
        .count() as u64;
    recurrence["end"]["kind"] != "after"
        || ordinal <= recurrence["end"]["count"].as_u64().unwrap_or(0)
}
fn cadence_occurrence(cadence: &Value, start: NaiveDate, target: NaiveDate) -> bool {
    let interval = cadence["interval"].as_i64().unwrap_or(0);
    if interval <= 0 {
        return false;
    }
    let days = (target - start).num_days();
    match cadence["kind"].as_str() {
        Some("daily") => days % interval == 0,
        Some("weekly") => {
            days / 7 % interval == 0
                && cadence["weekdays"].as_array().is_some_and(|days| {
                    days.iter().any(|day| {
                        day.as_u64() == Some(target.weekday().num_days_from_sunday() as u64)
                    })
                })
        }
        Some("monthly") => {
            target.day() == start.day()
                && ((target.year() - start.year()) * 12 + target.month() as i32
                    - start.month() as i32) as i64
                    % interval
                    == 0
        }
        Some("yearly") => {
            target.month() == start.month()
                && target.day() == start.day()
                && (target.year() - start.year()) as i64 % interval == 0
        }
        _ => false,
    }
}
pub(crate) fn wall(time: &Value, value: &str) -> Option<(NaiveDate, Option<chrono::NaiveTime>)> {
    if time["kind"] == "all-day" {
        return Some((NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?, None));
    }
    let offset = match time["timezone"].as_str()? {
        "Asia/Shanghai" => FixedOffset::east_opt(8 * 3600)?,
        "UTC" | "Etc/UTC" | "Etc/GMT" => FixedOffset::east_opt(0)?,
        zone if zone.starts_with("Etc/GMT+") || zone.starts_with("Etc/GMT-") => {
            let hours = zone[8..]
                .parse::<i32>()
                .ok()
                .filter(|hours| (0..=14).contains(hours))?;
            FixedOffset::east_opt(if zone.as_bytes()[7] == b'+' {
                -hours * 3600
            } else {
                hours * 3600
            })?
        }
        _ => return None,
    };
    let local = DateTime::parse_from_rfc3339(value)
        .ok()?
        .with_timezone(&offset);
    Some((local.date_naive(), Some(local.time())))
}

pub(in super::super) fn stable_id(
    connection: &str,
    calendar: &str,
    remote: Option<&str>,
) -> String {
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
pub(in super::super) fn future_fixture() -> Value {
    serde_json::from_str::<Value>(include_str!(
        "../../tests/fixtures/calendar-future-projection.json"
    ))
    .unwrap()["cases"][0]
        .clone()
}
#[cfg(test)]
pub(in super::super) fn future_invalid_currents(base: &Value, current: &Value) -> Vec<Value> {
    let mut invalid = vec![base.clone()];
    for index in [0, 2] {
        let mut partial = current.clone();
        if index == 0 {
            partial["calendarEvents"][index] = base["calendarEvents"][index].clone();
        } else {
            partial["calendarEvents"]
                .as_array_mut()
                .unwrap()
                .remove(index);
        }
        invalid.push(partial);
        for key in ["title", "recurrence", "sourceId", "id"] {
            let mut changed = current.clone();
            changed["calendarEvents"][index][key] = json!("forged");
            invalid.push(changed);
        }
    }
    for key in [
        "tasks",
        "calendarEventLinks",
        "eventOutcomes",
        "calendarSources",
    ] {
        let mut changed = current.clone();
        changed[key] = json!([{"forged":true}]);
        invalid.push(changed);
    }
    let n = current["commandReceipts"].as_array().unwrap().len() - 1;
    for key in [
        "id",
        "idempotencyKey",
        "commandType",
        "expiresAt",
        "workspaceRevision",
    ] {
        let mut changed = current.clone();
        changed["commandReceipts"][n][key] = json!("invalid");
        invalid.push(changed);
    }
    for key in ["operationId", "batchId", "sourceId", "applied"] {
        let mut changed = current.clone();
        changed["commandReceipts"][n]["result"]["data"][key] = json!("forged");
        invalid.push(changed);
    }
    for key in ["plan", "expectedWorkspaceHash", "observedAt"] {
        let mut changed = current.clone();
        changed["commandReceipts"][n]["result"]["data"]["writeProjection"][key] = json!("forged");
        invalid.push(changed);
    }
    let mut expired = current.clone();
    expired["commandReceipts"][n]["expiresAt"] = json!("2000-01-01T00:00:00Z");
    invalid.push(expired);
    let mut duplicate = current.clone();
    duplicate["commandReceipts"]
        .as_array_mut()
        .unwrap()
        .push(current["commandReceipts"][n].clone());
    invalid.push(duplicate);
    invalid
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
    fn actual_ts_future_projection_requires_atomic_facts() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-projection.json"
        ))
        .unwrap();
        let case = &fixture["cases"][0];
        let mut current = case["current"].clone();
        current["commandReceipts"]
            .as_array_mut()
            .unwrap()
            .last_mut()
            .unwrap()["expiresAt"] = json!("2999-01-01T00:00:00Z");
        assert!(future_batch(&case["batch"], &case["base"]), "future batch");
        assert!(verify(&case["base"], &current, &case["batch"]));
        for (index, invalid) in future_invalid_currents(&case["base"], &current)
            .iter()
            .enumerate()
        {
            assert!(
                !verify(&case["base"], invalid, &case["batch"]),
                "current {index}"
            );
        }
        for key in [
            "hash",
            "parentEventId",
            "pivotEventId",
            "successorEventId",
            "originalStart",
            "markerHash",
            "steps",
        ] {
            let mut batch = case["batch"].clone();
            batch["plan"][key] = json!("forged");
            assert!(!verify(&case["base"], &current, &batch), "plan {key}");
        }
        for i in [0, 1] {
            for key in ["id", "recurrence", "summary", "etag", "extendedProperties"] {
                let mut batch = case["batch"].clone();
                batch["items"][i][key] = json!("forged");
                assert!(!verify(&case["base"], &current, &batch), "item {i} {key}");
            }
        }
        let mut denied = case["batch"].clone();
        denied["access"] = json!("freebusy");
        assert!(!verify(&case["base"], &current, &denied));
        let mut stale = case["base"].clone();
        stale["revision"] = json!(999);
        assert!(!verify(&stale, &current, &case["batch"]));
        for index in [0, 1] {
            let mut batch = case["batch"].clone();
            batch["items"].as_array_mut().unwrap().remove(index);
            assert!(!verify(&case["base"], &current, &batch));
        }
    }
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
        for rule in [
            "RRULE:FREQ=DAILY;INTERVAL=0",
            "RRULE:FREQ=DAILY;INTERVAL=bogus",
            "RRULE:FREQ=DAILY;BYSETPOS=1",
            "RRULE:FREQ=DAILY;COUNT=1;COUNT=2",
        ] {
            let mut batch = case["batch"].clone();
            batch["items"][0]["recurrence"] = json!([rule]);
            assert!(!verify(&case["base"], &case["current"], &batch), "{rule}");
        }
        let mut overridden = case["batch"].clone();
        overridden["items"][1]["summary"] = json!("different occurrence title");
        assert!(!verify(&case["base"], &case["current"], &overridden));
        let mut impossible = case["batch"].clone();
        impossible["plan"]["originalStart"] = json!("2026-09-20");
        impossible["items"][1]["originalStartTime"]["date"] = json!("2026-09-20");
        let mut receipt = case["current"].clone();
        let index = receipt["commandReceipts"]
            .as_array()
            .unwrap()
            .iter()
            .position(|r| r["idempotencyKey"] == impossible["batchId"])
            .unwrap();
        receipt["commandReceipts"][index]["result"]["data"]["writeProjection"]["plan"]
            ["originalStart"] = json!("2026-09-20");
        assert!(!verify(&case["base"], &receipt, &impossible));
    }
    #[test]
    fn timed_recurrence_uses_event_timezone_instant_and_count_membership() {
        let time = json!({"kind":"fixed","startAt":"2026-09-09T16:30:00.000Z","endAt":"2026-09-09T17:30:00.000Z","timezone":"Asia/Shanghai"});
        let weekly =
            recurrence("RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20260910T160000Z", &time).unwrap();
        assert_eq!(weekly["end"], json!({"kind":"on","date":"2026-09-10"}));
        assert!(occurs(&weekly, &time, "2026-09-09T16:30:00Z"));
        assert!(!occurs(&weekly, &time, "2026-09-09T17:30:00Z"));
        assert!(recurrence("RRULE:FREQ=MONTHLY;COUNT=1", &time).is_some());
        assert!(recurrence("RRULE:FREQ=YEARLY;COUNT=1", &time).is_some());
        assert!(recurrence("RRULE:FREQ=DAILY;COUNT=0", &time).is_none());
        assert!(recurrence("RRULE:FREQ=DAILY;COUNT=10001", &time).is_none());
        let once = recurrence("RRULE:FREQ=DAILY;COUNT=1", &time).unwrap();
        assert!(!occurs(&once, &time, "2026-09-10T16:30:00Z"));
        for rule in [
            "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3",
            "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3",
            "RRULE:FREQ=MONTHLY;COUNT=3",
            "RRULE:FREQ=YEARLY;COUNT=3",
        ] {
            let recurrence = recurrence(rule, &time).unwrap();
            assert!(occurs(&recurrence, &time, "2026-09-09T16:30:00Z"), "{rule}");
        }
        let daily = recurrence("RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3", &time).unwrap();
        assert!(occurs(&daily, &time, "2026-09-13T16:30:00Z"));
        assert!(!occurs(&daily, &time, "2026-09-15T16:30:00Z"));
        let weekly = recurrence("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3", &time).unwrap();
        assert!(occurs(&weekly, &time, "2026-10-07T16:30:00Z"));
        assert!(!occurs(&weekly, &time, "2026-10-21T16:30:00Z"));
        let monthly = recurrence("RRULE:FREQ=MONTHLY;COUNT=3", &time).unwrap();
        assert!(occurs(&monthly, &time, "2026-11-09T16:30:00Z"));
        assert!(!occurs(&monthly, &time, "2026-12-09T16:30:00Z"));
        let yearly = recurrence("RRULE:FREQ=YEARLY;COUNT=3", &time).unwrap();
        assert!(occurs(&yearly, &time, "2028-09-09T16:30:00Z"));
        assert!(!occurs(&yearly, &time, "2029-09-09T16:30:00Z"));
        for until in [
            "20260910T16000Z",
            "20260910X160000Z",
            "20260910T160000X",
            "２０２６０９１０T１６００００Z",
        ] {
            assert!(
                recurrence(&format!("RRULE:FREQ=DAILY;UNTIL={until}"), &time).is_none(),
                "{until}"
            );
        }
        let gmt = json!({"kind":"fixed","startAt":"2026-09-10T01:00:00Z","endAt":"2026-09-10T02:00:00Z","timezone":"Etc/GMT+2"});
        assert_eq!(
            recurrence("RRULE:FREQ=MONTHLY;COUNT=1", &gmt).unwrap()["cadence"]["dayOfMonth"],
            9
        );
        for timezone in ["Etc/GMT+0", "Etc/GMT-0"] {
            let zero = json!({"kind":"fixed","startAt":"2026-09-10T01:00:00Z","endAt":"2026-09-10T02:00:00Z","timezone":timezone});
            assert_eq!(
                recurrence("RRULE:FREQ=MONTHLY;COUNT=1", &zero).unwrap()["cadence"]["dayOfMonth"],
                10
            );
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
