use crate::error::{AppError, AppResult};
use crate::models::{AccountSession, LoginOutcome, LoginRequest, SessionState, TwoFactorRequest};
use crate::run_engine::now_rfc3339;
use crate::session::{AppState, PendingLogin, SessionSnapshot};
use crate::vrchat::auth::{AuthUserResponse, CurrentUser};
use crate::vrchat::client::{VrchatClient, VrchatClientConfig};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_session_status(state: State<'_, AppState>) -> Result<AccountSession, String> {
    let Some(snapshot) = state.load_session().map_err(|error| error.to_string())? else {
        return Ok(AccountSession {
            account_id: None,
            user_id: None,
            display_name: None,
            session_state: SessionState::Unknown,
            last_validated_at: None,
        });
    };

    let settings = state.settings();
    let client =
        build_client(settings.proxy, snapshot.cookies.clone()).map_err(|e| e.to_string())?;

    match client.current_user().await {
        Ok(response) => match response.value {
            AuthUserResponse::CurrentUser(user) => {
                let account = account_from_current_user(user);
                let refreshed = SessionSnapshot {
                    account: account.clone(),
                    cookies: client.cookie_snapshot(),
                };
                state
                    .save_session(&refreshed)
                    .map_err(|error| error.to_string())?;
                Ok(account)
            }
            AuthUserResponse::RequiresTwoFactor(_) => Ok(AccountSession {
                session_state: SessionState::RequiresTwoFactor,
                last_validated_at: Some(now_rfc3339()),
                ..snapshot.account
            }),
        },
        Err(error) if error.is_auth_error() => Ok(AccountSession {
            session_state: SessionState::Invalid,
            last_validated_at: Some(now_rfc3339()),
            ..snapshot.account
        }),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn login(
    state: State<'_, AppState>,
    request: LoginRequest,
) -> Result<LoginOutcome, String> {
    match login_inner(&state, request).await {
        Ok(outcome) => Ok(outcome),
        Err(error) => Ok(LoginOutcome::Failed {
            error: login_error_message(&error),
        }),
    }
}

#[tauri::command]
pub async fn verify_two_factor(
    state: State<'_, AppState>,
    request: TwoFactorRequest,
) -> Result<LoginOutcome, String> {
    match verify_two_factor_inner(&state, request).await {
        Ok(outcome) => Ok(outcome),
        Err(error) => Ok(LoginOutcome::Failed {
            error: login_error_message(&error),
        }),
    }
}

#[tauri::command]
pub async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_pending_logins();
    state.clear_session().map_err(|error| error.to_string())
}

async fn login_inner(state: &AppState, request: LoginRequest) -> AppResult<LoginOutcome> {
    let user_name_or_email = request.user_name_or_email.trim();
    if user_name_or_email.is_empty() {
        return Err(AppError::invalid_input("请输入 VRChat 用户名或邮箱"));
    }
    if request.password.is_empty() {
        return Err(AppError::invalid_input("请输入 VRChat 密码"));
    }

    let settings = state.settings();
    let proxy = request.proxy.unwrap_or(settings.proxy);
    let client = build_client(proxy, Vec::new())?;
    let response = client.login(user_name_or_email, &request.password).await?;

    complete_or_challenge(state, client, response.value)
}

async fn verify_two_factor_inner(
    state: &AppState,
    request: TwoFactorRequest,
) -> AppResult<LoginOutcome> {
    let code = request.code.trim();
    if code.is_empty() {
        return Err(AppError::invalid_input("请输入两步验证码"));
    }

    let Some(pending) = state.take_pending_login(&request.challenge_id) else {
        return Err(AppError::invalid_input("登录验证已过期，请重新登录"));
    };

    let response = pending
        .client
        .verify_two_factor(code.to_string(), pending.is_email_otp)
        .await?;
    if !response.value.verified {
        state.insert_pending_login(request.challenge_id, pending);
        return Err(AppError::invalid_input("验证码不正确"));
    }

    let current = pending.client.current_user().await?;
    complete_or_challenge(state, pending.client, current.value)
}

fn complete_or_challenge(
    state: &AppState,
    client: VrchatClient,
    auth_user: AuthUserResponse,
) -> AppResult<LoginOutcome> {
    match auth_user {
        AuthUserResponse::CurrentUser(user) => {
            let account = account_from_current_user(user);
            state.save_session(&SessionSnapshot {
                account: account.clone(),
                cookies: client.cookie_snapshot(),
            })?;
            state.clear_pending_logins();
            Ok(LoginOutcome::Completed { account })
        }
        AuthUserResponse::RequiresTwoFactor(required) => {
            let challenge_id = Uuid::new_v4().to_string();
            let is_email_otp = required
                .requires_two_factor_auth
                .iter()
                .any(|kind| kind.eq_ignore_ascii_case("emailOtp"));
            state.insert_pending_login(
                challenge_id.clone(),
                PendingLogin {
                    client,
                    is_email_otp,
                },
            );

            if is_email_otp {
                Ok(LoginOutcome::RequiresEmailOtp {
                    challenge_id,
                    message: Some("请输入 VRChat 邮件中的 6 位验证码".to_string()),
                })
            } else {
                Ok(LoginOutcome::RequiresTotp {
                    challenge_id,
                    message: Some("请输入验证器 App 中的 6 位验证码".to_string()),
                })
            }
        }
    }
}

pub fn build_client(
    proxy: crate::models::ProxyConfig,
    cookies: Vec<crate::session::StoredCookie>,
) -> AppResult<VrchatClient> {
    VrchatClient::new(VrchatClientConfig {
        user_agent: format!("vrc-blocker/{}", env!("CARGO_PKG_VERSION")),
        proxy,
        cookies,
    })
}

pub fn account_from_current_user(user: CurrentUser) -> AccountSession {
    AccountSession {
        account_id: Some(user.id.clone()),
        user_id: Some(user.id),
        display_name: Some(user.display_name),
        session_state: SessionState::Valid,
        last_validated_at: Some(now_rfc3339()),
    }
}

fn login_error_message(error: &AppError) -> String {
    match error.status_code() {
        Some(401) => {
            let text = error.to_string();
            if text.contains("somewhere new") || text.contains("Check your email") {
                "VRChat 要求新地点验证，请检查邮箱完成验证后再登录".to_string()
            } else {
                "VRChat 拒绝了用户名或密码".to_string()
            }
        }
        Some(403) => "VRChat 拒绝了当前登录请求，请检查网络环境或稍后再试".to_string(),
        Some(429) => "VRChat 正在限制登录请求，请稍后再试".to_string(),
        _ => error.to_string(),
    }
}
