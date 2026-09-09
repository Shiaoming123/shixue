//! Ordered reminder rules and deliveries with TS reference invariants.
use super::{
    calendar::{fields, get, text},
    Json,
};
use std::collections::{HashMap, HashSet};
const INVALID: &str = "WORKSPACE_REMINDER_INVALID";
fn take(props: &mut Vec<(String, Json)>, key: &str) -> Option<Json> {
    props
        .iter()
        .position(|(k, _)| k == key)
        .map(|i| props.remove(i).1)
}
pub(super) fn rules(raw: Json) -> Result<Json, String> {
    let Json::Array(items) = raw else {
        return Err(INVALID.into());
    };
    if items.len() > 100_000 {
        return Err(INVALID.into());
    }
    items
        .into_iter()
        .map(rule)
        .collect::<Result<Vec<_>, _>>()
        .map(Json::Array)
}
pub(super) fn deliveries(raw: Json, rules: &Json) -> Result<Json, String> {
    let (Json::Array(items), Json::Array(rules)) = (raw, rules) else {
        return Err(INVALID.into());
    };
    if items.len() > 100_000 {
        return Err(INVALID.into());
    }
    let by_id = rules
        .iter()
        .map(|rule| Ok((text(get(rule, "id")?)?, rule)))
        .collect::<Result<HashMap<_, _>, String>>()?;
    items.into_iter().map(|raw| {
        let Json::Object(mut props) = raw else { return Err(INVALID.into()); };
        let start = take(&mut props, "originalStart");
        let claim = take(&mut props, "claim").map(|raw| fields(raw, &[("token", "text"), ("armedAt", "stamp")])).transpose()?;
        let mut output = fields(Json::Object(props), &[
            ("id", "text"), ("revision", "?number"), ("acknowledgedAt", "?stamp"),
            ("reminderRuleId", "text"), ("occurrenceId", "~text"), ("scheduledFor", "stamp"),
            ("status", "pending|delivered|snoozed|acted|dismissed|failed|cancelled|armed|ambiguous"),
            ("snoozedUntil", "~stamp"), ("action", "~complete|open"),
        ])?;
        if text(get(&output, "status")?)? == "armed" && (claim.is_none() || get(&output, "revision").is_err()) { return Err(INVALID.into()); }
        let rule = by_id.get(text(get(&output, "reminderRuleId")?)?).ok_or(INVALID)?;
        let target = get(rule, "target")?;
        let event_start = if text(get(target, "kind")?)? == "event" {
            if get(&output, "occurrenceId")? != &Json::Null || text(get(&output, "action")?).ok() == Some("complete") { return Err(INVALID.into()); }
            let start = original_start(start.unwrap_or(Json::Null))?;
            if get(target, "originalStart")? != &Json::Null && get(target, "originalStart")? != &start { return Err(INVALID.into()); }
            Some(start)
        } else {
            if start.is_some_and(|v| v != Json::Null) { return Err(INVALID.into()); }
            None
        };
        if let Json::Object(ref mut props) = output {
            if let Some(claim) = claim {
                let index = if props.iter().any(|(k, _)| k == "revision") { 2 } else { 1 };
                props.insert(index, ("claim".into(), claim));
            }
            if let Some(start) = event_start { props.push(("originalStart".into(), start)); }
        }
        Ok(output)
    }).collect::<Result<Vec<_>, _>>().map(Json::Array)
}
fn rule(raw: Json) -> Result<Json, String> {
    let Json::Object(mut props) = raw else {
        return Err(INVALID.into());
    };
    let current = take(&mut props, "target");
    let legacy = current.is_none();
    let task_id = take(&mut props, "taskId");
    let occurrence_id = take(&mut props, "occurrenceId");
    let target = if let Some(target) = current {
        let kind = text(get(&target, "kind")?)?;
        let mut target = match kind {
            "task" => fields(
                target,
                &[
                    ("kind", "task"),
                    ("taskId", "text"),
                    ("occurrenceId", "~text"),
                ],
            )?,
            "event" => fields(
                target,
                &[
                    ("kind", "event"),
                    ("eventId", "text"),
                    ("originalStart", "~text"),
                ],
            )?,
            _ => return Err(INVALID.into()),
        };
        if (task_id.is_some() || occurrence_id.is_some())
            && (text(get(&target, "kind")?)? != "task"
                || task_id.as_ref() != Some(get(&target, "taskId")?)
                || occurrence_id.as_ref() != Some(get(&target, "occurrenceId")?))
        {
            return Err(INVALID.into());
        }
        if text(get(&target, "kind")?)? == "event" {
            if let Json::Object(ref mut fields) = target {
                let raw = take(fields, "originalStart").ok_or(INVALID)?;
                fields.push(("originalStart".into(), original_start(raw)?));
            }
        }
        target
    } else {
        fields(
            Json::Object(vec![
                ("kind".into(), Json::String("task".into())),
                ("taskId".into(), task_id.ok_or(INVALID)?),
                ("occurrenceId".into(), occurrence_id.ok_or(INVALID)?),
            ]),
            &[
                ("kind", "task"),
                ("taskId", "text"),
                ("occurrenceId", "~text"),
            ],
        )?
    };
    let trigger = take(&mut props, "trigger").ok_or(INVALID)?;
    let trigger = match text(get(&trigger, "kind")?)? {
        "at_start" => fields(trigger, &[("kind", "at_start")])?,
        "before_start" | "before_due" => fields(
            trigger,
            &[("kind", "before_start|before_due"), ("minutes", "number")],
        )?,
        "absolute" => fields(trigger, &[("kind", "absolute"), ("at", "stamp")])?,
        _ => return Err(INVALID.into()),
    };
    let Json::Object(mut output) = fields(
        Json::Object(props),
        &[
            ("id", "text"),
            ("owner", "?legacy|user"),
            ("enabled", "bool"),
            ("revision", "number"),
        ],
    )?
    else {
        unreachable!()
    };
    let trigger_index = output.len() - 2;
    output.insert(trigger_index, ("trigger".into(), trigger));
    if legacy {
        output.push(("target".into(), target));
    } else {
        output.insert(1, ("target".into(), target));
    }
    Ok(Json::Object(output))
}
fn original_start(raw: Json) -> Result<Json, String> {
    if raw == Json::Null {
        return Ok(raw);
    }
    let value = text(&raw)?;
    let spec = match value.len() {
        10 => "date",
        16 => "local",
        _ => "stamp",
    };
    let validated = fields(
        Json::Object(vec![("start".into(), raw)]),
        &[("start", spec)],
    )?;
    let value = text(get(&validated, "start")?)?;
    Ok(Json::String(if spec == "stamp" {
        let utc = chrono::DateTime::parse_from_rfc3339(value)
            .map_err(|_| INVALID)?
            .with_timezone(&chrono::Utc);
        // Keep normalized UTC in the same year range as the native input validator.
        if !(100..=9999).contains(&chrono::Datelike::year(&utc)) {
            return Err(INVALID.into());
        }
        utc.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    } else {
        value.into()
    }))
}
pub(super) fn references(root: &Json) -> Result<(), String> {
    let mut collections = HashMap::new();
    for name in [
        "tasks",
        "calendarEvents",
        "recurrenceSeries",
        "occurrences",
        "reminderRules",
    ] {
        let Json::Array(items) = get(root, name)? else {
            return Err(INVALID.into());
        };
        let mut by_id = HashMap::new();
        for item in items {
            by_id.insert(text(get(item, "id")?)?, item);
        }
        collections.insert(name, by_id);
    }
    for rule in collections["reminderRules"].values() {
        let target = get(rule, "target")?;
        if text(get(target, "kind")?)? == "event" {
            if !collections["calendarEvents"].contains_key(text(get(target, "eventId")?)?)
                || text(get(get(rule, "trigger")?, "kind")?)? == "before_due"
            {
                return Err(INVALID.into());
            }
        } else {
            let task_id = get(target, "taskId")?;
            if !collections["tasks"].contains_key(text(task_id)?) {
                return Err(INVALID.into());
            }
            if get(target, "occurrenceId")? != &Json::Null {
                let occurrence = collections["occurrences"]
                    .get(text(get(target, "occurrenceId")?)?)
                    .ok_or(INVALID)?;
                let series = collections["recurrenceSeries"]
                    .get(text(get(occurrence, "seriesId")?)?)
                    .ok_or(INVALID)?;
                if get(series, "taskId")? != task_id {
                    return Err(INVALID.into());
                }
            }
        }
    }
    let Json::Array(deliveries) = get(root, "reminderDeliveries")? else {
        return Err(INVALID.into());
    };
    let mut keys = HashSet::new();
    for delivery in deliveries {
        let rule_id = text(get(delivery, "reminderRuleId")?)?;
        let rule = collections["reminderRules"].get(rule_id).ok_or(INVALID)?;
        let target = get(rule, "target")?;
        let occurrence_id = get(delivery, "occurrenceId")?;
        let occurrence_key = if text(get(target, "kind")?)? == "task" {
            if get(target, "occurrenceId")? != &Json::Null
                && get(target, "occurrenceId")? != occurrence_id
            {
                return Err(INVALID.into());
            }
            if occurrence_id != &Json::Null {
                let occurrence = collections["occurrences"]
                    .get(text(occurrence_id)?)
                    .ok_or(INVALID)?;
                let series = collections["recurrenceSeries"]
                    .get(text(get(occurrence, "seriesId")?)?)
                    .ok_or(INVALID)?;
                if get(series, "taskId")? != get(target, "taskId")? {
                    return Err(INVALID.into());
                }
            }
            occurrence_id
        } else {
            get(delivery, "originalStart")?
        };
        // Date.parse truncates fractional seconds to milliseconds before keying.
        let instant = chrono::DateTime::parse_from_rfc3339(text(get(delivery, "scheduledFor")?)?)
            .map_err(|_| INVALID)?
            .timestamp_millis();
        if !keys.insert((rule_id, occurrence_key.encode()?, instant)) {
            return Err(INVALID.into());
        }
    }
    if let Ok(migration) = get(root, "reminderMigration") {
        let Json::Array(mapped) = get(migration, "mapped")? else {
            unreachable!()
        };
        for mapping in mapped {
            let row = get(mapping, "row")?;
            let Json::Array(ids) = get(mapping, "deliveryIds")? else {
                unreachable!()
            };
            if ids.is_empty() {
                return Err(INVALID.into());
            }
            for id in ids {
                // ponytail: linear lookup per mapping ID; index deliveries if large migrations matter.
                let delivery = deliveries
                    .iter()
                    .find(|delivery| get(delivery, "id").ok() == Some(id))
                    .ok_or(INVALID)?;
                let rule = collections["reminderRules"]
                    .get(text(get(delivery, "reminderRuleId")?)?)
                    .ok_or(INVALID)?;
                let target = get(rule, "target")?;
                if text(get(target, "kind")?)? != "task"
                    || get(target, "taskId")? != get(row, "taskId")?
                {
                    return Err(INVALID.into());
                }
                let raw_time = text(get(row, "reminderAt")?)?;
                // Native date ceiling: date-only UTC or the supported RFC3339 subset.
                let row_time = if raw_time.len() == 10 {
                    format!("{raw_time}T00:00:00Z")
                } else {
                    raw_time.to_string()
                };
                if !super::valid_timestamp(&row_time) {
                    return Err("WORKSPACE_TIMESTAMP_UNSUPPORTED".into());
                }
                let instant = |value: &str| {
                    chrono::DateTime::parse_from_rfc3339(value)
                        .map(|v| v.timestamp_millis())
                        .map_err(|_| INVALID)
                };
                if instant(&row_time)? != instant(text(get(delivery, "scheduledFor")?)?)? {
                    return Err(INVALID.into());
                }
            }
        }
    }

    Ok(())
}

pub(super) fn migration(raw: Json) -> Result<Json, String> {
    let Json::Object(mut props) = raw else {
        return Err(INVALID.into());
    };
    let mut groups = Vec::new();
    for name in ["mapped", "quarantined"] {
        let Json::Array(items) = take(&mut props, name).ok_or(INVALID)? else {
            return Err(INVALID.into());
        };
        if items.len() > 100_000 {
            return Err(INVALID.into());
        }
        let mut entries = Vec::new();
        for item in items {
            let Json::Object(mut entry) = item else {
                return Err(INVALID.into());
            };
            let row = fields(
                take(&mut entry, "row").ok_or(INVALID)?,
                &[
                    ("taskId", "text"),
                    ("reminderAt", "text"),
                    ("deliveredAt", "text"),
                ],
            )?;
            let schema = if name == "mapped" {
                ("deliveryIds", "[]text")
            } else {
                ("reason", "text")
            };
            let Json::Object(mut output) = fields(Json::Object(entry), &[schema])? else {
                unreachable!()
            };
            output.insert(0, ("row".into(), row));
            entries.push(Json::Object(output));
        }
        groups.push((name.into(), Json::Array(entries)));
    }
    let Json::Object(mut output) = fields(
        Json::Object(props),
        &[("version", "number"), ("completedAt", "stamp")],
    )?
    else {
        unreachable!()
    };
    if output[0].1 != Json::Number(1.0) {
        return Err(INVALID.into());
    }
    output.extend(groups);
    Ok(Json::Object(output))
}
