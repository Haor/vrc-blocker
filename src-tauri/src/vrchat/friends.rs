use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_friend_from_vrchat_response_shape() {
        let friend: Friend = serde_json::from_str(
            r#"{
                "id": "usr_00000000-0000-4000-8000-000000000001",
                "displayName": "Friend Name",
                "statusDescription": "hello"
            }"#,
        )
        .expect("friend response should deserialize with only id");

        assert_eq!(friend.id, "usr_00000000-0000-4000-8000-000000000001");
    }
}
