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
    pub target_user_id: Option<String>,
    pub source_user_id: Option<String>,
    #[serde(rename = "type")]
    pub moderation_type: Option<String>,
}

impl PlayerModeration {
    pub fn target_uid(&self) -> Option<&str> {
        self.target_user_id.as_deref().or(self.moderated.as_deref())
    }

    pub fn is_block(&self) -> bool {
        self.moderation_type
            .as_deref()
            .is_some_and(|moderation_type| moderation_type.eq_ignore_ascii_case("block"))
    }
}

impl PlayerModerationRequest {
    pub fn block(uid: impl Into<String>) -> Self {
        Self {
            moderated: uid.into(),
            moderation_type: PlayerModerationType::Block,
        }
    }
}
