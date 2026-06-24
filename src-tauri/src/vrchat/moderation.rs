use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerModerationRequest {
    pub moderated: String,
    #[serde(rename = "type")]
    pub moderation_type: PlayerModerationType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlayerModerationType {
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerModeration {
    pub id: Option<String>,
    pub moderated: Option<String>,
    #[serde(rename = "type")]
    pub moderation_type: Option<String>,
}

impl PlayerModerationRequest {
    pub fn block(uid: impl Into<String>) -> Self {
        Self {
            moderated: uid.into(),
            moderation_type: PlayerModerationType::Block,
        }
    }
}
