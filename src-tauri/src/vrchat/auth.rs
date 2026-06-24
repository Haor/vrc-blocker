use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUser {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorRequired {
    pub requires_two_factor_auth: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthUserResponse {
    CurrentUser(CurrentUser),
    RequiresTwoFactor(TwoFactorRequired),
}

impl<'de> Deserialize<'de> for AuthUserResponse {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        if value.get("requiresTwoFactorAuth").is_some() {
            return Ok(Self::RequiresTwoFactor(
                serde_json::from_value(value).map_err(serde::de::Error::custom)?,
            ));
        }

        Ok(Self::CurrentUser(
            serde_json::from_value(value).map_err(serde::de::Error::custom)?,
        ))
    }
}

pub fn encode_vrchat_basic_auth_credential(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => encoded.push(*byte as char),
            byte => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_basic_auth_credentials_like_encode_uri_component() {
        assert_eq!(
            encode_vrchat_basic_auth_credential("name@example.com"),
            "name%40example.com"
        );
        assert_eq!(encode_vrchat_basic_auth_credential("a b"), "a%20b");
        assert_eq!(
            encode_vrchat_basic_auth_credential("日本語"),
            "%E6%97%A5%E6%9C%AC%E8%AA%9E"
        );
    }

    #[test]
    fn deserializes_two_factor_response() {
        let parsed: AuthUserResponse =
            serde_json::from_str(r#"{"requiresTwoFactorAuth":["totp"]}"#).unwrap();
        match parsed {
            AuthUserResponse::RequiresTwoFactor(required) => {
                assert_eq!(required.requires_two_factor_auth, vec!["totp"]);
            }
            AuthUserResponse::CurrentUser(_) => panic!("expected two-factor response"),
        }
    }
}
