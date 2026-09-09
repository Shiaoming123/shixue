//! Ordered tasks and lifecycle chains; recurrence/activity references remain unsupported.
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
            if get(&task, "recurrenceSeriesId")? != &Json::Null { return Err("WORKSPACE_COLLECTION_UNSUPPORTED".into()); }
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
            if get(&event, "occurrenceId").is_ok_and(|v| v != &Json::Null) || get(&event, "completionRecordId")? != &Json::Null {
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
    Ok(())
}
