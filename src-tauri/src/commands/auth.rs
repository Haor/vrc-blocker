use crate::models::{AccountSession, LoginOutcome, LoginRequest, SessionState, TwoFactorRequest};

#[tauri::command]
pub async fn get_session_status() -> Result<AccountSession, String> {
    Ok(AccountSession {
        account_id: None,
        user_id: None,
        display_name: None,
        session_state: SessionState::Unknown,
        last_validated_at: None,
    })
}

#[tauri::command]
pub async fn login(request: LoginRequest) -> Result<LoginOutcome, String> {
    let _ = request;
    Ok(LoginOutcome::Failed {
        error: "VRChat login command is scaffolded but not wired to the API yet".to_string(),
    })
}

#[tauri::command]
pub async fn verify_two_factor(request: TwoFactorRequest) -> Result<LoginOutcome, String> {
    let _ = request;
    Ok(LoginOutcome::Failed {
        error: "Two-factor verification command is scaffolded but not wired yet".to_string(),
    })
}

#[tauri::command]
pub async fn logout() -> Result<(), String> {
    Ok(())
}
