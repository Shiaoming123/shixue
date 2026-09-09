//! Ordered calendar entity subset. Other entity groups remain fail-closed.
use super::{valid_timestamp, Json};
use chrono::{Datelike, NaiveDate};
use serde_json::Value;
const INVALID: &str = "WORKSPACE_CALENDAR_INVALID";
pub(super) fn whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
fn err<T>() -> Result<T, String> {
    Err(INVALID.into())
}
pub(super) fn text(v: &Json) -> Result<&str, String> {
    if let Json::String(s) = v {
        Ok(s)
    } else {
        err()
    }
}
pub(super) fn get<'a>(v: &'a Json, key: &str) -> Result<&'a Json, String> {
    if let Json::Object(fields) = v {
        fields
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v)
            .ok_or(INVALID.into())
    } else {
        err()
    }
}
fn date(s: &str) -> bool {
    s.len() == 10
        && s.is_ascii()
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[7] == b'-'
        && s[..4] >= *"0100"
        && NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == s)
}
fn local(s: &str) -> bool {
    s.len() == 16
        && s.is_ascii()
        && date(&s[..10])
        && chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").is_ok()
}
fn zone(s: &str) -> bool {
    if matches!(s, "UTC" | "Etc/UTC" | "Etc/GMT" | "Asia/Shanghai") {
        return true;
    }
    let (prefix, max) = if s.starts_with("Etc/GMT+") {
        ("Etc/GMT+", 12)
    } else if s.starts_with("Etc/GMT-") {
        ("Etc/GMT-", 14)
    } else {
        return false;
    };
    s[prefix.len()..]
        .parse::<u32>()
        .is_ok_and(|n| n <= max && n.to_string() == s[prefix.len()..])
}
pub(super) fn fields(raw: Json, schema: &[(&str, &str)]) -> Result<Json, String> {
    let Json::Object(mut input) = raw else {
        return err();
    };
    let mut output = Vec::new();
    for (key, spec) in schema {
        let optional = spec.starts_with('?');
        let spec = spec.trim_start_matches('?');
        let Some(i) = input.iter().position(|(k, _)| k == key) else {
            if optional {
                continue;
            }
            return err();
        };
        output.push((key.to_string(), checked(input.remove(i).1, spec)?));
    }
    if !input.is_empty() {
        return Err("WORKSPACE_UNKNOWN_FIELD".into());
    }
    Ok(Json::Object(output))
}
fn checked(v: Json, spec: &str) -> Result<Json, String> {
    if let Json::String(s) = &v {
        if s.encode_utf16().count() > 100_000 {
            return err();
        }
    }
    if let Some(inner) = spec.strip_prefix('~') {
        return if v == Json::Null {
            Ok(v)
        } else {
            checked(v, inner)
        };
    }
    if let Some(inner) = spec.strip_prefix("[]") {
        let Json::Array(items) = v else {
            return err();
        };
        if items.len() > 100_000 {
            return err();
        }
        return items
            .into_iter()
            .map(|item| checked(item, inner))
            .collect::<Result<Vec<_>, _>>()
            .map(Json::Array);
    }
    let valid = match spec {
        "text" | "empty" => {
            text(&v).is_ok_and(|s| spec == "empty" || !s.trim_matches(whitespace).is_empty())
        }
        "number" => matches!(v,Json::Number(n) if n > 0.0 && n.fract() == 0.0),
        "nonnegative" => matches!(v,Json::Number(n) if n >= 0.0 && n.fract() == 0.0),
        "bool" => matches!(v, Json::Bool(_)),
        "stamp" => text(&v).is_ok_and(valid_timestamp),
        "date" => text(&v).is_ok_and(date),
        "local" => text(&v).is_ok_and(local),
        "zone" => text(&v).is_ok_and(zone),
        "color" => text(&v).is_ok_and(|s| {
            s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
        }),
        "url" => text(&v).is_ok_and(|s| {
            reqwest::Url::parse(s).is_ok_and(|u| {
                matches!(u.scheme(), "http" | "https")
                    && u.username().is_empty()
                    && u.password().is_none()
            })
        }),
        "email" => text(&v).is_ok_and(|s| {
            s.split('@').count() == 2
                && !s.starts_with('@')
                && !s.ends_with('@')
                && !s.chars().any(whitespace)
        }),
        "person" => return fields(v, &[("name", "empty"), ("email", "email")]),
        "attendee" => {
            return fields(
                v,
                &[
                    ("name", "empty"),
                    ("email", "email"),
                    ("role", "required|optional"),
                    ("response", "unknown|accepted|declined|tentative"),
                ],
            )
        }
        "time" => return time(v),
        "recurrence" => {
            return fields(
                v,
                &[
                    ("cadence", "cadence"),
                    ("end", "end"),
                    ("exceptions", "[]exception"),
                ],
            )
        }
        "exception" => return fields(v, &[("originalStart", "text"), ("time", "~time")]),
        "cadence" => return cadence(v),
        "end" => {
            return match text(get(&v, "kind")?)? {
                "never" => fields(v, &[("kind", "never")]),
                "on" => fields(v, &[("kind", "on"), ("date", "date")]),
                "after" => fields(v, &[("kind", "after"), ("count", "number")]),
                _ => err(),
            }
        }
        "weekday" => matches!(v,Json::Number(n) if (0.0..=6.0).contains(&n) && n.fract() == 0.0),
        _ => text(&v).is_ok_and(|s| spec.split('|').any(|allowed| allowed == s)),
    };
    if valid {
        Ok(v)
    } else {
        err()
    }
}
fn time(raw: Json) -> Result<Json, String> {
    let kind = text(get(&raw, "kind")?)?;
    let (schema, a, b): (&[(&str, &str)], &str, &str) = match kind {
        "all-day" => (
            &[
                ("kind", "all-day"),
                ("startOn", "date"),
                ("endOnExclusive", "date"),
            ],
            "startOn",
            "endOnExclusive",
        ),
        "floating" => (
            &[
                ("kind", "floating"),
                ("startLocal", "local"),
                ("endLocal", "local"),
            ],
            "startLocal",
            "endLocal",
        ),
        "fixed" => (
            &[
                ("kind", "fixed"),
                ("startAt", "stamp"),
                ("endAt", "stamp"),
                ("timezone", "zone"),
            ],
            "startAt",
            "endAt",
        ),
        _ => return err(),
    };
    let start = text(get(&raw, a)?)?;
    let end = text(get(&raw, b)?)?;
    let ordered = if kind == "fixed" {
        chrono::DateTime::parse_from_rfc3339(start)
            .ok()
            .zip(chrono::DateTime::parse_from_rfc3339(end).ok())
            .is_some_and(|(s, e)| e.timestamp_millis() > s.timestamp_millis())
    } else {
        end > start
    };
    if !ordered {
        return err();
    }
    fields(raw, schema)
}
fn cadence(raw: Json) -> Result<Json, String> {
    let schema: &[(&str, &str)] = match text(get(&raw, "kind")?)? {
        "daily" => &[("kind", "daily"), ("interval", "number")],
        "weekly" => &[
            ("kind", "weekly"),
            ("interval", "number"),
            ("weekdays", "[]weekday"),
        ],
        "monthly" => &[
            ("kind", "monthly"),
            ("interval", "number"),
            ("dayOfMonth", "number"),
        ],
        "yearly" => &[
            ("kind", "yearly"),
            ("interval", "number"),
            ("month", "number"),
            ("dayOfMonth", "number"),
        ],
        _ => return err(),
    };
    let result = fields(raw, schema)?;
    for (key, max) in [("month", 12.0), ("dayOfMonth", 31.0)] {
        if let Ok(Json::Number(n)) = get(&result, key) {
            if *n > max {
                return err();
            }
        }
    }
    if let Ok(Json::Array(days)) = get(&result, "weekdays") {
        if days.is_empty() || days.iter().enumerate().any(|(i, d)| days[..i].contains(d)) {
            return err();
        }
    }
    Ok(result)
}
pub(super) fn collection(name: &str, raw: Json) -> Result<Json, String> {
    let Json::Array(items) = raw else {
        return err();
    };
    if items.len() > 100_000 {
        return err();
    }
    items
        .into_iter()
        .map(|item| {
            if name == "calendarSources" {
                fields(
                    item,
                    &[
                        ("id", "text"),
                        ("revision", "number"),
                        ("provider", "local|google|feishu|ics"),
                        ("title", "text"),
                        ("color", "color"),
                        ("group", "~text"),
                        ("permission", "read|write"),
                        ("selected", "bool"),
                        ("hidden", "bool"),
                        ("timezone", "zone"),
                        ("createdAt", "stamp"),
                        ("updatedAt", "stamp"),
                        ("archivedAt", "~stamp"),
                    ],
                )
            } else {
                let mut event = fields(
                    item,
                    &[
                        ("id", "text"),
                        ("revision", "number"),
                        ("sourceId", "text"),
                        ("title", "text"),
                        ("notes", "empty"),
                        ("location", "empty"),
                        ("meetingUrl", "~url"),
                        ("sourceUrl", "?~url"),
                        ("organizer", "~person"),
                        ("attendees", "[]attendee"),
                        ("availability", "busy|free"),
                        ("status", "confirmed|tentative|cancelled"),
                        ("time", "time"),
                        ("recurrence", "~recurrence"),
                        ("createdAt", "stamp"),
                        ("updatedAt", "stamp"),
                        ("deletedAt", "~stamp"),
                    ],
                )?;
                let mut emails = std::collections::HashSet::new();
                if let Json::Array(attendees) = get(&event, "attendees")? {
                    for a in attendees {
                        if !emails.insert(text(get(a, "email")?)?.to_lowercase()) {
                            return err();
                        }
                    }
                }
                validate_recurrence(&mut event)?;
                Ok(event)
            }
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Json::Array)
}
fn validate_recurrence(event: &mut Json) -> Result<(), String> {
    if get(event, "recurrence")? == &Json::Null {
        return Ok(());
    }
    let value: Value = serde_json::from_str(&event.encode()?).map_err(|_| INVALID)?;
    let kind = value["time"]["kind"].as_str().ok_or(INVALID)?;
    if kind == "fixed" {
        let anchor =
            chrono::DateTime::parse_from_rfc3339(value["time"]["startAt"].as_str().ok_or(INVALID)?)
                .map_err(|_| INVALID)?
                .timestamp_millis();
        // TS applies a signed epoch remainder; negative sub-minute anchors are unsupported.
        if anchor < 0 && anchor % 60_000 != 0 {
            return Err("WORKSPACE_RECURRENCE_UNSUPPORTED".into());
        }
    }
    let mut originals = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for exception in value["recurrence"]["exceptions"]
        .as_array()
        .ok_or(INVALID)?
    {
        let start = exception["originalStart"].as_str().ok_or(INVALID)?;
        let start = match kind {
            "all-day" if date(start) => start.to_string(),
            "floating" if local(start) => start.to_string(),
            "fixed" if valid_timestamp(start) => chrono::DateTime::parse_from_rfc3339(start)
                .map_err(|_| INVALID)?
                .to_utc()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            _ => return err(),
        };
        if !seen.insert(start.clone())
            || (!exception["time"].is_null() && exception["time"]["kind"] != kind)
            || !occurs(&value, &start)?
        {
            return err();
        }
        originals.push(start);
    }
    if let Json::Object(fields) = event {
        if let Some((_, Json::Object(recurrence))) =
            fields.iter_mut().find(|(k, _)| k == "recurrence")
        {
            if let Some((_, Json::Array(exceptions))) =
                recurrence.iter_mut().find(|(k, _)| k == "exceptions")
            {
                for (exception, start) in exceptions.iter_mut().zip(originals) {
                    if let Json::Object(fields) = exception {
                        fields[0].1 = Json::String(start);
                    }
                }
            }
        }
    }
    Ok(())
}
fn occurs(event: &Value, original: &str) -> Result<bool, String> {
    let time = &event["time"];
    let wall = |value: &str| -> Option<(NaiveDate, String)> {
        if time["kind"] == "fixed" {
            super::super::write_local::projection::wall(time, value)
                .map(|(d, t)| (d, t.unwrap().format("%H:%M:%S%.3f").to_string()))
        } else {
            Some((
                NaiveDate::parse_from_str(value.get(..10)?, "%Y-%m-%d").ok()?,
                value.get(10..)?.to_string(),
            ))
        }
    };
    let anchor_str = time["startAt"]
        .as_str()
        .or(time["startOn"].as_str())
        .or(time["startLocal"].as_str())
        .ok_or(INVALID)?;
    let (anchor, clock) = wall(anchor_str).ok_or(INVALID)?;
    // Shared native wall helper uses UTC+8; historical Shanghai DST is unsupported.
    if time["timezone"] == "Asia/Shanghai" && anchor.year() < 1992 {
        return Err("WORKSPACE_TIMEZONE_UNSUPPORTED".into());
    }
    let (target, target_clock) = wall(original).ok_or(INVALID)?;
    if clock != target_clock {
        return Ok(false);
    }
    let recurrence = &event["recurrence"];
    let cadence = &recurrence["cadence"];
    let end = &recurrence["end"];
    let interval = cadence["interval"].as_f64().ok_or(INVALID)?;
    let mut weekdays: Vec<u32> = cadence["weekdays"]
        .as_array()
        .map(|days| {
            days.iter()
                .map(|day| {
                    (day.as_u64().unwrap() as u32 + 7 - anchor.weekday().num_days_from_sunday()) % 7
                })
                .collect()
        })
        .unwrap_or_default();
    weekdays.sort();
    let mut count = 0.0;
    // ponytail: at most 10,000 candidates per exception, shared traversal if large series matter.
    for offset in 0..=10_000 {
        if end["kind"] == "after" && count >= end["count"].as_f64().ok_or(INVALID)? {
            return Ok(false);
        }
        let n = offset as f64;
        let next = match cadence["kind"].as_str().ok_or(INVALID)? {
            "daily" => anchor.checked_add_days(chrono::Days::new((n * interval) as u64)),
            "weekly" => anchor.checked_add_days(chrono::Days::new(
                (((offset / weekdays.len()) as f64 * interval * 7.0) as u64)
                    .checked_add(weekdays[offset % weekdays.len()] as u64)
                    .ok_or(INVALID)?,
            )),
            kind => {
                let months = if kind == "monthly" {
                    n * interval
                } else {
                    n * interval * 12.0 + cadence["month"].as_f64().ok_or(INVALID)?
                        - anchor.month() as f64
                };
                let total = anchor.year() as f64 * 12.0 + anchor.month0() as f64 + months;
                if !(1200.0..120000.0).contains(&total) {
                    return err();
                }
                let year = (total / 12.0).floor() as i32;
                let month = total as u32 % 12 + 1;
                (1..=cadence["dayOfMonth"].as_u64().ok_or(INVALID)? as u32)
                    .rev()
                    .find_map(|day| NaiveDate::from_ymd_opt(year, month, day))
            }
        }
        .ok_or(INVALID)?;
        if next > target
            || (end["kind"] == "on"
                && next.format("%Y-%m-%d").to_string().as_str()
                    > end["date"].as_str().ok_or(INVALID)?)
        {
            return Ok(false);
        }
        if offset == 10_000 {
            return err();
        }
        if next < anchor {
            continue;
        }
        count += 1.0;
        if next == target {
            return Ok(true);
        }
    }
    err()
}
pub(super) fn references(root: &Json) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    let mut sources = std::collections::HashSet::new();
    for key in ["calendarSources", "calendarEvents"] {
        if let Json::Array(items) = get(root, key)? {
            for item in items {
                let id = text(get(item, "id")?)?;
                if !ids.insert(id) {
                    return err();
                }
                if key == "calendarSources" {
                    sources.insert(id);
                } else if !sources.contains(text(get(item, "sourceId")?)?) {
                    return err();
                }
            }
        }
    }
    Ok(())
}
