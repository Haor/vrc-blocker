use crate::error::AppResult;
use crate::models::{AccountSession, AppSettings};
use crate::vrchat::client::VrchatClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const SESSION_KEYRING_SERVICE: &str = "dev.harukishiina.vrc-blocker.vrchat-session";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub account: AccountSession,
    pub cookies: Vec<StoredCookie>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
}

impl StoredCookie {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            domain: "api.vrchat.cloud".to_string(),
            path: "/".to_string(),
            secure: true,
            http_only: true,
        }
    }
}

#[derive(Clone)]
pub struct PendingLogin {
    pub client: VrchatClient,
    pub is_email_otp: bool,
}

pub struct AppState {
    session_path: PathBuf,
    settings: Mutex<AppSettings>,
    pending_logins: Mutex<HashMap<String, PendingLogin>>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        Ok(Self {
            session_path: app_data_dir.join("vrchat-session.json"),
            settings: Mutex::new(AppSettings::default()),
            pending_logins: Mutex::new(HashMap::new()),
        })
    }

    pub fn load_session(&self) -> AppResult<Option<SessionSnapshot>> {
        read_session_snapshot(&self.session_path)
    }

    pub fn save_session(&self, snapshot: &SessionSnapshot) -> AppResult<()> {
        write_session_snapshot(&self.session_path, snapshot)
    }

    pub fn clear_session(&self) -> AppResult<()> {
        match std::fs::remove_file(&self.session_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn settings(&self) -> AppSettings {
        self.settings
            .lock()
            .map(|settings| settings.clone())
            .unwrap_or_else(|_| AppSettings::default())
    }

    pub fn save_settings(&self, settings: AppSettings) -> AppSettings {
        if let Ok(mut current) = self.settings.lock() {
            *current = settings.clone();
        }
        settings
    }

    pub fn insert_pending_login(&self, challenge_id: String, pending: PendingLogin) {
        if let Ok(mut pending_logins) = self.pending_logins.lock() {
            pending_logins.insert(challenge_id, pending);
        }
    }

    pub fn take_pending_login(&self, challenge_id: &str) -> Option<PendingLogin> {
        self.pending_logins
            .lock()
            .ok()
            .and_then(|mut pending_logins| pending_logins.remove(challenge_id))
    }

    pub fn clear_pending_logins(&self) {
        if let Ok(mut pending_logins) = self.pending_logins.lock() {
            pending_logins.clear();
        }
    }
}

fn read_session_snapshot(path: &Path) -> AppResult<Option<SessionSnapshot>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(serde_json::from_str(&text)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn write_session_snapshot(path: &Path, snapshot: &SessionSnapshot) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(snapshot)?;
    std::fs::write(path, text)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_cookie_defaults_to_vrchat_api_scope() {
        let cookie = StoredCookie::new("auth", "token");
        assert_eq!(cookie.domain, "api.vrchat.cloud");
        assert_eq!(cookie.path, "/");
        assert!(cookie.secure);
        assert!(cookie.http_only);
    }
}
