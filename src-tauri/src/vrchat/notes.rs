use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteRequest {
    pub target_user_id: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserNoteResponse {
    pub id: Option<String>,
    pub target_user_id: Option<String>,
    pub note: Option<String>,
}
