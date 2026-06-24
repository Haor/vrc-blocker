#![allow(dead_code)]

mod commands;
mod error;
mod import;
mod models;
mod run_engine;
mod session;
mod storage;
mod vrchat;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
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
            commands::save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
