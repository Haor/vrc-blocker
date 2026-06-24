use serde::{Deserialize, Serialize};

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

pub fn encode_vrchat_basic_auth_credential(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_basic_auth_credentials_for_vrchat() {
        assert_eq!(
            encode_vrchat_basic_auth_credential("name@example.com"),
            "name%40example.com"
        );
        assert_eq!(encode_vrchat_basic_auth_credential("a b"), "a+b");
    }
}
