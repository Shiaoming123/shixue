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
