//! Remote evidence only. This is not a FutureSnapshot or an authorization to prepare/send.
use super::*;

pub(super) struct RemoteEvidence {
    pub(super) parent: Value,
    pub(super) pivot: Value,
}

pub(super) async fn read<H: Http>(
    http: &H,
    calendar: &str,
    parent_ref: &Value,
    original_start: &str,
) -> Result<RemoteEvidence, String> {
    exact(parent_ref, &["eventId", "etag"])?;
    let id = field(parent_ref, "eventId")?;
    field(parent_ref, "etag")?;
    field(&json!({"value":calendar}), "value")?;
    field(&json!({"value":original_start}), "value")?;
    let directory_path = format!("users/me/calendarList/{}", segment(calendar));
    let directory = get(http, &directory_path).await?;
    if directory["id"] != calendar
        || !matches!(directory["accessRole"].as_str(), Some("owner" | "writer"))
    {
        return Err("WRITE_PERMISSION".into());
    }
    let base = format!("calendars/{}/events", segment(calendar));
    let parent_path = format!("{base}/{}", segment(id));
    let parent = get(http, &parent_path).await?;
    if parent["id"] != id
        || parent["etag"] != parent_ref["etag"]
        || parent["recurrence"]
            .as_array()
            .is_none_or(|v| v.is_empty() || v.iter().any(|r| r.as_str().is_none_or(str::is_empty)))
    {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let events = pages(
        http,
        &base,
        &[("singleEvents", "false"), ("showDeleted", "true")],
    )
    .await?;
    if events.iter().find(|event| event["id"] == id) != Some(&parent)
        || events.iter().any(|event| event["recurringEventId"] == id)
    {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let instances = pages(
        http,
        &format!("{parent_path}/instances"),
        &[("originalStart", original_start), ("showDeleted", "true")],
    )
    .await?;
    if instances.len() != 1 {
        return Err("WRITE_UNSUPPORTED".into());
    }
    let pivot = &instances[0];
    field(pivot, "etag")?;
    let original = &pivot["originalStartTime"];
    if pivot["id"] == id
        || pivot["recurringEventId"] != id
        || original.get("date").or_else(|| original.get("dateTime")) != Some(&json!(original_start))
        || pivot["status"] == "cancelled"
        || get(http, &parent_path).await? != parent
        || get(http, &directory_path).await? != directory
    {
        return Err("WRITE_UNSUPPORTED".into());
    }
    http.check_future_session()?;
    Ok(RemoteEvidence {
        parent,
        pivot: pivot.clone(),
    })
}

async fn get<H: Http>(http: &H, path: &str) -> Result<Value, String> {
    http.check_future_session()?;
    let response = http.call("GET", path, None, None, None).await?;
    http.check_future_session()?;
    if response.status != 200 || !response.body.is_object() {
        return Err("WRITE_READ_FAILED".into());
    }
    Ok(response.body)
}

async fn pages<H: Http>(
    http: &H,
    path: &str,
    query: &[(&str, &str)],
) -> Result<Vec<Value>, String> {
    let mut items = Vec::new();
    let mut ids = std::collections::HashSet::new();
    let mut tokens = std::collections::HashSet::new();
    let mut token: Option<String> = None;
    // ponytail: bounded full reads; larger calendars need a separately proved snapshot protocol.
    for _ in 0..100 {
        let mut url = Url::parse(&format!("{API}{path}")).map_err(|_| "WRITE_INVALID")?;
        url.query_pairs_mut()
            .extend_pairs(query.iter().copied())
            .append_pair("maxResults", "250");
        if let Some(token) = &token {
            url.query_pairs_mut().append_pair("pageToken", token);
        }
        let body = get(http, url.as_str().strip_prefix(API).ok_or("WRITE_INVALID")?).await?;
        for item in body["items"].as_array().ok_or("WRITE_UNSUPPORTED")? {
            let id = field(item, "id")?;
            if item.get("recurringEventId").is_some() || item.get("originalStartTime").is_some() {
                field(item, "recurringEventId")?;
            }
            if !ids.insert(id.to_owned()) || items.len() >= 25_000 {
                return Err("WRITE_UNSUPPORTED".into());
            }
            items.push(item.clone());
        }
        if body.get("nextPageToken").is_none() {
            return Ok(items);
        }
        let next = field(&body, "nextPageToken")?.to_owned();
        if !tokens.insert(next.clone()) {
            return Err("WRITE_UNSUPPORTED".into());
        }
        token = Some(next);
    }
    Err("WRITE_UNSUPPORTED".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    struct Fake {
        replies: RefCell<Vec<Value>>,
        calls: Cell<usize>,
        drift: usize,
    }
    impl Http for Fake {
        fn check_future_session(&self) -> Result<(), String> {
            if self.calls.get() >= self.drift {
                return Err("DISCONNECTED".into());
            }
            Ok(())
        }
        async fn call(
            &self,
            method: &str,
            path: &str,
            etag: Option<&str>,
            send: Option<&str>,
            body: Option<Value>,
        ) -> Result<HttpReply, String> {
            assert_eq!(method, "GET");
            assert!(etag.is_none() && send.is_none() && body.is_none());
            let index = self.calls.get();
            self.calls.set(index + 1);
            if index == 2 {
                assert!(path.contains("singleEvents=false&showDeleted=true&maxResults=250"));
            }
            let reply = self.replies.borrow_mut().remove(0);
            Ok(HttpReply {
                status: reply["testStatus"].as_u64().unwrap_or(200) as u16,
                body: reply,
            })
        }
    }
    fn fixture() -> (Value, Value, Vec<Value>) {
        let parent = json!({"id":"parent","etag":"p1","recurrence":["RRULE:FREQ=DAILY;COUNT=10"]});
        let pivot = json!({"id":"pivot","etag":"i1","recurringEventId":"parent","originalStartTime":{"date":"2026-09-04"}});
        let calendar = json!({"id":"cal","accessRole":"owner"});
        let replies = vec![
            calendar.clone(),
            parent.clone(),
            json!({"items":[parent.clone()],"nextPageToken":"two"}),
            json!({"items":[]}),
            json!({"items":[pivot.clone()]}),
            parent.clone(),
            calendar,
        ];
        (parent, pivot, replies)
    }
    fn run(replies: Vec<Value>, drift: usize) -> Result<RemoteEvidence, String> {
        tokio::runtime::Runtime::new().unwrap().block_on(read(
            &Fake {
                replies: RefCell::new(replies),
                calls: Cell::new(0),
                drift,
            },
            "cal",
            &json!({"eventId":"parent","etag":"p1"}),
            "2026-09-04",
        ))
    }
    #[test]
    fn complete_remote_evidence_is_read_only() {
        let (parent, pivot, replies) = fixture();
        let result = run(replies, usize::MAX).unwrap();
        assert_eq!(result.parent, parent);
        assert_eq!(result.pivot, pivot);
    }
    #[test]
    fn remote_evidence_rejects_missing_malformed_divergent_and_exceptional_pages() {
        let (parent, pivot, replies) = fixture();
        for (index, value) in [
            (0, json!({"id":"other","accessRole":"owner"})),
            (0, json!({"id":"cal","accessRole":"reader"})),
            (1, json!({"id":"parent","etag":"wrong"})),
            (2, json!({})),
            (2, json!({"items":{}})),
            (2, json!({"items":[null]})),
            (2, json!({"items":[],"nextPageToken":null})),
            (2, json!({"items":[]})),
            (3, json!({"items":[parent]})),
            (3, json!({"items":[pivot]})),
            (3, json!({"items":[],"nextPageToken":"two"})),
            (
                3,
                json!({"items":[{"id":"bad","originalStartTime":{"date":"2026-09-04"}}]}),
            ),
            (3, json!({"items":[{"id":"bad","recurringEventId":[]}]})),
            (4, json!({"items":[]})),
            (
                4,
                json!({"items":[{"id":"pivot","etag":"i1","recurringEventId":"other","originalStartTime":{"date":"2026-09-04"}}]}),
            ),
            (5, json!({"id":"parent","etag":"changed"})),
            (6, json!({"id":"cal","accessRole":"reader"})),
        ] {
            let mut changed = replies.clone();
            changed[index] = value;
            assert!(
                run(changed, usize::MAX).is_err(),
                "accepted variant {index}"
            );
        }
        for drift in 0..=7 {
            assert!(run(replies.clone(), drift).is_err());
        }
        for index in 0..7 {
            for bad in [
                Value::Null,
                json!([]),
                json!({"testStatus":403}),
                json!({"testStatus":500}),
            ] {
                let mut changed = replies.clone();
                changed[index] = bad;
                assert!(run(changed, usize::MAX).is_err());
            }
        }
        for (key, value) in [
            ("id", json!("parent")),
            ("etag", json!("")),
            ("etag", json!("i\n1")),
            ("status", json!("cancelled")),
            ("originalStartTime", json!({"date":"2026-09-05"})),
        ] {
            let mut changed = replies.clone();
            changed[4]["items"][0][key] = value;
            assert!(run(changed, usize::MAX).is_err());
        }
    }

    #[test]
    fn remote_pages_enforce_both_resource_bounds() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for replies in [
            (0..100)
                .map(|i| json!({"items":[],"nextPageToken":format!("p{i}")}))
                .collect(),
            vec![
                json!({"items":(0..25_001).map(|i|json!({"id":format!("e{i}")})).collect::<Vec<_>>()}),
            ],
        ] {
            let http = Fake {
                replies: RefCell::new(replies),
                calls: Cell::new(0),
                drift: usize::MAX,
            };
            assert!(runtime
                .block_on(pages(
                    &http,
                    "calendars/cal/events",
                    &[("singleEvents", "false"), ("showDeleted", "true")]
                ))
                .is_err());
        }
    }
}
