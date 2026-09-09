//! Ordered list organization subset and global IDs for supported entities.
use super::{
    calendar::{fields, get, text, whitespace},
    Json,
};
use std::collections::{HashMap, HashSet};
const INVALID: &str = "WORKSPACE_LIST_INVALID";

pub(super) fn collection(name: &str, raw: Json) -> Result<Json, String> {
    let Json::Array(items) = raw else {
        return Err(INVALID.into());
    };
    if items.len() > 100_000 {
        return Err(INVALID.into());
    }
    let mut schema = vec![("id", "text")];
    match name {
        "lists" => schema.push(("groupId", "~text")),
        "sections" => schema.push(("listId", "text")),
        _ => (),
    }
    schema.extend([("title", "text"), ("position", "nonnegative")]);
    if name == "lists" {
        schema.extend([
            ("goal", "empty"),
            ("successCriteria", "[]text"),
            ("weeklyTargetMinutes", "~number"),
        ]);
    }
    schema.extend([
        ("createdAt", "stamp"),
        ("updatedAt", "stamp"),
        ("archivedAt", "~stamp"),
    ]);
    items
        .into_iter()
        .map(|v| fields(v, &schema))
        .collect::<Result<Vec<_>, _>>()
        .map(Json::Array)
}

pub(super) fn references(root: &Json) -> Result<(), String> {
    let mut all = HashSet::new();
    let mut entities = HashMap::new();
    for key in [
        "listGroups",
        "lists",
        "sections",
        "tags",
        "calendarSources",
        "calendarEvents",
        "tasks",
        "taskEvents",
        "recurrenceSeries",
        "occurrences",
        "studySessions",
        "completionRecords",
        "reviewTaskLinks",
        "reminderRules",
    ] {
        let Json::Array(items) = get(root, key)? else {
            return Err(INVALID.into());
        };
        let mut ids = HashSet::new();
        for item in items {
            let id = text(get(item, "id")?)?;
            if !all.insert(id) {
                return Err(INVALID.into());
            }
            ids.insert(id);
        }
        entities.insert(key, ids);
    }
    for (collection, field, target) in [
        ("lists", "groupId", "listGroups"),
        ("sections", "listId", "lists"),
    ] {
        let Json::Array(items) = get(root, collection)? else {
            return Err(INVALID.into());
        };
        for item in items {
            let id = get(item, field)?;
            if id != &Json::Null && !entities[target].contains(text(id)?) {
                return Err(INVALID.into());
            }
        }
    }
    let Json::Array(tags) = get(root, "tags")? else {
        return Err(INVALID.into());
    };
    let mut titles = HashSet::new();
    for tag in tags {
        if get(tag, "archivedAt")? == &Json::Null {
            let title = text(get(tag, "title")?)?;
            if title.trim_matches(whitespace) != title || !titles.insert(title) {
                return Err(INVALID.into());
            }
        }
    }
    Ok(())
}
