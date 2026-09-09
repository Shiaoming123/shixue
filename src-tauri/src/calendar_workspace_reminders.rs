//! Current and legacy-shaped reminder rules; deliveries remain fail-closed.
use super::{
    calendar::{fields, get, text},
    Json,
};
use std::collections::HashMap;
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
    Ok(())
}
