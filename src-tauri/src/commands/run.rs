use crate::commands::auth::{account_from_current_user, build_client};
use crate::error::AppError;
use crate::import::validation;
use crate::models::{RunReport, SessionState, StartRunRequest};
use crate::run_engine;
use crate::session::{AppState, SessionSnapshot};
use crate::vrchat::auth::AuthUserResponse;
use tauri::State;

#[tauri::command]
pub async fn start_block_run(
    state: State<'_, AppState>,
    mut request: StartRunRequest,
) -> Result<RunReport, String> {
    let summary = validation::validate_rows(&mut request.rows);
    if summary.invalid_uid + summary.empty_memo + summary.duplicate + summary.too_long > 0 {
        return Err("名单仍有未通过校验的条目，请先修正或跳过".to_string());
    }

    if request.dry_run {
        return Ok(run_engine::build_scaffold_report(request));
    }

    let settings = state.settings();
    let Some(snapshot) = state.load_session().map_err(|error| error.to_string())? else {
        return Err("请先登录 VRChat".to_string());
    };

    if snapshot.account.session_state == SessionState::Invalid {
        return Err("当前登录态无效，请重新登录 VRChat".to_string());
    }

    let client = build_client(settings.proxy.clone(), snapshot.cookies)
        .map_err(|error| error.to_string())?;
    let current_user = match client.current_user().await {
        Ok(response) => response.value,
        Err(error) if error.is_auth_error() => {
            return Err("当前登录态已失效，请重新登录 VRChat".to_string());
        }
        Err(error) => return Err(error.to_string()),
    };

    let account = match current_user {
        AuthUserResponse::CurrentUser(user) => account_from_current_user(user),
        AuthUserResponse::RequiresTwoFactor(_) => {
            return Err("当前会话需要两步验证，请重新登录 VRChat".to_string());
        }
    };

    request.account = Some(account.clone());
    let report = run_engine::execute_block_run(request, &client, &settings.retry_policy).await;

    state
        .save_session(&SessionSnapshot {
            account,
            cookies: client.cookie_snapshot(),
        })
        .map_err(|error| match error {
            AppError::Io(_) | AppError::Json(_) | AppError::Tauri(_) => error.to_string(),
            _ => error.to_string(),
        })?;

    Ok(report)
}
