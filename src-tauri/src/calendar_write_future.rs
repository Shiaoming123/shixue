//! Frozen TypeScript future records. Validation never authorizes a provider mutation.
use super::*;
fn shape(value: &Value, required: &[&str], optional: &[&str]) -> Result<(), String> {
    let map = value.as_object().ok_or("OUTBOX_INVALID")?;
    if required.iter().any(|key| !map.contains_key(*key))
        || map
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err("OUTBOX_INVALID".into());
    }
    Ok(())
}
pub(crate) fn validate(preview: &Value, state: &Value) -> Result<(), String> {
    let intent = &preview["intent"];
    shape(
        intent,
        &["kind", "parent", "originalStart", "fields", "plan"],
        &[],
    )?;
    shape(&intent["fields"], &["title"], &[])?;
    text_field(&intent["fields"], "title")?;
    let plan = &intent["plan"];
    shape(
        plan,
        &[
            "version",
            "workspaceHash",
            "originalParent",
            "pivot",
            "originalStart",
            "exceptions",
            "markerHash",
            "parent",
            "successor",
            "compensation",
        ],
        &[],
    )?;
    if plan["version"] != 1
        || plan["exceptions"] != json!([])
        || !plan["originalParent"].is_object()
        || plan["originalStart"] != intent["originalStart"]
    {
        return Err("OUTBOX_INVALID".into());
    }
    for key in ["workspaceHash", "originalStart", "markerHash"] {
        text_field(plan, key)?;
    }
    for reference in [&intent["parent"], &plan["pivot"]] {
        shape(reference, &["eventId", "etag"], &[])?;
        text_field(reference, "eventId")?;
        text_field(reference, "etag")?;
    }
    shape(state, &["parent", "successor", "compensation"], &[])?;
    for name in ["parent", "successor", "compensation"] {
        let step = &plan[name];
        shape(step, &["eventId", "etag", "body"], &[])?;
        text_field(step, "eventId")?;
        if !step["body"].is_object()
            || (name == "parent" && step["etag"] != intent["parent"]["etag"])
            || (name != "parent" && !step["etag"].is_null())
        {
            return Err("OUTBOX_INVALID".into());
        }
        let phase = &state[name];
        shape(phase, &["state"], &["outcomeUnknown", "etag", "proof"])?;
        if ![
            "pending", "applying", "unknown", "proved", "rejected", "conflict",
        ]
        .contains(&text_field(phase, "state")?)
            || phase.get("outcomeUnknown").is_some_and(|v| !v.is_boolean())
            || phase.get("proof").is_some_and(|v| !v.is_object())
        {
            return Err("OUTBOX_INVALID".into());
        }
        if phase.get("etag").is_some() {
            text_field(phase, "etag")?;
        }
    }
    let child = format!("m{}", text_field(preview, "operationId")?.replace('-', ""));
    let mut locks = vec![
        text_field(&plan["parent"], "eventId")?,
        text_field(&plan["pivot"], "eventId")?,
        text_field(&plan["successor"], "eventId")?,
    ];
    locks.sort();
    if locks.windows(2).any(|v| v[0] == v[1])
        || preview["lockKeys"] != json!(locks)
        || plan["parent"]["eventId"] != intent["parent"]["eventId"]
        || preview["eventId"] != plan["parent"]["eventId"]
        || plan["compensation"]["eventId"] != plan["parent"]["eventId"]
        || plan["successor"]["eventId"] != child
        || plan["successor"]["body"]["id"] != child
    {
        return Err("OUTBOX_INVALID".into());
    }
    Ok(())
}
