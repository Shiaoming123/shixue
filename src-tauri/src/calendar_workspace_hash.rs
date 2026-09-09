use serde_json::Value;
use sha2::{Digest, Sha256};

/// Same JSON value encoding as capabilities/service.ts canonicalJson: RFC 8785,
/// including ECMAScript number formatting and UTF-16 object-key ordering.
pub(super) fn fingerprint(workspace: &Value) -> Result<String, String> {
    let bytes = canonical(workspace)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn canonical(value: &Value) -> Result<String, String> {
    serde_json_canonicalizer::to_string(value).map_err(|_| "WRITE_WORKSPACE_HASH_INVALID".into())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_numeric_boundaries_and_utf16_keys_match_golden_bytes() {
        for (input, expected) in [
            (
                r#"[1.0,1,-0,1e-7,1e-6,1e20,1e21]"#,
                "[1,1,0,1e-7,0.000001,100000000000000000000,1e+21]",
            ),
            (
                r#"{"\ue000":1.0,"😀":1e-7,"a":1e21,"z":0.000001}"#,
                "{\"a\":1e+21,\"z\":0.000001,\"😀\":1e-7,\"\u{e000}\":1}",
            ),
            (
                r#"[333333333.33333329,4.50,2e-3,1e-27]"#,
                "[333333333.3333333,4.5,0.002,1e-27]",
            ),
            (
                r#"{"slash":"/","line":"\n","control":"\u000f","text":"中文😀"}"#,
                r#"{"control":"\u000f","line":"\n","slash":"/","text":"中文😀"}"#,
            ),
        ] {
            let value: Value = serde_json::from_str(input).unwrap();
            assert_eq!(canonical(&value).unwrap(), expected);
            assert_eq!(
                fingerprint(&value).unwrap(),
                format!("sha256:{:x}", Sha256::digest(expected.as_bytes()))
            );
        }
    }

    #[test]
    fn actual_migrated_workspace_matches_javascript_hash_and_content_changes_do_not() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-workspace-hash-v4.json"
        ))
        .unwrap();
        let mut workspace = fixture["state"].clone();
        assert_eq!(workspace["version"], 4);
        assert_eq!(
            fingerprint(&workspace).unwrap(),
            fixture["hash"].as_str().unwrap()
        );
        workspace["calendarSources"][0]["title"] =
            Value::String("Changed while revision and timestamp stay identical".into());
        assert_ne!(
            fingerprint(&workspace).unwrap(),
            fixture["hash"].as_str().unwrap()
        );
    }
}

// Contract harness only: the native V4 parser must first construct this exact
// ordered value. Never use raw SQLite JSON as evidence of attachment clearance.
#[cfg(test)]
mod future_hash_contract {
    use super::*;
    use serde::de::{self, Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
    use std::fmt;

    struct Encoded(String);
    impl<'de> Deserialize<'de> for Encoded {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            struct JsonVisitor;
            impl<'de> Visitor<'de> for JsonVisitor {
                type Value = Encoded;
                fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                    f.write_str("ordered JSON")
                }
                fn visit_unit<E: de::Error>(self) -> Result<Encoded, E> {
                    Ok(Encoded("null".into()))
                }
                fn visit_bool<E: de::Error>(self, value: bool) -> Result<Encoded, E> {
                    Ok(Encoded(value.to_string()))
                }
                fn visit_str<E: de::Error>(self, value: &str) -> Result<Encoded, E> {
                    Ok(Encoded(serde_json::to_string(value).map_err(E::custom)?))
                }
                fn visit_i64<E: de::Error>(self, value: i64) -> Result<Encoded, E> {
                    self.visit_f64(value as f64)
                }
                fn visit_u64<E: de::Error>(self, value: u64) -> Result<Encoded, E> {
                    self.visit_f64(value as f64)
                }
                fn visit_f64<E: de::Error>(self, value: f64) -> Result<Encoded, E> {
                    Ok(Encoded(canonical(&Value::from(value)).map_err(E::custom)?))
                }
                fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Encoded, A::Error> {
                    let mut values = Vec::new();
                    while let Some(Encoded(value)) = seq.next_element()? {
                        values.push(value);
                    }
                    Ok(Encoded(format!("[{}]", values.join(","))))
                }
                fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Encoded, A::Error> {
                    let mut values = Vec::new();
                    let mut seen = std::collections::HashSet::new();
                    while let Some((key, Encoded(value))) = map.next_entry::<String, Encoded>()? {
                        if !seen.insert(key.clone()) {
                            return Err(de::Error::custom("duplicate JSON key"));
                        }
                        let index = key
                            .parse::<u32>()
                            .ok()
                            .filter(|n| *n != u32::MAX && n.to_string() == key);
                        values.push((
                            index,
                            format!(
                                "{}:{value}",
                                serde_json::to_string(&key).map_err(de::Error::custom)?
                            ),
                        ));
                    }
                    // Stable sorting retains insertion order for ordinary keys.
                    values.sort_by_key(|(index, _)| index.map(u64::from).unwrap_or(u64::MAX));
                    Ok(Encoded(format!(
                        "{{{}}}",
                        values
                            .into_iter()
                            .map(|(_, value)| value)
                            .collect::<Vec<_>>()
                            .join(",")
                    )))
                }
            }
            deserializer.deserialize_any(JsonVisitor)
        }
    }

    #[test]
    fn future_parsed_workspace_matches_ts_stringify_not_canonical_hash() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/calendar-future-workspace-hash.json"
        ))
        .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let expected = fixture["parsedJson"].as_str().unwrap();
            let Encoded(encoded) = serde_json::from_str(expected).unwrap();
            assert_eq!(encoded, expected);
            let hash = format!("sha256:{:x}", Sha256::digest(encoded.as_bytes()));
            assert_eq!(hash, fixture["hash"]);
            assert_ne!(
                fingerprint(&serde_json::from_str(expected).unwrap()).unwrap(),
                hash
            );
            assert_ne!(
                format!(
                    "sha256:{:x}",
                    Sha256::digest(expected.replace("hash-contract", "tampered").as_bytes())
                ),
                hash
            );
            assert_eq!(
                fixture["raw"]["commandReceipts"][0].get("requestFingerprint"),
                None
            );
            let parsed: Value = serde_json::from_str(expected).unwrap();
            assert_eq!(
                parsed["commandReceipts"][0]["requestFingerprint"],
                Value::Null
            );
        }
        let Encoded(encoded) =
            serde_json::from_str(r#"{"z":-0,"10":1.0,"2":1e20,"a":1e-7}"#).unwrap();
        assert_eq!(
            encoded,
            r#"{"2":100000000000000000000,"10":1,"z":0,"a":1e-7}"#
        );
        assert!(serde_json::from_str::<Encoded>(r#"{"x":1,"x":2}"#).is_err());
    }
}
