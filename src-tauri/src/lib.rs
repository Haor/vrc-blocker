#![allow(dead_code)]

mod commands;
mod error;
mod import;
mod models;
mod run_engine;
mod session;
mod storage;
mod vrchat;

use session::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(AppState::new(app_data_dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_session_status,
            commands::login,
            commands::verify_two_factor,
            commands::logout,
            commands::parse_import_file,
            commands::parse_import_text,
            commands::validate_rows,
            commands::example_csv,
            commands::start_block_run,
            commands::get_settings,
            commands::save_settings,
            commands::save_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
