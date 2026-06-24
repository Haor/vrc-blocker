use crate::models::AppSettings;

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    Ok(AppSettings::default())
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
    Ok(settings)
}
