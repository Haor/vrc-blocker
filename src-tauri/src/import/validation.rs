use crate::models::{
    ImportRow, ImportRowStatus, ValidationIssue, ValidationIssueKind, ValidationSummary, MEMO_LIMIT,
};
use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

pub fn is_valid_user_id(uid: &str) -> bool {
    static UID_RE: OnceLock<Regex> = OnceLock::new();
    UID_RE
        .get_or_init(|| {
            Regex::new(r"^usr_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
                .expect("valid uid regex")
        })
        .is_match(uid)
}

pub fn normalize_memo_for_vrchat(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn validate_rows(rows: &mut [ImportRow]) -> ValidationSummary {
    let mut summary = ValidationSummary {
        total: rows.len(),
        ..ValidationSummary::default()
    };
    let mut seen = HashSet::new();

    for row in rows {
        row.uid = row.uid.trim().to_string();
        row.normalized_memo = normalize_memo_for_vrchat(&row.memo);
        row.validation.clear();

        if !is_valid_user_id(&row.uid) {
            summary.invalid_uid += 1;
            row.validation.push(issue(
                row,
                ValidationIssueKind::InvalidUid,
                "UID must be a full VRChat user id beginning with usr_",
                Some("Use the canonical usr_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx value"),
            ));
        }

        if row.normalized_memo.trim().is_empty() {
            summary.empty_memo += 1;
            row.validation.push(issue(
                row,
                ValidationIssueKind::EmptyMemo,
                "memo is required because it is written to online userNotes",
                Some("Fill memo with the final note text to overwrite online userNotes"),
            ));
        }

        if row.normalized_memo.chars().count() > MEMO_LIMIT {
            summary.too_long += 1;
            row.validation.push(issue(
                row,
                ValidationIssueKind::TooLong,
                "memo is longer than the configured VRChat note limit",
                Some("Shorten memo to 256 characters or less"),
            ));
        }

        let seen_key = row.uid.to_ascii_lowercase();
        if !seen.insert(seen_key) {
            summary.duplicate += 1;
            row.validation.push(issue(
                row,
                ValidationIssueKind::Duplicate,
                "duplicate UID in this import",
                Some("Keep one row per UID before running the block task"),
            ));
        }

        row.status = if row.validation.is_empty() {
            summary.valid += 1;
            ImportRowStatus::Pending
        } else {
            ImportRowStatus::Failed
        };
    }

    summary
}

fn issue(
    row: &ImportRow,
    kind: ValidationIssueKind,
    message: &str,
    suggestion: Option<&str>,
) -> ValidationIssue {
    ValidationIssue {
        row_index: row.row_index,
        uid: if row.uid.is_empty() {
            None
        } else {
            Some(row.uid.clone())
        },
        kind,
        message: message.to_string(),
        suggestion: suggestion.map(ToString::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_vrchat_user_id_shape() {
        assert!(is_valid_user_id("usr_00000000-0000-4000-8000-000000000001"));
        assert!(!is_valid_user_id("not-a-user"));
    }

    #[test]
    fn normalizes_newlines_to_spaces_for_preview() {
        assert_eq!(
            normalize_memo_for_vrchat("line one\nline two\tline three"),
            "line one line two line three"
        );
    }
}
