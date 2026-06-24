use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("HTTP {status}: {message}")]
    HttpStatus {
        status: u16,
        message: String,
        retry_after_ms: Option<u64>,
    },
    #[error("URL error: {0}")]
    Url(#[from] url::ParseError),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("not implemented: {0}")]
    NotImplemented(String),
}

impl AppError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput(message.into())
    }

    pub fn not_implemented(message: impl Into<String>) -> Self {
        Self::NotImplemented(message.into())
    }

    pub fn http_status(
        status: u16,
        message: impl Into<String>,
        retry_after_ms: Option<u64>,
    ) -> Self {
        Self::HttpStatus {
            status,
            message: message.into(),
            retry_after_ms,
        }
    }

    pub fn status_code(&self) -> Option<u16> {
        match self {
            Self::HttpStatus { status, .. } => Some(*status),
            Self::Http(error) => error.status().map(|status| status.as_u16()),
            _ => None,
        }
    }

    pub fn retry_after_ms(&self) -> Option<u64> {
        match self {
            Self::HttpStatus { retry_after_ms, .. } => *retry_after_ms,
            _ => None,
        }
    }

    pub fn is_auth_error(&self) -> bool {
        matches!(self.status_code(), Some(401 | 403))
    }
}
