use crate::models::{
    OperationResult, RetryPolicy, RunItemResult, RunItemStatus, RunProgressEvent, RunProgressPhase,
    RunReport, RunSummary, StartRunRequest,
};
use crate::vrchat::client::{ApiResponse, VrchatClient};
use crate::vrchat::moderation::PlayerModeration;
use crate::vrchat::notes::UserNoteResponse;
use serde::de::DeserializeOwned;
use std::collections::HashSet;
use std::future::Future;
use std::time::Duration;
use time::OffsetDateTime;
use tokio::time::sleep;
use uuid::Uuid;

pub fn build_scaffold_report(request: StartRunRequest) -> RunReport {
    let started_at = now_rfc3339();
    let mut summary = RunSummary {
        total: request.rows.len(),
        ..RunSummary::default()
    };

    let items = request
        .rows
        .into_iter()
        .map(|row| {
            if row.skip {
                summary.skipped += 1;
                return RunItemResult {
                    row_index: row.row_index,
                    uid: row.uid,
                    memo: row.normalized_memo,
                    status: RunItemStatus::Skipped,
                    note: None,
                    block: None,
                    attempts: 0,
                    error: None,
                };
            }

            if request.dry_run {
                summary.success += 1;
                return RunItemResult {
                    row_index: row.row_index,
                    uid: row.uid,
                    memo: row.normalized_memo,
                    status: RunItemStatus::Success,
                    note: Some(OperationResult {
                        action: "would_overwrite".to_string(),
                        verified: false,
                        http_status: None,
                        message: Some("dry run only".to_string()),
                    }),
                    block: Some(OperationResult {
                        action: "would_block".to_string(),
                        verified: false,
                        http_status: None,
                        message: Some("dry run only".to_string()),
                    }),
                    attempts: 0,
                    error: None,
                };
            }

            summary.failed += 1;
            RunItemResult {
                row_index: row.row_index,
                uid: row.uid,
                memo: row.normalized_memo,
                status: RunItemStatus::Failed,
                note: None,
                block: None,
                attempts: 0,
                error: Some(
                    "network execution is not implemented in this scaffold yet".to_string(),
                ),
            }
        })
        .collect();

    RunReport {
        schema_version: "vrc-blocker.report.v1".to_string(),
        run_id: Uuid::new_v4().to_string(),
        manifest_name: request.manifest_name,
        account: request.account,
        started_at,
        finished_at: Some(now_rfc3339()),
        summary,
        items,
    }
}

pub async fn execute_block_run<F>(
    request: StartRunRequest,
    client: &VrchatClient,
    policy: &RetryPolicy,
    mut on_progress: F,
) -> RunReport
where
    F: FnMut(RunProgressEvent),
{
    if request.dry_run {
        return build_scaffold_report(request);
    }

    let started_at = now_rfc3339();
    let run_id = Uuid::new_v4().to_string();
    let manifest_name = request.manifest_name.clone();
    let account = request.account.clone();
    let rows = request.rows;
    let total = rows.len();
    let mut items = Vec::with_capacity(rows.len());
    let mut stop_error: Option<String> = None;

    on_progress(started_event(&run_id, total));

    let moderation_fetch = retry_api(policy, || client.player_moderations()).await;
    let mut blocked = match moderation_fetch {
        Ok((response, _attempts)) => blocked_uid_set(&response.value),
        Err(error) => {
            let message = format!("读取当前 block 列表失败：{error}");
            for row in rows {
                let item = failed_item(
                    row.row_index,
                    row.uid,
                    row.normalized_memo,
                    message.clone(),
                    1,
                );
                on_progress(item_event(&run_id, total, items.len() + 1, item.clone()));
                items.push(item);
            }
            let report = finish_report(manifest_name, account, started_at, run_id, items);
            on_progress(finished_event(&report));
            return report;
        }
    };

    for row in rows {
        if row.skip {
            let item = RunItemResult {
                row_index: row.row_index,
                uid: row.uid,
                memo: row.normalized_memo,
                status: RunItemStatus::Skipped,
                note: None,
                block: None,
                attempts: 0,
                error: None,
            };
            on_progress(item_event(&run_id, total, items.len() + 1, item.clone()));
            items.push(item);
            continue;
        }

        if let Some(error) = stop_error.as_ref() {
            let item = failed_item(
                row.row_index,
                row.uid,
                row.normalized_memo,
                format!("任务已停止，未执行：{error}"),
                0,
            );
            on_progress(item_event(&run_id, total, items.len() + 1, item.clone()));
            items.push(item);
            continue;
        }

        let row_index = row.row_index;
        let uid = row.uid;
        let memo = row.normalized_memo;
        let already_blocked_before = blocked.contains(&uid);

        let item = execute_one(
            client,
            policy,
            row_index,
            uid.clone(),
            memo.clone(),
            already_blocked_before,
            &mut blocked,
        )
        .await;

        if item.error.as_deref().is_some_and(|error| {
            error.contains("401") || error.contains("403") || error.contains("认证")
        }) {
            stop_error = item.error.clone();
        }

        on_progress(item_event(&run_id, total, items.len() + 1, item.clone()));
        items.push(item);
        sleep(normal_item_delay(row_index)).await;
    }

    let report = finish_report(manifest_name, account, started_at, run_id, items);
    on_progress(finished_event(&report));
    report
}

fn started_event(run_id: &str, total: usize) -> RunProgressEvent {
    RunProgressEvent {
        phase: RunProgressPhase::Started,
        run_id: run_id.to_string(),
        total,
        done: 0,
        item: None,
        summary: None,
        message: Some("run started".to_string()),
    }
}

fn item_event(run_id: &str, total: usize, done: usize, item: RunItemResult) -> RunProgressEvent {
    RunProgressEvent {
        phase: RunProgressPhase::Item,
        run_id: run_id.to_string(),
        total,
        done,
        item: Some(item),
        summary: None,
        message: None,
    }
}

fn finished_event(report: &RunReport) -> RunProgressEvent {
    RunProgressEvent {
        phase: RunProgressPhase::Finished,
        run_id: report.run_id.clone(),
        total: report.summary.total,
        done: report.summary.total,
        item: None,
        summary: Some(report.summary.clone()),
        message: Some("run finished".to_string()),
    }
}

async fn execute_one(
    client: &VrchatClient,
    policy: &RetryPolicy,
    row_index: usize,
    uid: String,
    memo: String,
    already_blocked_before: bool,
    blocked: &mut HashSet<String>,
) -> RunItemResult {
    let mut attempts = 0;

    let note = match retry_api(policy, || {
        client.overwrite_user_note(uid.clone(), memo.clone())
    })
    .await
    {
        Ok((response, note_attempts)) => {
            attempts += note_attempts;

            let (note_verified, verify_status, verify_attempts, note_message) =
                verify_user_note(client, policy, &uid, &memo, &response).await;
            attempts += verify_attempts;

            Some(OperationResult {
                action: "overwrite_user_note".to_string(),
                verified: note_verified,
                http_status: verify_status.or(Some(response.status)),
                message: note_message.or_else(|| {
                    Some(if note_verified {
                        "备注已读回验证".to_string()
                    } else {
                        "userNotes 未读回目标备注，已继续 block".to_string()
                    })
                }),
            })
        }
        Err(error) => {
            attempts += 1;
            let note = Some(OperationResult {
                action: "overwrite_user_note".to_string(),
                verified: false,
                http_status: error.status_code(),
                message: Some(format!("备注写入失败，已继续 block：{error}")),
            });

            if error.is_auth_error() {
                return RunItemResult {
                    row_index,
                    uid,
                    memo,
                    status: RunItemStatus::Failed,
                    note,
                    block: None,
                    attempts,
                    error: Some(error.to_string()),
                };
            };

            note
        }
    };

    if already_blocked_before {
        return RunItemResult {
            row_index,
            uid,
            memo,
            status: RunItemStatus::AlreadyBlocked,
            note,
            block: Some(OperationResult {
                action: "already_blocked".to_string(),
                verified: true,
                http_status: None,
                message: Some("执行前已在 block 列表中，已覆盖备注".to_string()),
            }),
            attempts,
            error: None,
        };
    }

    let block_post = retry_api(policy, || client.block_user(uid.clone())).await;
    match block_post {
        Ok((response, block_attempts)) => {
            attempts += block_attempts;
            verify_block_after_post(
                client,
                policy,
                row_index,
                uid,
                memo,
                note,
                attempts,
                response.status,
                blocked,
            )
            .await
        }
        Err(error) => {
            attempts += 1;
            if let Ok((response, verify_attempts)) =
                retry_api(policy, || client.player_moderations()).await
            {
                attempts += verify_attempts;
                if blocked_uid_set(&response.value).contains(&uid) {
                    blocked.insert(uid.clone());
                    return RunItemResult {
                        row_index,
                        uid,
                        memo,
                        status: RunItemStatus::AlreadyBlocked,
                        note,
                        block: Some(OperationResult {
                            action: "verify_block_after_error".to_string(),
                            verified: true,
                            http_status: Some(response.status),
                            message: Some(format!(
                                "block 请求返回错误，但验证到目标已被屏蔽：{error}"
                            )),
                        }),
                        attempts,
                        error: None,
                    };
                }
            }

            RunItemResult {
                row_index,
                uid,
                memo,
                status: RunItemStatus::FailedBlockAfterNote,
                note,
                block: Some(OperationResult {
                    action: "block".to_string(),
                    verified: false,
                    http_status: error.status_code(),
                    message: Some(error.to_string()),
                }),
                attempts,
                error: Some(error.to_string()),
            }
        }
    }
}

async fn verify_block_after_post(
    client: &VrchatClient,
    policy: &RetryPolicy,
    row_index: usize,
    uid: String,
    memo: String,
    note: Option<OperationResult>,
    mut attempts: u32,
    block_status: u16,
    blocked: &mut HashSet<String>,
) -> RunItemResult {
    match retry_api(policy, || client.player_moderations()).await {
        Ok((response, verify_attempts)) => {
            attempts += verify_attempts;
            let next_blocked = blocked_uid_set(&response.value);
            if next_blocked.contains(&uid) {
                blocked.extend(next_blocked);
                RunItemResult {
                    row_index,
                    uid,
                    memo,
                    status: RunItemStatus::Success,
                    note,
                    block: Some(OperationResult {
                        action: "block".to_string(),
                        verified: true,
                        http_status: Some(response.status),
                        message: Some("block 已验证".to_string()),
                    }),
                    attempts,
                    error: None,
                }
            } else {
                RunItemResult {
                    row_index,
                    uid,
                    memo,
                    status: RunItemStatus::FailedBlockAfterNote,
                    note,
                    block: Some(OperationResult {
                        action: "block".to_string(),
                        verified: false,
                        http_status: Some(block_status),
                        message: Some("block 请求成功，但读回列表未验证到目标".to_string()),
                    }),
                    attempts,
                    error: Some("block 请求成功，但验证失败".to_string()),
                }
            }
        }
        Err(error) => RunItemResult {
            row_index,
            uid,
            memo,
            status: RunItemStatus::FailedBlockAfterNote,
            note,
            block: Some(OperationResult {
                action: "block".to_string(),
                verified: false,
                http_status: error.status_code().or(Some(block_status)),
                message: Some(format!("block 后验证失败：{error}")),
            }),
            attempts: attempts + 1,
            error: Some(error.to_string()),
        },
    }
}

async fn retry_api<T, Fut, F>(
    policy: &RetryPolicy,
    mut operation: F,
) -> Result<(ApiResponse<T>, u32), crate::error::AppError>
where
    T: DeserializeOwned,
    Fut: Future<Output = crate::error::AppResult<ApiResponse<T>>>,
    F: FnMut() -> Fut,
{
    let mut attempt = 0;
    loop {
        attempt += 1;
        match operation().await {
            Ok(response) => return Ok((response, attempt)),
            Err(error) => {
                let Some(delay_ms) = retry_delay_for_error(policy, attempt, &error) else {
                    return Err(error);
                };
                sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }
}

fn retry_delay_for_error(
    policy: &RetryPolicy,
    failed_attempt: u32,
    error: &crate::error::AppError,
) -> Option<u64> {
    if error.is_auth_error() {
        return None;
    }

    match error.status_code() {
        Some(429) => next_delay_ms(policy, failed_attempt, error.retry_after_ms()),
        Some(status) if (500..=599).contains(&status) => {
            next_delay_ms(policy, failed_attempt, None)
        }
        Some(_) => None,
        None => next_delay_ms(policy, failed_attempt, None),
    }
}

fn blocked_uid_set(moderations: &[PlayerModeration]) -> HashSet<String> {
    moderations
        .iter()
        .filter(|moderation| moderation.is_block())
        .filter_map(|moderation| moderation.target_uid().map(ToOwned::to_owned))
        .collect()
}

async fn verify_user_note(
    client: &VrchatClient,
    policy: &RetryPolicy,
    uid: &str,
    memo: &str,
    post_response: &ApiResponse<UserNoteResponse>,
) -> (bool, Option<u16>, u32, Option<String>) {
    if user_note_response_matches(&post_response.value, uid, memo) {
        return (
            true,
            Some(post_response.status),
            0,
            Some("userNotes 写入响应已验证".to_string()),
        );
    }

    match retry_api(policy, || client.user_notes(0, 100)).await {
        Ok((response, attempts)) => {
            let verified = user_note_list_matches(&response.value, uid, memo);
            (
                verified,
                Some(response.status),
                attempts,
                Some(if verified {
                    "userNotes 列表已验证".to_string()
                } else {
                    "userNotes 写入响应/列表均未匹配目标备注，已继续 block".to_string()
                }),
            )
        }
        Err(error) => (
            false,
            error.status_code().or(Some(post_response.status)),
            1,
            Some(format!(
                "userNotes 写入后读取列表失败，已继续 block：{error}"
            )),
        ),
    }
}

fn user_note_response_matches(note: &UserNoteResponse, uid: &str, memo: &str) -> bool {
    note.target_user_id.as_deref() == Some(uid) && note.note.as_deref() == Some(memo)
}

fn user_note_list_matches(notes: &[UserNoteResponse], uid: &str, memo: &str) -> bool {
    notes
        .iter()
        .any(|note| user_note_response_matches(note, uid, memo))
}

fn failed_item(
    row_index: usize,
    uid: String,
    memo: String,
    error: String,
    attempts: u32,
) -> RunItemResult {
    RunItemResult {
        row_index,
        uid,
        memo,
        status: RunItemStatus::Failed,
        note: None,
        block: None,
        attempts,
        error: Some(error),
    }
}

fn normal_item_delay(row_index: usize) -> Duration {
    Duration::from_millis(150 + ((row_index as u64 * 37) % 160))
}

fn finish_report(
    manifest_name: Option<String>,
    account: Option<crate::models::AccountSession>,
    started_at: String,
    run_id: String,
    items: Vec<RunItemResult>,
) -> RunReport {
    let summary = summarize_items(&items);

    RunReport {
        schema_version: "vrc-blocker.report.v1".to_string(),
        run_id,
        manifest_name,
        account,
        started_at,
        finished_at: Some(now_rfc3339()),
        summary,
        items,
    }
}

fn summarize_items(items: &[RunItemResult]) -> RunSummary {
    let mut summary = RunSummary {
        total: items.len(),
        ..RunSummary::default()
    };

    for item in items {
        match item.status {
            RunItemStatus::Success => summary.success += 1,
            RunItemStatus::AlreadyBlocked => {
                summary.success += 1;
                summary.already_blocked += 1;
            }
            RunItemStatus::Skipped => summary.skipped += 1,
            RunItemStatus::Failed
            | RunItemStatus::FailedBlockAfterNote
            | RunItemStatus::FailedNoteAfterBlock => summary.failed += 1,
        }
    }

    summary
}

pub fn next_delay_ms(
    policy: &RetryPolicy,
    failed_attempt: u32,
    retry_after_ms: Option<u64>,
) -> Option<u64> {
    if failed_attempt >= policy.max_attempts {
        return None;
    }

    if let Some(retry_after_ms) = retry_after_ms {
        return Some(retry_after_ms.min(policy.max_delay_ms));
    }

    let exponent = failed_attempt.saturating_sub(1).min(16);
    let raw = policy
        .base_delay_ms
        .saturating_mul(1_u64.checked_shl(exponent).unwrap_or(u64::MAX));
    let deterministic_jitter = (u64::from(failed_attempt) * 173) % 250;
    Some(
        raw.saturating_add(deterministic_jitter)
            .min(policy.max_delay_ms),
    )
}

pub fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_backoff_starts_fast_and_caps() {
        let policy = RetryPolicy {
            max_attempts: 5,
            base_delay_ms: 700,
            max_delay_ms: 3_000,
        };
        assert_eq!(next_delay_ms(&policy, 1, None), Some(873));
        assert_eq!(next_delay_ms(&policy, 5, None), None);
        assert_eq!(next_delay_ms(&policy, 3, Some(8_000)), Some(3_000));
    }

    #[test]
    fn summarizes_already_blocked_as_success() {
        let summary = summarize_items(&[RunItemResult {
            row_index: 1,
            uid: "usr_00000000-0000-4000-8000-000000000001".to_string(),
            memo: "memo".to_string(),
            status: RunItemStatus::AlreadyBlocked,
            note: None,
            block: None,
            attempts: 1,
            error: None,
        }]);

        assert_eq!(summary.total, 1);
        assert_eq!(summary.success, 1);
        assert_eq!(summary.already_blocked, 1);
    }

    #[test]
    fn summarizes_block_success_with_unverified_note_as_success() {
        let summary = summarize_items(&[RunItemResult {
            row_index: 1,
            uid: "usr_00000000-0000-4000-8000-000000000001".to_string(),
            memo: "memo".to_string(),
            status: RunItemStatus::Success,
            note: Some(OperationResult {
                action: "overwrite_user_note".to_string(),
                verified: false,
                http_status: Some(200),
                message: Some("备注读回不匹配，已继续 block".to_string()),
            }),
            block: Some(OperationResult {
                action: "block".to_string(),
                verified: true,
                http_status: Some(200),
                message: Some("block 已验证".to_string()),
            }),
            attempts: 3,
            error: None,
        }]);

        assert_eq!(summary.total, 1);
        assert_eq!(summary.success, 1);
        assert_eq!(summary.failed, 0);
    }

    #[test]
    fn verifies_user_note_from_user_notes_response() {
        let note = UserNoteResponse {
            id: Some("unt_1".to_string()),
            target_user_id: Some("usr_00000000-0000-4000-8000-000000000001".to_string()),
            note: Some("memo".to_string()),
        };

        assert!(user_note_response_matches(
            &note,
            "usr_00000000-0000-4000-8000-000000000001",
            "memo"
        ));
        assert!(!user_note_response_matches(
            &note,
            "usr_00000000-0000-4000-8000-000000000001",
            "other"
        ));
    }

    #[test]
    fn verifies_user_note_from_user_notes_list() {
        let notes = vec![
            UserNoteResponse {
                id: Some("unt_1".to_string()),
                target_user_id: Some("usr_00000000-0000-4000-8000-000000000001".to_string()),
                note: Some("old".to_string()),
            },
            UserNoteResponse {
                id: Some("unt_2".to_string()),
                target_user_id: Some("usr_00000000-0000-4000-8000-000000000002".to_string()),
                note: Some("memo".to_string()),
            },
        ];

        assert!(user_note_list_matches(
            &notes,
            "usr_00000000-0000-4000-8000-000000000002",
            "memo"
        ));
        assert!(!user_note_list_matches(
            &notes,
            "usr_00000000-0000-4000-8000-000000000001",
            "memo"
        ));
    }
}
