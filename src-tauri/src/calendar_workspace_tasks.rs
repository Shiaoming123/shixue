//! Ordered tasks, recurrence, sessions and lifecycle chains; completion records remain unsupported.
use super::{
    calendar::{fields, get, text},
    Json,
};
use std::collections::{HashMap, HashSet};
const INVALID: &str = "WORKSPACE_TASK_INVALID";
const STATUS: &str = "inbox|planned|in_progress|blocked|completed|cancelled";

pub(super) fn collection(name: &str, raw: Json) -> Result<Json, String> {
    let Json::Array(items) = raw else {
        return Err(INVALID.into());
    };
    if items.len() > 100_000 {
        return Err(INVALID.into());
    }
    items.into_iter().map(|v| {
        if name == "studySessions" {
            let session = fields(v, &[
                ("id", "text"), ("taskId", "text"), ("state", "running|paused|finished"),
                ("startedAt", "stamp"), ("activeSince", "~stamp"), ("elapsedSeconds", "nonnegative"),
                ("scratchpad", "empty"), ("createdAt", "stamp"), ("updatedAt", "stamp"), ("deletedAt", "~stamp"),
            ])?;
            if (text(get(&session, "state")?)? == "running") != (get(&session, "activeSince")? != &Json::Null) {
                return Err(INVALID.into());
            }
            return Ok(session);
        }
        if name == "recurrenceSeries" || name == "occurrences" {
            return recurrence(name, v);
        }
        if name == "tasks" {
            let task = fields(v, &[
                ("id", "text"), ("revision", "number"), ("mode", "general|learning"),
                ("listId", "text"), ("sectionId", "~text"), ("tagIds", "[]text"),
                ("title", "text"), ("notes", "empty"), ("status", STATUS),
                ("schedule", "task-schedule"), ("deadline", "task-deadline"),
                ("priority", "none|low|medium|high"), ("checklist", "[]task-checklist"),
                ("learning", "~task-learning"), ("recurrenceSeriesId", "~text"),
                ("createdAt", "stamp"), ("updatedAt", "stamp"), ("deletedAt", "~stamp"),
            ])?;
            if (text(get(&task, "mode")?)? == "learning") != (get(&task, "learning")? != &Json::Null) {
                return Err(INVALID.into());
            }
            let mut ids = HashSet::new();
            for item in array(get(&task, "checklist")?)? {
                if !ids.insert(text(get(item, "id")?)?) { return Err(INVALID.into()); }
            }
            Ok(task)
        } else {
            let nullable_status = format!("~{STATUS}");
            let event = fields(v, &[
                ("id", "text"), ("sequence", "number"), ("taskId", "text"), ("occurrenceId", "?~text"),
                ("type", "captured|migrated|planned|started|paused|resumed|blocked|completed|reopened|cancelled|rescheduled|deleted"),
                ("occurredAt", "stamp"), ("fromStatus", &nullable_status), ("toStatus", &nullable_status),
                ("reason", "~text"), ("completionRecordId", "~text"),
            ])?;
            if get(&event, "completionRecordId")? != &Json::Null {
                return Err("WORKSPACE_COLLECTION_UNSUPPORTED".into());
            }
            Ok(event)
        }
    }).collect::<Result<Vec<_>, _>>().map(Json::Array)
}

pub(super) fn nested(v: Json, spec: &str) -> Result<Json, String> {
    let schema: &[(&str, &str)] = match spec {
        "task-schedule" => &[
            ("startAt", "~stamp"),
            ("startOn", "~date"),
            ("estimateMinutes", "~number"),
        ],
        "task-deadline" => &[("dueAt", "~stamp"), ("dueOn", "~date")],
        "task-learning" => &[("acceptanceCriteria", "[]text"), ("blockedReason", "~text")],
        "task-checklist" => &[
            ("id", "text"),
            ("text", "text"),
            ("checked", "bool"),
            ("checkedAt", "~stamp"),
            ("position", "nonnegative"),
        ],
        _ => return Err(INVALID.into()),
    };
    let exclusive = match spec {
        "task-schedule" => Some(("startAt", "startOn")),
        "task-deadline" => Some(("dueAt", "dueOn")),
        _ => None,
    };
    let value = fields(v, schema)?;
    if let Some((a, b)) = exclusive {
        if get(&value, a)? != &Json::Null && get(&value, b)? != &Json::Null {
            return Err(INVALID.into());
        }
    }
    Ok(value)
}
fn array(v: &Json) -> Result<&[Json], String> {
    if let Json::Array(items) = v {
        Ok(items)
    } else {
        Err(INVALID.into())
    }
}
pub(super) fn references(root: &Json) -> Result<(), String> {
    let lists: HashSet<_> = array(get(root, "lists")?)?
        .iter()
        .map(|v| text(get(v, "id")?))
        .collect::<Result<_, _>>()?;
    let tags: HashSet<_> = array(get(root, "tags")?)?
        .iter()
        .map(|v| text(get(v, "id")?))
        .collect::<Result<_, _>>()?;
    let sections: HashMap<_, _> = array(get(root, "sections")?)?
        .iter()
        .map(|v| Ok((text(get(v, "id")?)?, get(v, "listId")?)))
        .collect::<Result<_, String>>()?;
    let tasks = array(get(root, "tasks")?)?;
    let mut statuses = HashMap::new();
    for task in tasks {
        if !lists.contains(text(get(task, "listId")?)?) {
            return Err(INVALID.into());
        }
        if get(task, "sectionId")? != &Json::Null
            && sections.get(text(get(task, "sectionId")?)?) != Some(&get(task, "listId")?)
        {
            return Err(INVALID.into());
        }
        let mut seen = HashSet::new();
        for tag in array(get(task, "tagIds")?)? {
            let id = text(tag)?;
            if !tags.contains(id) || !seen.insert(id) {
                return Err(INVALID.into());
            }
        }
        statuses.insert(text(get(task, "id")?)?, &Json::Null);
    }
    recurrence_references(root)?;
    for (index, event) in array(get(root, "taskEvents")?)?.iter().enumerate() {
        if get(event, "sequence")? != &Json::Number((index + 1) as f64) {
            return Err(INVALID.into());
        }
        let status = statuses
            .get_mut(text(get(event, "taskId")?)?)
            .ok_or(INVALID)?;
        if get(event, "fromStatus")? != *status || get(event, "toStatus")? == &Json::Null {
            return Err(INVALID.into());
        }
        *status = get(event, "toStatus")?;
    }
    for task in tasks {
        if statuses[text(get(task, "id")?)?] != get(task, "status")? {
            return Err(INVALID.into());
        }
    }
    let mut active = false;
    for session in array(get(root, "studySessions")?)? {
        let status = statuses
            .get(text(get(session, "taskId")?)?)
            .ok_or(INVALID)?;
        if get(session, "deletedAt")? == &Json::Null && text(get(session, "state")?)? != "finished"
        {
            if active || text(status)? != "in_progress" {
                return Err(INVALID.into());
            }
            active = true;
        }
    }
    Ok(())
}

fn defaults(mut v: Json, keys: &[&str]) -> Result<Json, String> {
    let Json::Object(ref mut fields) = v else {
        return Err(INVALID.into());
    };
    for key in keys {
        if !fields.iter().any(|(k, _)| k == key) {
            fields.push((key.to_string(), Json::Null));
        }
    }
    Ok(v)
}
fn exclusive(v: &Json, a: &str, b: &str, required: bool) -> Result<(), String> {
    let a = get(v, a)? != &Json::Null;
    let b = get(v, b)? != &Json::Null;
    if (a && b) || (required && !a && !b) {
        return Err(INVALID.into());
    }
    Ok(())
}
pub(super) fn occurrence_override(v: Json) -> Result<Json, String> {
    let v = fields(
        defaults(v, &["scheduledAt", "scheduledOn"])?,
        &[
            ("scheduledAt", "~stamp"),
            ("scheduledOn", "~date"),
            ("estimateMinutes", "~number"),
        ],
    )?;
    exclusive(&v, "scheduledAt", "scheduledOn", false)?;
    Ok(v)
}
fn recurrence(name: &str, v: Json) -> Result<Json, String> {
    let (schema, a, b): (&[(&str, &str)], &str, &str) = if name == "recurrenceSeries" {
        (
            &[
                ("id", "text"),
                ("taskId", "text"),
                ("revision", "number"),
                ("cadence", "cadence"),
                ("basis", "fixed_schedule|after_completion"),
                ("anchorAt", "~stamp"),
                ("anchorOn", "~date"),
                ("end", "end"),
                ("timezone", "zone"),
                ("createdThrough", "~schedule-value"),
                ("createdCount", "nonnegative"),
            ],
            "anchorAt",
            "anchorOn",
        )
    } else {
        (
            &[
                ("id", "text"),
                ("seriesId", "text"),
                ("ordinal", "number"),
                ("scheduledAt", "~stamp"),
                ("scheduledOn", "~date"),
                ("status", "pending|completed|skipped|cancelled"),
                ("override", "~occurrence-override"),
                ("completedAt", "~stamp"),
                ("revision", "number"),
            ],
            "scheduledAt",
            "scheduledOn",
        )
    };
    let value = fields(defaults(v, &[a, b])?, schema)?;
    exclusive(&value, a, b, true)?;
    Ok(value)
}
fn recurrence_references(root: &Json) -> Result<(), String> {
    let map = |key| -> Result<HashMap<&str, &Json>, String> {
        array(get(root, key)?)?
            .iter()
            .map(|v| Ok((text(get(v, "id")?)?, v)))
            .collect()
    };
    let tasks = map("tasks")?;
    let series = map("recurrenceSeries")?;
    let occurrences = map("occurrences")?;
    for entry in series.values() {
        let task = tasks.get(text(get(entry, "taskId")?)?).ok_or(INVALID)?;
        if text(get(get(entry, "end")?, "kind")?)? == "never"
            && get(task, "recurrenceSeriesId")? != get(entry, "id")?
        {
            return Err(INVALID.into());
        }
    }
    for task in tasks.values() {
        if get(task, "recurrenceSeriesId")? != &Json::Null {
            let entry = series
                .get(text(get(task, "recurrenceSeriesId")?)?)
                .ok_or(INVALID)?;
            if get(entry, "taskId")? != get(task, "id")? {
                return Err(INVALID.into());
            }
        }
    }
    for occurrence in occurrences.values() {
        if !series.contains_key(text(get(occurrence, "seriesId")?)?) {
            return Err(INVALID.into());
        }
    }
    for event in array(get(root, "taskEvents")?)? {
        if let Ok(id) = get(event, "occurrenceId") {
            if id != &Json::Null {
                let occurrence = occurrences.get(text(id)?).ok_or(INVALID)?;
                let entry = series
                    .get(text(get(occurrence, "seriesId")?)?)
                    .ok_or(INVALID)?;
                if get(entry, "taskId")? != get(event, "taskId")? {
                    return Err(INVALID.into());
                }
            }
        }
    }
    Ok(())
}
