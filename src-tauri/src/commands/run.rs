use crate::commands::auth::{account_from_current_user, build_client};
use crate::error::AppError;
use crate::import::validation;
use crate::models::{RunReport, SessionState, StartRunRequest};
use crate::run_engine::{self, retry_api};
use crate::session::{AppState, SessionSnapshot};
use crate::vrchat::auth::AuthUserResponse;
use crate::vrchat::client::VrchatClient;
use std::collections::HashSet;
use tauri::{AppHandle, Emitter, State};

pub const RUN_PROGRESS_EVENT: &str = "vrc-blocker-run-progress";

#[tauri::command]
pub async fn start_block_run(
    app: AppHandle,
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

    let friend_uids = if request.skip_friends {
        collect_friend_uids(&client, &settings.retry_policy).await
    } else {
        HashSet::new()
    };

    let report =
        run_engine::execute_block_run(request, &client, &settings.retry_policy, &friend_uids, {
            let app = app.clone();
            move |event| {
                let _ = app.emit(RUN_PROGRESS_EVENT, event);
            }
        })
        .await;

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

async fn collect_friend_uids(
    client: &VrchatClient,
    policy: &crate::models::RetryPolicy,
) -> HashSet<String> {
    let mut uids = HashSet::new();

    collect_friend_page_group(client, policy, false, &mut uids).await;
    collect_friend_page_group(client, policy, true, &mut uids).await;

    uids
}

async fn collect_friend_page_group(
    client: &VrchatClient,
    policy: &crate::models::RetryPolicy,
    offline: bool,
    uids: &mut HashSet<String>,
) {
    const PAGE_SIZE: usize = 100;

    let mut offset = 0;
    loop {
        let response = match retry_api(policy, || client.friends(offset, PAGE_SIZE, offline)).await
        {
            Ok((response, _attempts)) => response,
            Err(error) => {
                log::warn!(
                    "failed to fetch {} friends at offset {}: {}",
                    if offline { "offline" } else { "online" },
                    offset,
                    error
                );
                break;
            }
        };

        let friend_count = response.value.len();
        uids.extend(
            response
                .value
                .into_iter()
                .map(|friend| friend.id)
                .filter(|uid| uid.starts_with("usr_")),
        );

        if friend_count < PAGE_SIZE {
            break;
        }

        offset += PAGE_SIZE;
    }
}
