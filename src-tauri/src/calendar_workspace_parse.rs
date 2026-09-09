//! Partial workspace parser: calendar, list organization, tasks, recurrence and event chains.
#[path = "calendar_workspace_calendar.rs"]
mod calendar;
#[path = "calendar_workspace_lists.rs"]
mod lists;
#[path = "calendar_workspace_reminders.rs"]
mod reminders;
#[path = "calendar_workspace_tasks.rs"]
mod tasks;
use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use std::fmt;

use super::super::sync_store::MAX_WORKSPACE_BYTES as MAX_BYTES;

#[derive(Debug, PartialEq)]
pub(super) enum Json {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct JsonVisitor;
        impl<'de> Visitor<'de> for JsonVisitor {
            type Value = Json;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("ordered JSON")
            }
            fn visit_unit<E: de::Error>(self) -> Result<Json, E> {
                Ok(Json::Null)
            }
            fn visit_bool<E: de::Error>(self, v: bool) -> Result<Json, E> {
                Ok(Json::Bool(v))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Json, E> {
                Ok(Json::String(v.into()))
            }
            fn visit_i64<E: de::Error>(self, v: i64) -> Result<Json, E> {
                self.visit_f64(v as f64)
            }
            fn visit_u64<E: de::Error>(self, v: u64) -> Result<Json, E> {
                self.visit_f64(v as f64)
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Json, E> {
                if !v.is_finite() {
                    return Err(E::custom("non-finite number"));
                }
                Ok(Json::Number(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
                let mut values = Vec::new();
                while let Some(value) = seq.next_element()? {
                    values.push(value);
                }
                Ok(Json::Array(values))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
                let mut values = Vec::new();
                let mut seen = std::collections::HashSet::new();
                while let Some((key, value)) = map.next_entry::<String, Json>()? {
                    if !seen.insert(key.clone()) {
                        return Err(de::Error::custom("duplicate JSON key"));
                    }
                    values.push((key, value));
                }
                Ok(Json::Object(values))
            }
        }
        deserializer.deserialize_any(JsonVisitor)
    }
}

pub(super) fn parse(raw: &[u8]) -> Result<Json, String> {
    if raw.is_empty() || raw.len() > MAX_BYTES {
        return Err("WORKSPACE_SIZE_INVALID".into());
    }
    // serde's recursion limit also bounds nesting; invalid UTF-8/surrogates fail closed.
    serde_json::from_slice(raw).map_err(|_| "WORKSPACE_JSON_INVALID".into())
}

impl Json {
    pub(super) fn encode(&self) -> Result<String, String> {
        Ok(match self {
            Self::Null => "null".into(),
            Self::Bool(v) => v.to_string(),
            Self::Number(v) => {
                serde_json_canonicalizer::to_string(v).map_err(|_| "WORKSPACE_JSON_INVALID")?
            }
            Self::String(v) => serde_json::to_string(v).map_err(|_| "WORKSPACE_JSON_INVALID")?,
            Self::Array(values) => format!(
                "[{}]",
                values
                    .iter()
                    .map(Self::encode)
                    .collect::<Result<Vec<_>, _>>()?
                    .join(",")
            ),
            Self::Object(values) => {
                let mut ordered = values.iter().collect::<Vec<_>>();
                // JSON.stringify enumerates array-index properties before ordinary keys.
                ordered.sort_by_key(|(key, _)| {
                    key.parse::<u32>()
                        .ok()
                        .filter(|n| *n != u32::MAX && n.to_string() == *key)
                        .map(u64::from)
                        .unwrap_or(u64::MAX)
                });
                format!(
                    "{{{}}}",
                    ordered
                        .into_iter()
                        .map(|(key, value)| {
                            Ok(format!(
                                "{}:{}",
                                serde_json::to_string(key).map_err(|_| "WORKSPACE_JSON_INVALID")?,
                                value.encode()?
                            ))
                        })
                        .collect::<Result<Vec<_>, String>>()?
                        .join(",")
                )
            }
        })
    }
}

const ROOT: &[&str] = &[
    "version",
    "revision",
    "listGroups",
    "lists",
    "sections",
    "tags",
    "tasks",
    "recurrenceSeries",
    "occurrences",
    "reminderRules",
    "reminderDeliveries",
    "studySessions",
    "taskEvents",
    "completionRecords",
    "reviewTaskLinks",
    "commandReceipts",
    "updatedAt",
    "calendarSources",
    "calendarEvents",
    "calendarEventLinks",
    "eventOutcomes",
];

/// Deliberately incomplete. Migration and legacy preview receipts remain fail-closed.
pub(super) fn normalize_empty_root(raw: &[u8]) -> Result<Vec<u8>, String> {
    let Json::Object(mut fields) = parse(raw)? else {
        return Err("WORKSPACE_INVALID".into());
    };
    if fields.iter().any(|(key, _)| {
        !ROOT.contains(&key.as_str()) && key != "reminderMigration" && key != "previewReceipts"
    }) {
        return Err("WORKSPACE_UNKNOWN_FIELD".into());
    }
    // Legacy empty receipts are validated then omitted by the TS parser.
    if let Some(index) = fields.iter().position(|(key, _)| key == "previewReceipts") {
        if fields.remove(index).1 != Json::Array(vec![]) {
            return Err("WORKSPACE_COLLECTION_UNSUPPORTED".into());
        }
    }
    if fields.iter().any(|(key, _)| key == "reminderMigration") {
        return Err("WORKSPACE_COLLECTION_UNSUPPORTED".into());
    }
    let mut normalized = Vec::new();
    for key in ROOT {
        let index = fields
            .iter()
            .position(|(name, _)| name == key)
            .ok_or("WORKSPACE_MISSING_FIELD")?;
        let (_, mut value) = fields.remove(index);
        if *key == "commandReceipts" {
            value = receipts(value)?;
            normalized.push((key.to_string(), value));
            continue;
        }
        if *key == "reminderRules" {
            value = reminders::rules(value)?;
            normalized.push((key.to_string(), value));
            continue;
        }
        if *key == "reminderDeliveries" {
            let rules = normalized
                .iter()
                .find(|(name, _)| name == "reminderRules")
                .ok_or("WORKSPACE_MISSING_FIELD")?;
            value = reminders::deliveries(value, &rules.1)?;
            normalized.push((key.to_string(), value));
            continue;
        }
        if matches!(
            *key,
            "calendarSources" | "calendarEvents" | "calendarEventLinks" | "eventOutcomes"
        ) {
            value = calendar::collection(key, value)?;
            normalized.push((key.to_string(), value));
            continue;
        }
        if matches!(*key, "listGroups" | "lists" | "sections" | "tags") {
            value = lists::collection(key, value)?;
            normalized.push((key.to_string(), value));
            continue;
        }
        if matches!(
            *key,
            "tasks"
                | "taskEvents"
                | "recurrenceSeries"
                | "occurrences"
                | "studySessions"
                | "completionRecords"
                | "reviewTaskLinks"
        ) {
            value = tasks::collection(key, value)?;
            normalized.push((key.to_string(), value));
            continue;
        }
        match (*key, &value) {
            ("version", Json::Number(v)) if *v == 4.0 => {}
            ("revision", Json::Number(v)) if *v > 0.0 && v.fract() == 0.0 => {}
            ("updatedAt", Json::String(v)) if valid_timestamp(v) => {}
            ("version" | "revision" | "updatedAt", _) => return Err("WORKSPACE_INVALID".into()),
            (_, Json::Array(items)) if items.is_empty() => {}
            (_, Json::Array(_)) => return Err("WORKSPACE_COLLECTION_UNSUPPORTED".into()),
            _ => return Err("WORKSPACE_INVALID".into()),
        }
        normalized.push((key.to_string(), value));
    }
    let normalized = Json::Object(normalized);
    calendar::references(&normalized)?;
    lists::references(&normalized)?;
    tasks::references(&normalized)?;
    reminders::references(&normalized)?;
    calendar::attachment_references(&normalized)?;
    Ok(normalized.encode()?.into_bytes())
}

// Arbitrary result JSON has already passed the ordered AST trust boundary.
fn receipts(raw: Json) -> Result<Json, String> {
    use calendar::{fields, get, text};
    let Json::Array(items) = raw else {
        return Err("WORKSPACE_RECEIPT_INVALID".into());
    };
    if items.len() > 100_000 {
        return Err("WORKSPACE_RECEIPT_INVALID".into());
    }
    let mut keys = std::collections::HashSet::new();
    items
        .into_iter()
        .map(|item| {
            let Json::Object(mut input) = item else {
                return Err("WORKSPACE_RECEIPT_INVALID".into());
            };
            let index = input
                .iter()
                .position(|(key, _)| key == "result")
                .ok_or("WORKSPACE_MISSING_FIELD")?;
            let result = input.remove(index).1;
            if !matches!(result, Json::Object(_)) {
                return Err("WORKSPACE_RECEIPT_INVALID".into());
            }
            if !input.iter().any(|(key, _)| key == "requestFingerprint") {
                input.push(("requestFingerprint".into(), Json::Null));
            }
            let normalized = fields(
                Json::Object(input),
                &[
                    ("id", "text"),
                    ("idempotencyKey", "text"),
                    ("requestFingerprint", "~text"),
                    ("commandType", "text"),
                    ("source", "human-ui|keyboard|notification|agent"),
                    ("workspaceRevision", "number"),
                    ("createdAt", "stamp"),
                    ("expiresAt", "stamp"),
                ],
            )?;
            if !keys.insert(text(get(&normalized, "idempotencyKey")?)?.to_string()) {
                return Err("WORKSPACE_RECEIPT_INVALID".into());
            }
            let Json::Object(mut output) = normalized else {
                unreachable!()
            };
            output.insert(6, ("result".into(), result));
            Ok(Json::Object(output))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Json::Array)
}

/// Internal extraction only; normalization still rejects unsupported collections.
pub(super) fn target_calendar_attachments(
    root: &Json,
    event_id: &str,
) -> Result<Vec<String>, String> {
    calendar::target_attachments(root, event_id)?
        .into_iter()
        .map(Json::encode)
        .collect()
}

fn valid_timestamp(value: &str) -> bool {
    // Conservative RFC3339 subset. Broader JS Date.parse acceptance is not clearance.
    let bytes = value.as_bytes();
    let suffix = if value.ends_with('Z') { 1 } else { 6 };
    let Some(body) = bytes.get(..bytes.len().saturating_sub(suffix)) else {
        return false;
    };
    let fraction_valid = body.len() == 19
        || (body.len() >= 21
            && body.len() <= 29
            && body[19] == b'.'
            && body[20..].iter().all(u8::is_ascii_digit));
    value.len() >= 20
        && fraction_valid
        && bytes
            .get(17..19)
            .is_some_and(|seconds| seconds <= b"59".as_slice())
        && (value.ends_with('Z')
            || bytes
                .get(bytes.len().saturating_sub(6))
                .is_some_and(|sign| *sign == b'+' || *sign == b'-'))
        && value.as_bytes().get(10) == Some(&b'T')
        && value
            .as_bytes()
            .get(..4)
            .is_some_and(|year| year.iter().all(u8::is_ascii_digit) && year >= b"0100".as_slice())
        && chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn tasks_and_event_chains_match_ts_and_fail_closed() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-tasks.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let result = normalize_empty_root(fixture["rawJson"].as_str().unwrap().as_bytes());
            if fixture["accepted"] == true {
                let bytes = result.unwrap_or_else(|error| panic!("{}: {error}", fixture["name"]));
                assert_eq!(
                    String::from_utf8(bytes.clone()).unwrap(),
                    fixture["parsedJson"],
                    "{}",
                    fixture["name"]
                );
                assert_eq!(
                    format!("sha256:{:x}", Sha256::digest(&bytes)),
                    fixture["hash"]
                );
                if fixture["name"].as_str().unwrap().starts_with("outcome-")
                    || fixture["name"] == "link-attached"
                {
                    let root = parse(&bytes).unwrap();
                    let normalized: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    for target in ["calendar", "unrelated", "absent"] {
                        let expected: Vec<String> = ["calendarEventLinks", "eventOutcomes"]
                            .into_iter()
                            .flat_map(|key| normalized[key].as_array().unwrap())
                            .filter(|item| item["eventId"] == target)
                            .map(|item| serde_json::to_string(item).unwrap())
                            .collect();
                        let actual: Vec<String> = target_calendar_attachments(&root, target)
                            .unwrap()
                            .into_iter()
                            .map(|item| {
                                serde_json::to_string(
                                    &serde_json::from_str::<serde_json::Value>(&item).unwrap(),
                                )
                                .unwrap()
                            })
                            .collect();
                        assert_eq!(actual, expected, "{} target {target}", fixture["name"]);
                    }
                }
            } else {
                assert!(result.is_err(), "{}", fixture["name"]);
            }
        }
    }
    #[test]
    fn list_entities_match_ts_and_fail_closed() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-lists.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let result = normalize_empty_root(fixture["rawJson"].as_str().unwrap().as_bytes());
            if fixture["accepted"] == true {
                let bytes = result.unwrap_or_else(|error| panic!("{}: {error}", fixture["name"]));
                assert_eq!(
                    String::from_utf8(bytes.clone()).unwrap(),
                    fixture["parsedJson"]
                );
                assert_eq!(
                    format!("sha256:{:x}", Sha256::digest(&bytes)),
                    fixture["hash"]
                );
            } else {
                assert!(result.is_err(), "{}", fixture["name"]);
            }
        }
    }

    #[test]
    fn calendar_entities_match_ts_and_fail_closed() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-calendar.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let result = normalize_empty_root(fixture["rawJson"].as_str().unwrap().as_bytes());
            if fixture["accepted"] == true {
                let bytes = result.unwrap_or_else(|error| panic!("{}: {error}", fixture["name"]));
                assert_eq!(
                    String::from_utf8(bytes.clone()).unwrap(),
                    fixture["parsedJson"]
                );
                assert_eq!(
                    format!("sha256:{:x}", Sha256::digest(&bytes)),
                    fixture["hash"]
                );
            } else {
                assert!(result.is_err(), "{}", fixture["name"]);
            }
        }
    }

    #[test]
    fn ordered_ast_matches_ts_numeric_unicode_defaulted_receipt_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-hash.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let expected = fixture["parsedJson"].as_str().unwrap();
            let encoded = parse(expected.as_bytes()).unwrap().encode().unwrap();
            assert_eq!(encoded, expected);
            assert_eq!(
                format!("sha256:{:x}", Sha256::digest(encoded.as_bytes())),
                fixture["hash"]
            );
            // Codec parity is not collection parsing or attachment clearance.
            assert!(normalize_empty_root(expected.as_bytes()).is_err());
        }
        assert_eq!(
            parse(br#"{"z":-0,"10":1,"2":1e20,"a":1e-7}"#)
                .unwrap()
                .encode()
                .unwrap(),
            r#"{"2":100000000000000000000,"10":1,"z":0,"a":1e-7}"#
        );
        for raw in [
            r#"{"a":1,"\u0061":2}"#,
            r#"{"a":[{"x":1,"x":2}]}"#,
            "[1e999]",
            "[NaN]",
            "{}{}",
            "[",
            r#""\ud800""#,
        ] {
            assert!(parse(raw.as_bytes()).is_err(), "{raw}");
        }
        assert!(parse(&vec![b' '; MAX_BYTES + 1]).is_err());
        assert!(parse(&[b'['; 130]).is_err());
        assert!(parse(&[0xff]).is_err());
    }

    #[test]
    fn root_fails_closed_on_missing_unknown_wrong_types_and_unparsed_collections() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-root.json"
        ))
        .unwrap();
        let raw = fixtures[0]["rawJson"].as_str().unwrap();
        for changed in [
            raw.replacen("\"version\":4", "\"version\":3", 1),
            raw.replacen("\"revision\":1", "\"revision\":0", 1),
            raw.replacen("\"revision\":1", "\"revision\":\"1\"", 1),
            raw.replacen("\"revision\":1,", "", 1),
            raw.replacen("{", "{\"unknown\":[],", 1),
            raw.replacen("\"tasks\":[]", "\"tasks\":{}", 1),
            raw.replacen("\"tasks\":[]", "\"tasks\":[{}]", 1),
            raw.replace("2026-09-09", "2026-02-30"),
        ] {
            assert!(
                normalize_empty_root(changed.as_bytes()).is_err(),
                "{changed}"
            );
        }
        let legacy = raw.replacen("{", "{\"previewReceipts\":[],", 1);
        assert_eq!(
            normalize_empty_root(legacy.as_bytes()).unwrap(),
            normalize_empty_root(raw.as_bytes()).unwrap()
        );
    }

    #[test]
    fn empty_roots_match_actual_ts_parser_bytes_and_hash() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-root.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let raw = fixture["rawJson"].as_str().unwrap();
            let bytes = normalize_empty_root(raw.as_bytes()).unwrap();
            assert_eq!(
                String::from_utf8(bytes.clone()).unwrap(),
                fixture["parsedJson"]
            );
            assert_eq!(
                format!("sha256:{:x}", Sha256::digest(&bytes)),
                fixture["hash"]
            );
        }
    }
}
