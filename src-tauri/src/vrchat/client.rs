use crate::error::AppResult;
use crate::models::{ProxyConfig, ProxyMode};
use crate::vrchat::auth::CurrentUser;
use crate::vrchat::moderation::{PlayerModeration, PlayerModerationRequest};
use crate::vrchat::notes::{UserNoteRequest, UserNoteResponse};
use reqwest::{Client, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;

const VRCHAT_API_BASE: &str = "https://api.vrchat.cloud/api/1";

#[derive(Clone)]
pub struct VrchatClient {
    http: Client,
    base_url: String,
}

#[derive(Debug, Clone)]
pub struct VrchatClientConfig {
    pub user_agent: String,
    pub proxy: ProxyConfig,
}

impl VrchatClient {
    pub fn new(config: VrchatClientConfig) -> AppResult<Self> {
        let mut builder = Client::builder()
            .cookie_store(true)
            .user_agent(config.user_agent);

        match config.proxy.mode {
            ProxyMode::System => {}
            ProxyMode::Direct => {
                builder = builder.no_proxy();
            }
            ProxyMode::Custom => {
                if let Some(proxy_url) = config.proxy.url.as_deref() {
                    builder = builder.proxy(reqwest::Proxy::all(proxy_url)?);
                }
            }
        }

        Ok(Self {
            http: builder.build()?,
            base_url: VRCHAT_API_BASE.to_string(),
        })
    }

    pub async fn current_user(&self) -> AppResult<CurrentUser> {
        self.get("auth/user").await
    }

    pub async fn user(&self, uid: &str) -> AppResult<Value> {
        self.get(&format!("users/{uid}")).await
    }

    pub async fn overwrite_user_note(
        &self,
        target_user_id: String,
        note: String,
    ) -> AppResult<UserNoteResponse> {
        self.post(
            "userNotes",
            &UserNoteRequest {
                target_user_id,
                note,
            },
        )
        .await
    }

    pub async fn block_user(&self, uid: String) -> AppResult<PlayerModeration> {
        self.post(
            "auth/user/playermoderations",
            &PlayerModerationRequest::block(uid),
        )
        .await
    }

    pub async fn player_moderations(&self) -> AppResult<Vec<PlayerModeration>> {
        self.get("auth/user/playermoderations").await
    }

    pub fn classify_retry(status: StatusCode) -> RetryDisposition {
        if status == StatusCode::TOO_MANY_REQUESTS {
            RetryDisposition::RateLimited
        } else if status.is_server_error() {
            RetryDisposition::Transient
        } else if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            RetryDisposition::Auth
        } else {
            RetryDisposition::Permanent
        }
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> AppResult<T> {
        Ok(self
            .http
            .get(self.endpoint(path))
            .send()
            .await?
            .error_for_status()?
            .json::<T>()
            .await?)
    }

    async fn post<TBody: serde::Serialize, TResponse: DeserializeOwned>(
        &self,
        path: &str,
        body: &TBody,
    ) -> AppResult<TResponse> {
        Ok(self
            .http
            .post(self.endpoint(path))
            .json(body)
            .send()
            .await?
            .error_for_status()?
            .json::<TResponse>()
            .await?)
    }

    fn endpoint(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDisposition {
    RateLimited,
    Transient,
    Auth,
    Permanent,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_http_retry_disposition() {
        assert_eq!(
            VrchatClient::classify_retry(StatusCode::TOO_MANY_REQUESTS),
            RetryDisposition::RateLimited
        );
        assert_eq!(
            VrchatClient::classify_retry(StatusCode::BAD_GATEWAY),
            RetryDisposition::Transient
        );
        assert_eq!(
            VrchatClient::classify_retry(StatusCode::BAD_REQUEST),
            RetryDisposition::Permanent
        );
    }
}
