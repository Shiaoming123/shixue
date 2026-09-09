//! Internal request/proof contract harness; no execute or provider transport wiring.
use super::*;

pub(super) fn request(preview: &Value, name: &str, mutate: bool) -> Result<Value, String> {
    if !["parent", "successor"].contains(&name) || preview["intent"]["kind"] != "recurring.future" {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let mut content = preview.clone();
    content
        .as_object_mut()
        .ok_or("WRITE_INVALID")?
        .remove("hash");
    if preview["hash"] != workspace_hash::fingerprint(&content)? {
        return Err("WRITE_PREVIEW_CHANGED".into());
    }
    write_outbox::future::validate(
        preview,
        &json!({"parent":{"state":"pending"},"successor":{"state":"pending"},"compensation":{"state":"pending"}}),
    )?;
    if !["all", "externalOnly", "none"].contains(&field(preview, "sendUpdates")?) {
        return Err("WRITE_INVALID".into());
    }
    let step = &preview["intent"]["plan"][name];
    let path = format!(
        "/calendar/v3/calendars/{}/events",
        component(field(preview, "calendarId")?)
    );
    if !mutate {
        return Ok(
            json!({"method":"GET","path":format!("{path}/{}", component(field(step,"eventId")?)),"headers":{},"query":{}}),
        );
    }
    Ok(
        json!({"method":if name == "successor" {"POST"} else {"PATCH"},"path":if name == "successor" {path} else {format!("{path}/{}",component(field(step,"eventId")?))},"headers":if name == "successor" {json!({})} else {json!({"If-Match":field(step,"etag")?})},"query":{"sendUpdates":preview["sendUpdates"]},"body":step["body"]}),
    )
}
pub(super) fn restore_request(preview: &Value, etag: &str) -> Result<Value, String> {
    if etag.is_empty() || etag.contains(['\r', '\n']) {
        return Err("WRITE_INVALID".into());
    }
    let mut request = request(preview, "parent", true)?;
    request["body"] = preview["intent"]["plan"]["compensation"]["body"].clone();
    request["headers"]["If-Match"] = json!(etag);
    Ok(request)
}
// encodeURIComponent contract; URL path encoding leaves reserved characters unescaped.
fn component(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
pub(super) fn response(
    preview: &Value,
    name: &str,
    mutate: bool,
    status: u16,
    body: &Value,
) -> Value {
    if request(
        preview,
        if name == "compensation" {
            "parent"
        } else {
            name
        },
        mutate,
    )
    .is_err()
    {
        return json!({"kind":"conflict"});
    }
    if mutate {
        return json!({"kind":match status {409 | 412 => "conflict", 400 | 401 | 403 | 404 | 422 | 429 => "rejected", _ => "unknown"}});
    }
    if status == 404 || status == 410 {
        return json!({"kind":"conflict"});
    }
    if status != 200 {
        return json!({"kind":"unknown"});
    }
    if proved(preview, name, body) {
        json!({"kind":"proved","proof":body})
    } else {
        json!({"kind":"conflict"})
    }
}
fn proved(preview: &Value, name: &str, body: &Value) -> bool {
    let plan = &preview["intent"]["plan"];
    let step = &plan[name];
    if !body.is_object()
        || body["id"] != step["eventId"]
        || body["etag"]
            .as_str()
            .is_none_or(|s| s.is_empty() || s.contains(['\r', '\n']))
        || body["extendedProperties"]["private"]["meowOperationId"] != preview["operationId"]
        || body["extendedProperties"]["private"]["meowOperationHash"] != plan["markerHash"]
        || body.get("recurringEventId").is_some()
        || body["status"] == "cancelled"
    {
        return false;
    }
    let mut expected = json!({"status":"confirmed","eventType":"default"});
    if name != "successor" {
        expected
            .as_object_mut()
            .unwrap()
            .extend(plan["originalParent"].as_object().unwrap().clone());
    }
    expected
        .as_object_mut()
        .unwrap()
        .extend(step["body"].as_object().unwrap().clone());
    let mut actual = json!({"status":"confirmed","eventType":"default"});
    actual
        .as_object_mut()
        .unwrap()
        .extend(body.as_object().unwrap().clone());
    for value in [&mut actual, &mut expected] {
        for key in [
            "etag", "created", "updated", "sequence", "kind", "htmlLink", "iCalUID",
        ] {
            value.as_object_mut().unwrap().remove(key);
        }
    }
    actual == expected
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_future_step_matches_actual_typescript_requests_and_proofs() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-step.json"
        ))
        .unwrap();
        let rows = fixture["rows"].as_array().unwrap();
        for row in rows {
            let preview = &fixture["previews"][row["previewIndex"].as_u64().unwrap() as usize];
            let name = row["step"].as_str().unwrap();
            let mutate = row["action"] == "mutate";
            assert_eq!(
                request(preview, name, mutate).unwrap(),
                row["request"],
                "{}",
                row["name"]
            );
            assert_eq!(
                response(
                    preview,
                    name,
                    mutate,
                    row["status"].as_u64().unwrap() as u16,
                    &row["body"]
                ),
                row["expected"],
                "{}",
                row["name"]
            );
        }
        assert!(request(&fixture["previews"][0], "compensation", true).is_err());
        let mut changed = fixture["previews"][0].clone();
        changed["sendUpdates"] = json!("none");
        assert!(request(&changed, "parent", true).is_err());
    }
}
