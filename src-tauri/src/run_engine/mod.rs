use crate::models::{
    OperationResult, RetryPolicy, RunItemResult, RunItemStatus, RunReport, RunSummary,
    StartRunRequest,
};
use time::OffsetDateTime;
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

fn now_rfc3339() -> String {
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
}
