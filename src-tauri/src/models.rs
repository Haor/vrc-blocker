use serde::{Deserialize, Serialize};

pub const MEMO_LIMIT: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSession {
    pub account_id: Option<String>,
    pub user_id: Option<String>,
    pub display_name: Option<String>,
    pub session_state: SessionState,
    pub last_validated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    Unknown,
    Valid,
    RequiresTwoFactor,
    Invalid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub user_name_or_email: String,
    pub password: String,
    pub proxy: Option<ProxyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoginOutcome {
    Completed {
        account: AccountSession,
    },
    RequiresTotp {
        challenge_id: String,
        message: Option<String>,
    },
    RequiresEmailOtp {
        challenge_id: String,
        message: Option<String>,
    },
    Failed {
        error: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorRequest {
    pub challenge_id: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub mode: ProxyMode,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    System,
    Direct,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    pub row_index: usize,
    pub uid: String,
    pub memo: String,
    pub normalized_memo: String,
    pub skip: bool,
    pub validation: Vec<ValidationIssue>,
    pub status: ImportRowStatus,
}

impl ImportRow {
    pub fn new(row_index: usize, uid: String, memo: String) -> Self {
        Self {
            row_index,
            uid,
            normalized_memo: memo.clone(),
            memo,
            skip: false,
            validation: Vec::new(),
            status: ImportRowStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportRowStatus {
    Pending,
    Skipped,
    Running,
    Success,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub row_index: usize,
    pub uid: Option<String>,
    pub kind: ValidationIssueKind,
    pub message: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ValidationIssueKind {
    InvalidUid,
    EmptyMemo,
    TooLong,
    Duplicate,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    pub total: usize,
    pub valid: usize,
    pub invalid_uid: usize,
    pub empty_memo: usize,
    pub duplicate: usize,
    pub too_long: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedImport {
    pub source_name: Option<String>,
    pub encoding: String,
    pub total_rows: usize,
    pub rows: Vec<ImportRow>,
    pub summary: ValidationSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRunRequest {
    pub manifest_name: Option<String>,
    pub account: Option<AccountSession>,
    pub rows: Vec<ImportRow>,
    pub dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    pub schema_version: String,
    pub run_id: String,
    pub manifest_name: Option<String>,
    pub account: Option<AccountSession>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub summary: RunSummary,
    pub items: Vec<RunItemResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProgressEvent {
    pub phase: RunProgressPhase,
    pub run_id: String,
    pub total: usize,
    pub done: usize,
    pub item: Option<RunItemResult>,
    pub summary: Option<RunSummary>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunProgressPhase {
    Started,
    Item,
    Finished,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub total: usize,
    pub success: usize,
    pub failed: usize,
    pub skipped: usize,
    pub already_blocked: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunItemResult {
    pub row_index: usize,
    pub uid: String,
    pub memo: String,
    pub status: RunItemStatus,
    pub note: Option<OperationResult>,
    pub block: Option<OperationResult>,
    pub attempts: u32,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunItemStatus {
    Success,
    Failed,
    Skipped,
    AlreadyBlocked,
    FailedBlockAfterNote,
    FailedNoteAfterBlock,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub action: String,
    pub verified: bool,
    pub http_status: Option<u16>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub proxy: ProxyConfig,
    pub memo_limit: usize,
    pub retry_policy: RetryPolicy,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            proxy: ProxyConfig {
                mode: ProxyMode::System,
                url: None,
            },
            memo_limit: MEMO_LIMIT,
            retry_policy: RetryPolicy::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 5,
            base_delay_ms: 700,
            max_delay_ms: 30_000,
        }
    }
}
