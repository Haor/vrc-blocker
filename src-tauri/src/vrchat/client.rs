use crate::error::{AppError, AppResult};
use crate::models::{ProxyConfig, ProxyMode};
use crate::session::StoredCookie;
use crate::vrchat::auth::{encode_vrchat_basic_auth_credential, AuthUserResponse};
use crate::vrchat::moderation::{PlayerModeration, PlayerModerationRequest};
use crate::vrchat::notes::{UserNoteRequest, UserNoteResponse};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, COOKIE, RETRY_AFTER, SET_COOKIE};
use reqwest::{Client, Method, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::{Arc, Mutex};

const VRCHAT_API_BASE: &str = "https://api.vrchat.cloud/api/1";
const VRCHAT_API_HOST: &str = "api.vrchat.cloud";

#[derive(Clone)]
pub struct VrchatClient {
    http: Client,
    base_url: String,
    cookies: Arc<Mutex<Vec<StoredCookie>>>,
}

#[derive(Debug, Clone)]
pub struct VrchatClientConfig {
    pub user_agent: String,
    pub proxy: ProxyConfig,
    pub cookies: Vec<StoredCookie>,
}

#[derive(Debug, Clone)]
pub struct ApiResponse<T> {
    pub value: T,
    pub status: u16,
}

impl VrchatClient {
    pub fn new(config: VrchatClientConfig) -> AppResult<Self> {
        let mut builder = Client::builder().user_agent(config.user_agent);

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
            cookies: Arc::new(Mutex::new(config.cookies)),
        })
    }

    pub fn anonymous(config: VrchatClientConfig) -> AppResult<Self> {
        Self::new(config)
    }

    pub fn cookie_snapshot(&self) -> Vec<StoredCookie> {
        self.cookies
            .lock()
            .map(|cookies| cookies.clone())
            .unwrap_or_default()
    }

    pub async fn login(
        &self,
        user_name_or_email: &str,
        password: &str,
    ) -> AppResult<ApiResponse<AuthUserResponse>> {
        let encoded_login = encode_vrchat_basic_auth_credential(user_name_or_email);
        let encoded_password = encode_vrchat_basic_auth_credential(password);
        let token = base64_encode(format!("{encoded_login}:{encoded_password}").as_bytes());
        self.request_json(
            Method::GET,
            "auth/user",
            None::<&serde_json::Value>,
            Some(format!("Basic {token}")),
        )
        .await
    }

    pub async fn current_user(&self) -> AppResult<ApiResponse<AuthUserResponse>> {
        self.get("auth/user").await
    }

    pub async fn user(&self, uid: &str) -> AppResult<ApiResponse<Value>> {
        self.get(&format!("users/{uid}")).await
    }

    pub async fn verify_two_factor(
        &self,
        code: String,
        is_email_otp: bool,
    ) -> AppResult<ApiResponse<VerifyTwoFactorResponse>> {
        let path = if is_email_otp {
            "auth/twofactorauth/emailotp/verify"
        } else {
            "auth/twofactorauth/totp/verify"
        };
        self.post(path, &VerifyTwoFactorRequest { code }).await
    }

    pub async fn overwrite_user_note(
        &self,
        target_user_id: String,
        note: String,
    ) -> AppResult<ApiResponse<UserNoteResponse>> {
        self.post(
            "userNotes",
            &UserNoteRequest {
                target_user_id,
                note,
            },
        )
        .await
    }

    pub async fn user_notes(
        &self,
        offset: usize,
        n: usize,
    ) -> AppResult<ApiResponse<Vec<UserNoteResponse>>> {
        self.get(&format!("userNotes?offset={offset}&n={n}")).await
    }

    pub async fn block_user(&self, uid: String) -> AppResult<ApiResponse<PlayerModeration>> {
        self.post(
            "auth/user/playermoderations",
            &PlayerModerationRequest::block(uid),
        )
        .await
    }

    pub async fn player_moderations(&self) -> AppResult<ApiResponse<Vec<PlayerModeration>>> {
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

    async fn get<T: DeserializeOwned>(&self, path: &str) -> AppResult<ApiResponse<T>> {
        self.request_json(Method::GET, path, None::<&serde_json::Value>, None)
            .await
    }

    async fn post<TBody: serde::Serialize, TResponse: DeserializeOwned>(
        &self,
        path: &str,
        body: &TBody,
    ) -> AppResult<ApiResponse<TResponse>> {
        self.request_json(Method::POST, path, Some(body), None)
            .await
    }

    async fn request_json<TBody, TResponse>(
        &self,
        method: Method,
        path: &str,
        body: Option<&TBody>,
        authorization: Option<String>,
    ) -> AppResult<ApiResponse<TResponse>>
    where
        TBody: serde::Serialize,
        TResponse: DeserializeOwned,
    {
        let mut request = self.http.request(method, self.endpoint(path));

        if let Some(cookie_header) = self.cookie_header() {
            request = request.header(COOKIE, cookie_header);
        }

        if let Some(authorization) = authorization {
            request = request.header(AUTHORIZATION, authorization);
        }

        if let Some(body) = body {
            request = request.json(body);
        }

        let response = request.send().await?;
        let status = response.status();
        let headers = response.headers().clone();
        self.apply_response_cookies(&headers);
        let retry_after_ms = retry_after_ms(headers.get(RETRY_AFTER));
        let text = response.text().await?;

        if status.is_success() {
            let value = serde_json::from_str::<TResponse>(&text)?;
            return Ok(ApiResponse {
                value,
                status: status.as_u16(),
            });
        }

        Err(AppError::http_status(
            status.as_u16(),
            api_error_message(&text),
            retry_after_ms,
        ))
    }

    fn endpoint(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.base_url.trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    fn cookie_header(&self) -> Option<String> {
        let cookies = self.cookies.lock().ok()?;
        let header = cookies
            .iter()
            .filter(|cookie| cookie_matches_host(cookie, VRCHAT_API_HOST))
            .filter(|cookie| !cookie.name.is_empty() && !cookie.value.is_empty())
            .map(|cookie| format!("{}={}", cookie.name, cookie.value))
            .collect::<Vec<_>>()
            .join("; ");

        if header.is_empty() {
            None
        } else {
            Some(header)
        }
    }

    fn apply_response_cookies(&self, headers: &HeaderMap) {
        let mut cookies = match self.cookies.lock() {
            Ok(cookies) => cookies,
            Err(_) => return,
        };

        for header in headers.get_all(SET_COOKIE).iter() {
            let Ok(value) = header.to_str() else {
                continue;
            };
            apply_set_cookie(&mut cookies, value);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDisposition {
    RateLimited,
    Transient,
    Auth,
    Permanent,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTwoFactorRequest {
    pub code: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTwoFactorResponse {
    pub verified: bool,
}

fn cookie_matches_host(cookie: &StoredCookie, host: &str) -> bool {
    let domain = cookie.domain.trim_start_matches('.').to_ascii_lowercase();
    let host = host.to_ascii_lowercase();
    domain == host || host.ends_with(&format!(".{domain}"))
}

fn apply_set_cookie(cookies: &mut Vec<StoredCookie>, header: &str) {
    let mut parts = header.split(';');
    let Some(name_value) = parts.next() else {
        return;
    };
    let Some((name, value)) = name_value.split_once('=') else {
        return;
    };

    let name = name.trim();
    if name.is_empty() {
        return;
    }

    let mut next = StoredCookie::new(name, value.trim());
    let mut expired = false;

    for part in parts {
        let attr = part.trim();
        let attr_lower = attr.to_ascii_lowercase();
        if attr_lower == "secure" {
            next.secure = true;
        } else if attr_lower == "httponly" {
            next.http_only = true;
        } else if let Some(value) = attr.strip_prefix_case_insensitive("domain=") {
            next.domain = value.trim().trim_start_matches('.').to_string();
        } else if let Some(value) = attr.strip_prefix_case_insensitive("path=") {
            next.path = value.trim().to_string();
        } else if let Some(value) = attr.strip_prefix_case_insensitive("max-age=") {
            expired = value.trim() == "0";
        } else if let Some(value) = attr.strip_prefix_case_insensitive("expires=") {
            expired = value.to_ascii_lowercase().contains("1970");
        }
    }

    cookies.retain(|cookie| {
        !(cookie.name == next.name && cookie.domain == next.domain && cookie.path == next.path)
    });

    if !expired {
        cookies.push(next);
    }
}

trait StripPrefixCaseInsensitive {
    fn strip_prefix_case_insensitive<'a>(&'a self, prefix: &str) -> Option<&'a str>;
}

impl StripPrefixCaseInsensitive for str {
    fn strip_prefix_case_insensitive<'a>(&'a self, prefix: &str) -> Option<&'a str> {
        if self.len() >= prefix.len() && self[..prefix.len()].eq_ignore_ascii_case(prefix) {
            Some(&self[prefix.len()..])
        } else {
            None
        }
    }
}

fn retry_after_ms(value: Option<&HeaderValue>) -> Option<u64> {
    let value = value?.to_str().ok()?.trim();
    value.parse::<u64>().ok().map(|seconds| seconds * 1_000)
}

fn api_error_message(text: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return if text.trim().is_empty() {
            "empty error response".to_string()
        } else {
            text.trim().to_string()
        };
    };

    if let Some(error) = value.get("error") {
        if let Some(message) = error.get("message").and_then(|message| message.as_str()) {
            return message.trim_matches('"').to_string();
        }
        if let Some(message) = error.as_str() {
            return message.trim_matches('"').to_string();
        }
    }

    if let Some(message) = value.get("message").and_then(|message| message.as_str()) {
        return message.to_string();
    }

    value.to_string()
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);

        out.push(TABLE[(b0 >> 2) as usize] as char);
        out.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            out.push('=');
        }
    }

    out
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

    #[test]
    fn parses_set_cookie_headers() {
        let mut cookies = Vec::new();
        apply_set_cookie(
            &mut cookies,
            "auth=abc123; Path=/; Domain=api.vrchat.cloud; HttpOnly; Secure",
        );
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].name, "auth");
        assert_eq!(cookies[0].value, "abc123");

        apply_set_cookie(
            &mut cookies,
            "auth=deleted; Path=/; Domain=api.vrchat.cloud; Max-Age=0",
        );
        assert!(cookies.is_empty());
    }

    #[test]
    fn encodes_basic_auth_without_external_dependency() {
        assert_eq!(base64_encode(b"hello:world"), "aGVsbG86d29ybGQ=");
    }
}
