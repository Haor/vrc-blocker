use crate::models::AccountSession;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub account: AccountSession,
    pub cookie_service_key: Option<String>,
}

pub const SESSION_KEYRING_SERVICE: &str = "dev.harukishiina.vrc-blocker.vrchat-session";
